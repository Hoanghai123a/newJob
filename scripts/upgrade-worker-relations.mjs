import fs from "node:fs";
import path from "node:path";
import PocketBase from "pocketbase";

const APPLY = process.argv.includes("--apply");
const REPORT_PATH = path.resolve("docs/migration-audit/worker-relation-upgrade-report.json");
const TARGETS = [
  { collection: "employment_histories", field: "user", required: true },
  { collection: "cccd_versions", field: "user", required: true },
  {
    collection: "staff_action_logs",
    field: "target_user",
    required: false,
    preserveAuthField: "target_auth_user",
  },
];

function readEnv() {
  const file = fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : "";
  return Object.fromEntries(
    file
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [
          line.slice(0, index).trim(),
          line
            .slice(index + 1)
            .trim()
            .replace(/^["']|["']$/g, ""),
        ];
      }),
  );
}

function writeReport(report) {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function sameTenant(record, tenantCompany) {
  return Boolean(record?.tenant_company && record.tenant_company === tenantCompany);
}

function workerPayload(user, workerCollection) {
  const payload = {
    id: user.id,
    auth_user: user.id,
    tenant_company: user.tenant_company,
    full_name: String(user.full_name || user.username || user.phone || "NLĐ chưa có tên").trim(),
    phone: user.phone || "",
    uid: user.uid || "",
    cccd: user.cccd || "",
    cccd_issue_date: user.cccd_issue_date || "",
    address: user.address || "",
    status: user.status === "disabled" ? "inactive" : "active",
  };
  if (fieldByName(workerCollection, "company")) payload.company = user.tenant_company;
  return payload;
}

function fieldByName(collection, name) {
  return (collection.fields || []).find((field) => field.name === name);
}

function replaceField(fields, name, update) {
  return fields.map((field) => (field.name === name ? { ...field, ...update } : field));
}

function relationField(name, collectionId, required = false) {
  return {
    name,
    type: "relation",
    required,
    presentable: false,
    system: false,
    collectionId,
    cascadeDelete: false,
    maxSelect: 1,
    minSelect: 0,
  };
}

function rulesFor(name) {
  const tenant = "(tenant_company = @request.auth.tenant_company)";
  if (name === "employment_histories")
    return {
      listRule: `${tenant} && (@request.auth.role = "admin" || @request.auth.role = "staff" || user.auth_user = @request.auth.id)`,
      viewRule: `${tenant} && (@request.auth.role = "admin" || @request.auth.role = "staff" || user.auth_user = @request.auth.id)`,
      createRule:
        '(@request.body.tenant_company = @request.auth.tenant_company) && (@request.auth.role = "admin" || @request.auth.role = "staff")',
      updateRule: `${tenant} && (@request.body.tenant_company:isset = false || @request.body.tenant_company = tenant_company) && (@request.auth.role = "admin" || @request.auth.role = "staff" || user.auth_user = @request.auth.id)`,
    };
  if (name === "cccd_versions")
    return {
      listRule: `${tenant} && (@request.auth.role = "admin" || @request.auth.role = "staff" || user.auth_user = @request.auth.id)`,
      viewRule: `${tenant} && (@request.auth.role = "admin" || @request.auth.role = "staff" || user.auth_user = @request.auth.id)`,
      createRule:
        '(@request.body.tenant_company = @request.auth.tenant_company) && (@request.auth.role = "admin" || @request.auth.role = "staff")',
      updateRule: `${tenant} && (@request.body.tenant_company:isset = false || @request.body.tenant_company = tenant_company) && (@request.auth.role = "admin" || @request.auth.role = "staff")`,
    };
  return {};
}

const env = readEnv();
const url = process.env.PB_URL || process.env.VITE_PB_URL || env.PB_URL || env.VITE_PB_URL;
const email = process.env.PB_ADMIN_EMAIL || env.PB_ADMIN_EMAIL;
const password = process.env.PB_ADMIN_PASSWORD || env.PB_ADMIN_PASSWORD;
if (!url || !email || !password) throw new Error("Thiếu cấu hình kết nối PocketBase.");

const pb = new PocketBase(url);
pb.autoCancellation(false);
const report = {
  apply: APPLY,
  generatedAt: new Date().toISOString(),
  createdWorkers: [],
  reusedWorkers: [],
  relationChanges: [],
  preservedAuthLogTargets: [],
  unresolved: [],
  safetyStop: false,
};

try {
  await pb
    .collection("_superusers")
    .authWithPassword(email, password)
    .catch(() => pb.admins.authWithPassword(email, password));
  const collections = await pb.collections.getFullList();
  const workersCollection = collections.find((collection) => collection.name === "workers");
  if (!workersCollection) throw new Error("Không tìm thấy collection workers.");
  const users = await pb
    .collection("users")
    .getFullList({
      fields:
        "id,role,tenant_company,full_name,username,phone,uid,cccd,cccd_issue_date,address,status",
    });
  const usersById = new Map(users.map((user) => [user.id, user]));
  const workers = await pb
    .collection("workers")
    .getFullList({ fields: "id,auth_user,tenant_company" });
  const workerById = new Map(workers.map((worker) => [worker.id, worker]));
  const requiredWorkerIds = new Set();
  const staffLogAuthTargets = [];

  for (const target of TARGETS) {
    const collection = collections.find((candidate) => candidate.name === target.collection);
    if (!collection) {
      report.unresolved.push({ collection: target.collection, reason: "Thiếu collection." });
      continue;
    }
    const records = await pb
      .collection(target.collection)
      .getFullList({ fields: `id,${target.field},tenant_company` });
    for (const record of records) {
      const authId = String(record[target.field] || "");
      if (!authId) continue;
      const user = usersById.get(authId);
      if (!user || !sameTenant(user, record.tenant_company)) {
        report.unresolved.push({
          collection: target.collection,
          recordId: record.id,
          authId,
          reason: "Không tìm được tài khoản cùng công ty để ánh xạ.",
        });
        continue;
      }
      if (target.preserveAuthField && user.role && user.role !== "user") {
        staffLogAuthTargets.push({ id: record.id, authId });
      } else {
        requiredWorkerIds.add(authId);
      }
    }
  }

  for (const authId of requiredWorkerIds) {
    const user = usersById.get(authId);
    const worker = workerById.get(authId);
    if (worker) {
      if (worker.tenant_company !== user.tenant_company)
        report.unresolved.push({ authId, reason: "Worker cùng ID nhưng khác công ty." });
      else report.reusedWorkers.push(authId);
    } else report.createdWorkers.push(authId);
  }
  report.preservedAuthLogTargets = staffLogAuthTargets;
  report.safetyStop = report.unresolved.length > 0;
  writeReport(report);
  console.log(JSON.stringify(report, null, 2));
  if (report.safetyStop)
    throw new Error(`Dry-run có ${report.unresolved.length} bản ghi chưa thể ánh xạ an toàn.`);
  if (!APPLY) {
    console.log(`Dry-run hoàn tất. Báo cáo: ${REPORT_PATH}`);
  } else {
    let workerFields = [...workersCollection.fields];
    if (!fieldByName(workersCollection, "auth_user"))
      workerFields.push(relationField("auth_user", "_pb_users_auth_"));
    const workerIndexes = [...(workersCollection.indexes || [])];
    if (!workerIndexes.some((index) => /idx_workers_auth_user/.test(index))) {
      workerIndexes.push(
        "CREATE UNIQUE INDEX idx_workers_auth_user ON workers (auth_user) WHERE auth_user != ''",
      );
    }
    await pb.collections.update(workersCollection.id, {
      fields: workerFields,
      indexes: workerIndexes,
      listRule:
        '(tenant_company = @request.auth.tenant_company) && (@request.auth.role = "admin" || @request.auth.role = "staff" || auth_user = @request.auth.id)',
      viewRule:
        '(tenant_company = @request.auth.tenant_company) && (@request.auth.role = "admin" || @request.auth.role = "staff" || auth_user = @request.auth.id)',
      createRule:
        '(@request.body.tenant_company = @request.auth.tenant_company) && (@request.auth.role = "admin" || @request.auth.role = "staff")',
      updateRule:
        '(tenant_company = @request.auth.tenant_company) && (@request.body.tenant_company:isset = false || @request.body.tenant_company = tenant_company) && (@request.auth.role = "admin" || @request.auth.role = "staff" || auth_user = @request.auth.id)',
      deleteRule:
        '(tenant_company = @request.auth.tenant_company) && (@request.auth.role = "admin")',
    });
    for (const authId of report.createdWorkers)
      await pb
        .collection("workers")
        .create(workerPayload(usersById.get(authId), workersCollection));
    for (const authId of report.reusedWorkers)
      await pb.collection("workers").update(authId, { auth_user: authId });

    const employmentCollection = await pb.collections.getOne("employment_histories");
    const employmentFields = employmentCollection.fields.map((field) =>
      field.name === "company" ? { ...field, required: false } : field,
    );
    await pb.collections.update(employmentCollection.id, { fields: employmentFields });
    report.relationChanges.push(
      "workers.auth_user đã được bổ sung và đồng bộ với tài khoản NLĐ hiện có.",
    );
    report.relationChanges.push(
      "employment_histories.company đã chuyển thành không bắt buộc; tenant_company là tenant chuẩn.",
    );
    writeReport(report);
    console.log(`Đã áp dụng liên kết workers.auth_user. Báo cáo: ${REPORT_PATH}`);
  }
} finally {
  pb.authStore.clear();
}
