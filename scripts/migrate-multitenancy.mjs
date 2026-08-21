import fs from "node:fs";
import PocketBase from "pocketbase";

const apply = process.argv.includes("--apply");
const repairOrphanChatMessages = process.argv.includes("--repair-orphan-chat-messages");
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
if (!url || !email || !password)
  throw new Error("Thiếu PB_URL, PB_ADMIN_EMAIL hoặc PB_ADMIN_PASSWORD.");

const pb = new PocketBase(url);
pb.autoCancellation(false);
await pb
  .collection("_superusers")
  .authWithPassword(email, password)
  .catch(() => pb.admins.authWithPassword(email, password));

const LIMIT_FIELDS = [
  { name: "max_employment_histories", type: "number", min: 0, onlyInt: true },
  { name: "max_accounts", type: "number", min: 0, onlyInt: true },
  { name: "max_workers", type: "number", min: 0, onlyInt: true },
  { name: "max_factories", type: "number", min: 0, onlyInt: true },
  { name: "max_file_bytes", type: "number", min: 0, onlyInt: true },
];
const COMPANY_FIELDS = [
  { name: "code", type: "text", required: true, max: 40 },
  { name: "name", type: "text", required: true, max: 200 },
  {
    name: "status",
    type: "select",
    required: true,
    maxSelect: 1,
    values: ["active", "suspended", "closed"],
  },
  { name: "address", type: "text", max: 500 },
  { name: "hotline", type: "text", max: 40 },
  { name: "email", type: "email" },
  ...LIMIT_FIELDS,
];
const EXCLUDED = new Set(["_superusers", "companies", "uid_counters"]);
const MAX_INVALID_RECORDS_PER_COLLECTION = 25;
const HOANG_LONG_COMPANY = {
  code: "HOANGLONGDJC",
  name: "Hoàng Long DJC",
  status: "active",
  max_accounts: 0,
  max_workers: 0,
  max_factories: 0,
  max_file_bytes: 0,
  max_employment_histories: 0,
};

function tenantCollections(collections) {
  return collections.filter(
    (collection) =>
      collection.name === "users" ||
      (!EXCLUDED.has(collection.name) && !collection.system && !collection.name.startsWith("_")),
  );
}

function isBlankRequiredValue(value) {
  return (
    value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length)
  );
}

async function ensureUsersRole() {
  const users = await pb.collections.getOne("users");
  const role = (users.fields || []).find((field) => field.name === "role");
  if (!role || role.type !== "select")
    throw new Error("Collection users phải có field role kiểu select.");
  if ((role.values || []).includes("super_admin"))
    return { action: "users.role đã có super_admin" };
  if (apply)
    await pb.collections.update(users.id, {
      fields: (users.fields || []).map((field) =>
        field.name === "role"
          ? { ...field, values: [...new Set([...(field.values || []), "super_admin"])] }
          : field,
      ),
    });
  return { action: "thêm lựa chọn super_admin vào users.role" };
}

async function ensureCompanies() {
  let collection = await pb.collections.getOne("companies").catch(() => null);
  if (!collection) {
    if (!apply) return { action: "create companies" };
    collection = await pb.collections.create({
      name: "companies",
      type: "base",
      listRule: '@request.auth.role = "super_admin"',
      viewRule: '@request.auth.role = "super_admin"',
      createRule: '@request.auth.role = "super_admin"',
      updateRule: '@request.auth.role = "super_admin"',
      deleteRule: null,
      fields: COMPANY_FIELDS,
      indexes: ["CREATE UNIQUE INDEX idx_companies_code ON companies (code)"],
    });
    return { action: "created companies", collectionId: collection.id };
  }
  const existing = new Set((collection.fields || []).map((field) => field.name));
  const missing = COMPANY_FIELDS.filter((field) => !existing.has(field.name));
  if (missing.length && apply)
    await pb.collections.update(collection.id, {
      fields: [...collection.fields, ...missing],
      indexes: [
        ...new Set([
          ...(collection.indexes || []),
          "CREATE UNIQUE INDEX idx_companies_code ON companies (code)",
        ]),
      ],
    });
  return {
    action: missing.length
      ? `add fields: ${missing.map((field) => field.name).join(", ")}`
      : "companies ready",
  };
}

async function auditRequiredFields(collections) {
  const invalidRecords = [];
  for (const collection of tenantCollections(collections)) {
    // PocketBase revalidates every required field when a record is patched.
    const requiredFields = (collection.fields || [])
      .filter((field) => field.required && !field.system && field.name !== "company")
      .map((field) => field.name);
    if (!requiredFields.length) continue;
    const records = await pb
      .collection(collection.name)
      .getFullList({ fields: ["id", ...requiredFields].join(",") });
    const invalid = records
      .map((record) => ({
        id: record.id,
        fields: requiredFields.filter((field) => isBlankRequiredValue(record[field])),
      }))
      .filter((record) => record.fields.length);
    if (invalid.length)
      invalidRecords.push({
        collection: collection.name,
        count: invalid.length,
        records: invalid.slice(0, MAX_INVALID_RECORDS_PER_COLLECTION),
        truncated: invalid.length > MAX_INVALID_RECORDS_PER_COLLECTION,
      });
  }
  return invalidRecords;
}

async function repairOrphanChatMessagesIfRequested(collections) {
  const messages = collections.find((collection) => collection.name === "group_chat_messages");
  const rooms = collections.find((collection) => collection.name === "chat_rooms");
  if (!messages || !rooms) return null;

  const orphaned = (await pb.collection(messages.name).getFullList({ fields: "id,room" })).filter(
    (record) => !record.room,
  );
  if (!orphaned.length) return null;
  if (!repairOrphanChatMessages)
    return {
      count: orphaned.length,
      action: "cần chạy với --repair-orphan-chat-messages để bảo toàn các tin nhắn thiếu room",
    };
  if (!apply)
    return {
      count: orphaned.length,
      action: "sẽ tạo phòng Thông báo dữ liệu cũ và gán các tin nhắn thiếu room vào phòng đó",
    };

  let room = await pb
    .collection(rooms.name)
    .getFirstListItem('name = "Thông báo dữ liệu cũ"')
    .catch(() => null);
  if (!room)
    room = await pb.collection(rooms.name).create({
      name: "Thông báo dữ liệu cũ",
      description: "Phòng được migration tạo để bảo toàn tin nhắn cũ thiếu quan hệ phòng.",
      is_default: false,
    });
  for (const message of orphaned)
    await pb.collection(messages.name).update(message.id, { room: room.id });
  return { count: orphaned.length, action: `đã gán vào phòng ${room.id}` };
}

function isCompanyRelation(field, companyCollection) {
  return field?.type === "relation" && field.collectionId === companyCollection.id;
}

function tenantFieldName(collection, companyCollection) {
  const fields = collection.fields || [];
  const company = fields.find((field) => field.name === "company");
  if (isCompanyRelation(company, companyCollection)) return "company";
  const tenantCompany = fields.find((field) => field.name === "tenant_company");
  if (isCompanyRelation(tenantCompany, companyCollection)) return "tenant_company";
  return company ? "tenant_company" : "company";
}

async function planCompanyFields(collections, companyCollection) {
  const changes = [];
  for (const collection of tenantCollections(collections)) {
    const fields = collection.fields || [];
    const company = fields.find((field) => field.name === "company");
    if (!company) {
      changes.push({
        collection: collection.name,
        field: "company",
        action: "thêm relation tenant",
      });
      continue;
    }
    if (isCompanyRelation(company, companyCollection)) continue;

    const tenantCompany = fields.find((field) => field.name === "tenant_company");
    if (tenantCompany && !isCompanyRelation(tenantCompany, companyCollection))
      throw new Error(`${collection.name}.tenant_company phải là relation tới companies.`);
    if (isCompanyRelation(tenantCompany, companyCollection)) continue;

    changes.push({
      collection: collection.name,
      field: "tenant_company",
      action: "giữ company cũ và thêm relation tenant riêng",
      preservesLegacyCompany: true,
    });
  }
  return changes;
}

function relationField(name, companyCollection) {
  return {
    name,
    type: "relation",
    required: false,
    maxSelect: 1,
    collectionId: companyCollection.id,
    cascadeDelete: false,
  };
}

async function applyCompanyFieldPlan(collections, companyCollection, changes) {
  const applied = [];
  for (const change of changes) {
    const collection = collections.find((item) => item.name === change.collection);
    if (!collection) continue;
    applied.push({ collection: change.collection, field: change.field, action: change.action });
    if (!apply) continue;
    const fields = collection.fields || [];
    await pb.collections.update(collection.id, {
      fields: [...fields, relationField(change.field, companyCollection)],
    });
  }
  return applied;
}

async function buildVerification(collections, companyCollection) {
  const companies = await pb.collection("companies").getFullList({ fields: "id,code,name,status" });
  const tenantSummary = [];
  for (const collection of tenantCollections(collections)) {
    const field = tenantFieldName(collection, companyCollection);
    if (!(collection.fields || []).some((item) => item.name === field)) continue;
    const rows = await pb.collection(collection.name).getFullList({ fields: `id,${field}` });
    const assigned = rows.filter((row) => Boolean(row[field])).length;
    tenantSummary.push({
      collection: collection.name,
      field,
      total: rows.length,
      assigned,
      missing: rows.length - assigned,
    });
  }
  return {
    companyCount: companies.length,
    companies,
    missingAssignments: tenantSummary.reduce((sum, item) => sum + item.missing, 0),
    tenantCollections: tenantSummary,
  };
}

async function ensureHoangLongCompany() {
  const companies = await pb.collection("companies").getFullList();
  const primary =
    companies.find((company) => company.code === HOANG_LONG_COMPANY.code) ||
    companies.find((company) => company.name === HOANG_LONG_COMPANY.name) ||
    companies[0] ||
    null;
  const duplicates = primary ? companies.filter((company) => company.id !== primary.id) : [];

  if (!primary) {
    if (!apply) return { action: "sẽ tạo công ty Hoàng Long DJC", company: null, duplicates };
    const company = await pb.collection("companies").create(HOANG_LONG_COMPANY);
    return { action: "đã tạo công ty Hoàng Long DJC", company, duplicates };
  }

  if (apply) await pb.collection("companies").update(primary.id, HOANG_LONG_COMPANY);
  return {
    action: duplicates.length
      ? `sẽ hợp nhất ${duplicates.length} công ty vào Hoàng Long DJC`
      : "đã chuẩn hóa công ty Hoàng Long DJC",
    company: apply ? { ...primary, ...HOANG_LONG_COMPANY } : primary,
    duplicates,
  };
}

async function assignCompanyRecords(
  collections,
  companyCollection,
  targetCompany,
  duplicateCompanies,
) {
  const assignments = [];
  const sourceCompanyIds = new Set(duplicateCompanies.map((company) => company.id));
  for (const collection of tenantCollections(collections)) {
    const field = tenantFieldName(collection, companyCollection);
    if (!(collection.fields || []).some((item) => item.name === field)) continue;
    const records = await pb.collection(collection.name).getFullList({ fields: `id,${field}` });
    const toAssign = records.filter(
      (record) => !record[field] || sourceCompanyIds.has(record[field]),
    );
    if (toAssign.length) {
      assignments.push({ collection: collection.name, field, count: toAssign.length });
      if (apply) {
        for (const record of toAssign)
          await pb.collection(collection.name).update(record.id, { [field]: targetCompany.id });
      }
    }
  }
  if (apply) {
    for (const duplicate of duplicateCompanies)
      await pb.collection("companies").delete(duplicate.id);
  }
  return assignments;
}

const report = {
  apply,
  repairOrphanChatMessages,
  companies: null,
  usersRole: null,
  companyFieldChanges: [],
  defaultCompany: null,
  normalizedAssignments: [],
  unresolved: [],
  invalidRecords: [],
  orphanChatMessages: null,
  verification: null,
};
let allCollections = await pb.collections.getFullList();
if (repairOrphanChatMessages && apply) {
  report.orphanChatMessages = await repairOrphanChatMessagesIfRequested(allCollections);
  allCollections = await pb.collections.getFullList();
} else {
  report.orphanChatMessages = await repairOrphanChatMessagesIfRequested(allCollections);
}
report.invalidRecords = await auditRequiredFields(allCollections);
if (report.invalidRecords.length) {
  console.log(JSON.stringify(report, null, 2));
  console.error(
    "Migration bị chặn: cần sửa các bản ghi thiếu trường bắt buộc trước khi gán tenant.",
  );
  process.exitCode = 1;
} else {
  report.companies = await ensureCompanies();
  report.usersRole = await ensureUsersRole();
  const companyCollection = await pb.collections.getOne("companies").catch(() => null);
  if (!companyCollection) {
    console.log(JSON.stringify(report, null, 2));
    console.log(
      "Dry-run: collection companies sẽ được tạo. Chạy lại với --apply sau khi sao lưu PocketBase.",
    );
  } else {
    report.companyFieldChanges = await planCompanyFields(allCollections, companyCollection);
    await applyCompanyFieldPlan(allCollections, companyCollection, report.companyFieldChanges);
    allCollections = await pb.collections.getFullList();

    const normalized = await ensureHoangLongCompany();
    const defaultCompany = normalized.company;
    report.defaultCompany = defaultCompany
      ? { id: defaultCompany.id, name: HOANG_LONG_COMPANY.name, code: HOANG_LONG_COMPANY.code }
      : { name: HOANG_LONG_COMPANY.name, code: HOANG_LONG_COMPANY.code };
    if (defaultCompany) {
      report.normalizedAssignments = await assignCompanyRecords(
        allCollections,
        companyCollection,
        defaultCompany,
        normalized.duplicates,
      );
      report.unresolved = report.normalizedAssignments.map((item) => ({
        ...item,
        resolution: "gán vào Hoàng Long DJC",
      }));
    }
    report.verification = await buildVerification(allCollections, companyCollection);
    console.log(JSON.stringify(report, null, 2));
  }
}
if (!apply && !report.invalidRecords.length)
  console.log(
    "Dry-run hoàn tất. Chạy lại với --apply sau khi sao lưu PocketBase và rà soát report.",
  );
