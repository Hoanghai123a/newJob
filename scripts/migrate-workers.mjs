import fs from "node:fs";
import PocketBase from "pocketbase";

const apply = process.argv.includes("--apply");
const allowDelete = process.argv.includes("--delete-legacy-users");
const env = Object.fromEntries(
  fs
    .readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i), line.slice(i + 1).replace(/^['\"]|['\"]$/g, "")];
    }),
);

const url = process.env.PB_URL || env.PB_URL || process.env.VITE_PB_URL || env.VITE_PB_URL;
const email = process.env.PB_ADMIN_EMAIL || env.PB_ADMIN_EMAIL;
const password = process.env.PB_ADMIN_PASSWORD || env.PB_ADMIN_PASSWORD;
if (!url || !email || !password) {
  throw new Error("Thiếu PB_URL, PB_ADMIN_EMAIL hoặc PB_ADMIN_PASSWORD.");
}

const pb = new PocketBase(url);
pb.autoCancellation(false);
await pb
  .collection("_superusers")
  .authWithPassword(email, password)
  .catch(() => pb.admins.authWithPassword(email, password));

const companiesCollection = await pb.collections.getOne("companies").catch(() => null);

const WORKER_FIELDS = [
  { name: "full_name", type: "text", required: true, max: 200 },
  { name: "phone", type: "text", max: 40 },
  { name: "uid", type: "text", max: 80 },
  { name: "cccd", type: "text", max: 40 },
  { name: "cccd_issue_date", type: "date" },
  { name: "gender", type: "text", max: 40 },
  { name: "date_of_birth", type: "date" },
  { name: "address", type: "text", max: 500 },
  { name: "bank_name", type: "text", max: 200 },
  { name: "bank_account_number", type: "text", max: 80 },
  { name: "bank_account_name", type: "text", max: 200 },
  { name: "bank_account_note", type: "text", max: 1000 },
  { name: "employee_code", type: "text", max: 100 },
  { name: "status", type: "select", required: true, maxSelect: 1, values: ["active", "inactive"] },
  { name: "source_user_id", type: "text", max: 50 },
  ...(companiesCollection
    ? [
        {
          name: "tenant_company",
          type: "relation",
          required: true,
          maxSelect: 1,
          collectionId: companiesCollection.id,
          cascadeDelete: false,
        },
      ]
    : []),
];

const WORKER_RELATION_NAMES = new Set([
  "user",
  "worker",
  "target_user",
  "challenger",
  "opponent",
  "winner",
]);
const AUTH_RELATION_NAMES = new Set([
  "actor",
  "staff",
  "admin",
  "admins",
  "created_by",
  "creator",
  "recruiter_staff",
  "approved_by",
  "rejected_by",
  "disbursed_by",
  "updated_by",
]);

function isLegacyWorker(record) {
  return record?.role === "user" || !record?.role;
}

function isWorkerRelation(field) {
  return (
    field?.type === "relation" &&
    WORKER_RELATION_NAMES.has(field.name) &&
    !AUTH_RELATION_NAMES.has(field.name)
  );
}

function removeSelfAuthClause(rule) {
  if (!rule) return rule;
  return (
    rule
      .split(/\s+\|\|\s+/)
      .filter(
        (clause) => !/(?:^|[\s(])(?:user|worker|target_user)\s*=\s*@request\.auth\.id/.test(clause),
      )
      .join(" || ") || null
  );
}

function workerPayload(user, workerCollection) {
  const payload = {
    id: user.id,
    full_name: String(user.full_name || user.username || user.phone || "NLĐ chưa có tên").trim(),
    phone: user.phone || "",
    uid: user.uid || "",
    cccd: user.cccd || "",
    cccd_issue_date: user.cccd_issue_date || "",
    gender: user.gender || "",
    date_of_birth: user.date_of_birth || "",
    address: user.address || "",
    bank_name: user.bank_name || "",
    bank_account_number: user.bank_account_number || "",
    bank_account_name: user.bank_account_name || "",
    bank_account_note: user.bank_account_note || "",
    employee_code: user.employee_code || "",
    status: user.status === "disabled" ? "inactive" : "active",
    source_user_id: user.id,
  };
  if (workerCollection.fields?.some((field) => field.name === "tenant_company")) {
    payload.tenant_company = user.tenant_company || user.company || "";
  }
  return payload;
}

async function ensureWorkersCollection() {
  let collection = await pb.collections.getOne("workers").catch(() => null);
  if (!collection) {
    if (!apply) return { action: "create workers" };
    collection = await pb.collections.create({
      name: "workers",
      type: "base",
      listRule:
        '(tenant_company = @request.auth.tenant_company) && (@request.auth.role = "admin" || @request.auth.role = "staff")',
      viewRule:
        '(tenant_company = @request.auth.tenant_company) && (@request.auth.role = "admin" || @request.auth.role = "staff")',
      createRule:
        '(@request.body.tenant_company = @request.auth.tenant_company) && (@request.auth.role = "admin" || @request.auth.role = "staff")',
      updateRule:
        '(tenant_company = @request.auth.tenant_company) && (@request.body.tenant_company:isset = false || @request.body.tenant_company = tenant_company) && (@request.auth.role = "admin" || @request.auth.role = "staff")',
      deleteRule: '(tenant_company = @request.auth.tenant_company) && @request.auth.role = "admin"',
      fields: WORKER_FIELDS,
      indexes: [
        "CREATE UNIQUE INDEX idx_workers_uid ON workers (uid) WHERE uid != ''",
        ...(companiesCollection
          ? ["CREATE INDEX idx_workers_tenant_company ON workers (tenant_company)"]
          : []),
      ],
    });
    return { action: "created workers", collection };
  }

  const existing = new Set((collection.fields || []).map((field) => field.name));
  const missing = WORKER_FIELDS.filter((field) => !existing.has(field.name));
  if (missing.length && apply) {
    await pb.collections.update(collection.id, {
      fields: [...collection.fields, ...missing],
    });
    collection = await pb.collections.getOne(collection.id);
  }
  return {
    action: missing.length
      ? `add fields: ${missing.map((field) => field.name).join(", ")}`
      : "workers ready",
    collection,
  };
}

const workersResult = await ensureWorkersCollection();
const workers =
  workersResult.collection || (await pb.collections.getOne("workers").catch(() => null));
const legacyUsers = (
  await pb.collection("users").getFullList({
    filter: 'role="user" || role=""',
    fields:
      "id,username,full_name,phone,uid,cccd,cccd_issue_date,gender,date_of_birth,address,bank_name,bank_account_number,bank_account_name,bank_account_note,employee_code,status,company,tenant_company,role",
    sort: "created",
  })
).filter(isLegacyWorker);
const report = {
  apply,
  allowDelete,
  workers: workersResult.action,
  legacyUsers: legacyUsers.length,
  createdWorkers: 0,
  existingWorkers: 0,
  relationChanges: [],
  migratedCollections: [],
  unresolved: [],
  deletedLegacyUsers: 0,
};

// Giữ nguyên id giúp các relation hiện hữu tiếp tục trỏ đúng bản ghi sau khi đổi collection đích.
if (apply && workers) {
  for (const user of legacyUsers) {
    const payload = workerPayload(user, workers);
    const existing = await pb
      .collection("workers")
      .getOne(user.id)
      .catch(() => null);
    const linked = await pb
      .collection("workers")
      .getFirstListItem(`auth_user="${user.id}"`)
      .catch(() => null);
    if (existing || linked) {
      report.existingWorkers += 1;
      continue;
    }
    try {
      // Legacy accounts that already have a worker are handled by auth_user above.
      await pb.collection("workers").create(payload);
      report.createdWorkers += 1;
    } catch (error) {
      report.unresolved.push({ userId: user.id, reason: error?.response?.message || error?.message || String(error) });
    }
  }
}

const allCollections = await pb.collections.getFullList();
for (const collection of allCollections) {
  if (collection.system || collection.name.startsWith("_") || collection.name === "workers")
    continue;
  const workerFields = (collection.fields || []).filter(
    (field) => isWorkerRelation(field) && field.collectionId === "_pb_users_auth_",
  );
  if (!workerFields.length) continue;

  report.relationChanges.push({
    collection: collection.name,
    fields: workerFields.map((field) => field.name),
  });
  report.migratedCollections.push(collection.name);

  if (apply && report.unresolved.length === 0) {
    const fields = (collection.fields || []).map((field) => {
      if (!workerFields.some((candidate) => candidate.id === field.id)) return field;
      return { ...field, collectionId: workers.id, cascadeDelete: false };
    });
    await pb.collections.update(collection.id, {
      fields,
      listRule: removeSelfAuthClause(collection.listRule),
      viewRule: removeSelfAuthClause(collection.viewRule),
      createRule: removeSelfAuthClause(collection.createRule),
      updateRule: removeSelfAuthClause(collection.updateRule),
      deleteRule: removeSelfAuthClause(collection.deleteRule),
    });
  }
}

if (apply && allowDelete && report.unresolved.length === 0) {
  const refreshedCollections = await pb.collections.getFullList();
  const remainingAuthWorkerFields = [];
  for (const collection of refreshedCollections) {
    if (collection.system || collection.name.startsWith("_")) continue;
    for (const field of collection.fields || []) {
      if (isWorkerRelation(field) && field.collectionId === "_pb_users_auth_") {
        remainingAuthWorkerFields.push(`${collection.name}.${field.name}`);
      }
    }
  }
  if (remainingAuthWorkerFields.length) {
    report.unresolved.push({
      reason: `Còn relation NLĐ trỏ users: ${remainingAuthWorkerFields.join(", ")}`,
    });
  } else {
    for (const user of legacyUsers) {
      const worker = await pb
        .collection("workers")
        .getOne(user.id)
        .catch(() => null);
      if (!worker) {
        report.unresolved.push({ userId: user.id, reason: "Thiếu worker tương ứng" });
        continue;
      }
      await pb.collection("users").delete(user.id);
      report.deletedLegacyUsers += 1;
    }
  }
}

console.log(JSON.stringify(report, null, 2));
if (!apply) {
  console.log(
    "Dry-run hoàn tất. Hãy sao lưu PocketBase, rà soát báo cáo rồi chạy lại với --apply.",
  );
} else if (!allowDelete) {
  console.log(
    "Đã chuyển dữ liệu nhưng chưa xóa users cũ. Chạy thêm --delete-legacy-users sau khi đối soát.",
  );
}
if (report.unresolved.length) process.exitCode = 2;
