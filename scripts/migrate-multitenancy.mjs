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
// Audit logs must survive company deletion, so they intentionally keep only company snapshots.
const EXCLUDED = new Set([
  "_superusers",
  "companies",
  "uid_counters",
  "tenant_purge_logs",
  "tenant_restore_logs",
]);
const MAX_INVALID_RECORDS_PER_COLLECTION = 25;
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

function tenantFieldName() {
  return "tenant_company";
}

async function planCompanyFields(collections, companyCollection) {
  const changes = [];
  for (const collection of tenantCollections(collections)) {
    const tenantCompany = (collection.fields || []).find(
      (field) => field.name === "tenant_company",
    );
    if (tenantCompany && !isCompanyRelation(tenantCompany, companyCollection))
      throw new Error(`${collection.name}.tenant_company phải là relation tới companies.`);
    if (tenantCompany) continue;
    changes.push({
      collection: collection.name,
      field: "tenant_company",
      action: "thêm relation tenant_company; giữ nguyên field company cũ để tương thích",
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
    await pb.collections.update(collection.id, {
      fields: [...(collection.fields || []), relationField("tenant_company", companyCollection)],
    });
  }
  return applied;
}

function relationValues(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

async function inferTenantAssignments(collections, companyCollection) {
  const companies = await pb.collection("companies").getFullList({ fields: "id,code,name" });
  const validCompanyIds = new Set(companies.map((company) => company.id));
  const collectionById = new Map(collections.map((collection) => [collection.id, collection]));
  const tenantCols = tenantCollections(collections).filter((collection) =>
    (collection.fields || []).some((field) => field.name === "tenant_company"),
  );
  const rowsByCollection = new Map();
  const rowByCollectionAndId = new Map();

  for (const collection of tenantCols) {
    const relationFields = (collection.fields || []).filter((field) => field.type === "relation");
    const fields = ["id", "tenant_company", ...relationFields.map((field) => field.name)];
    const rows = await pb
      .collection(collection.name)
      .getFullList({ fields: [...new Set(fields)].join(",") });
    rowsByCollection.set(collection.name, rows);
    rowByCollectionAndId.set(collection.name, new Map(rows.map((row) => [row.id, row])));
  }

  const inferredBySource = {};
  const conflicts = [];
  const assignments = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const collection of tenantCols) {
      const rows = rowsByCollection.get(collection.name) || [];
      const relationFields = (collection.fields || []).filter((field) => field.type === "relation");
      const legacyCompany = relationFields.find(
        (field) => field.name === "company" && field.collectionId === companyCollection.id,
      );
      const parentFields = relationFields.filter(
        (field) => field.name !== "tenant_company" && field.collectionId !== companyCollection.id,
      );

      for (const row of rows) {
        if (validCompanyIds.has(row.tenant_company)) continue;
        const candidates = [];
        if (legacyCompany && validCompanyIds.has(row.company))
          candidates.push({ tenant: row.company, source: "company_relation", priority: 1 });

        for (const field of parentFields) {
          const targetCollection = collectionById.get(field.collectionId);
          if (!targetCollection) continue;
          const targetRows = rowByCollectionAndId.get(targetCollection.name);
          for (const relationId of relationValues(row[field.name])) {
            const tenant = targetRows?.get(relationId)?.tenant_company;
            if (validCompanyIds.has(tenant)) {
              const directParent = [
                "request",
                "room",
                "batch",
                "factory",
                "employment_history",
                "worker",
                "user",
                "creator",
                "created_by",
                "staff",
                "admin",
                "requested_by",
                "recruiter_id",
              ].includes(field.name);
              candidates.push({
                tenant,
                source: `${targetCollection.name}.${field.name}`,
                priority: directParent ? 2 : 3,
              });
            }
          }
        }

        if (!candidates.length && companies.length === 1)
          candidates.push({ tenant: companies[0].id, source: "single_company", priority: 9 });
        if (!candidates.length) continue;

        candidates.sort((a, b) => a.priority - b.priority);
        const chosen = candidates[0];
        const distinct = [...new Set(candidates.map((candidate) => candidate.tenant))];
        if (distinct.length > 1) {
          conflicts.push({
            collection: collection.name,
            id: row.id,
            chosen: chosen.tenant,
            candidates,
          });
        }
        row.tenant_company = chosen.tenant;
        assignments.push({ collection: collection.name, id: row.id, ...chosen });
        inferredBySource[chosen.source] = (inferredBySource[chosen.source] || 0) + 1;
        changed = true;
      }
    }
  }

  if (apply) {
    for (const assignment of assignments) {
      await pb.collection(assignment.collection).update(assignment.id, {
        tenant_company: assignment.tenant,
      });
    }
  }

  const unresolved = [];
  for (const collection of tenantCols) {
    const invalid = (rowsByCollection.get(collection.name) || []).filter(
      (row) => !validCompanyIds.has(row.tenant_company),
    );
    if (!invalid.length) continue;
    unresolved.push({
      collection: collection.name,
      field: "tenant_company",
      count: invalid.length,
      records: invalid.slice(0, MAX_INVALID_RECORDS_PER_COLLECTION).map((row) => ({ id: row.id })),
      truncated: invalid.length > MAX_INVALID_RECORDS_PER_COLLECTION,
      resolution:
        "Không đủ quan hệ để suy luận tenant; cần gán thủ công trước khi bật rule bắt buộc.",
    });
  }

  return { assignments, inferredBySource, conflicts, unresolved };
}

async function buildVerification(collections) {
  const companies = await pb.collection("companies").getFullList({ fields: "id,code,name,status" });
  const tenantSummary = [];
  for (const collection of tenantCollections(collections)) {
    if (!(collection.fields || []).some((item) => item.name === "tenant_company")) continue;
    const rows = await pb.collection(collection.name).getFullList({ fields: "id,tenant_company" });
    const assigned = rows.filter((row) => Boolean(row.tenant_company)).length;
    tenantSummary.push({
      collection: collection.name,
      field: "tenant_company",
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

function removeLegacyCompanyTenantConstraint(rule) {
  if (rule === null || rule === undefined) return rule;
  return String(rule)
    .replaceAll(
      '(@request.auth.id != "" && @request.auth.role != "super_admin" && company = @request.auth.tenant_company && (@request.body.company:isset = false || @request.body.company = @request.auth.tenant_company))',
      '(@request.auth.id != "")',
    )
    .replaceAll(
      '(@request.auth.id != "" && @request.auth.role != "super_admin" && @request.body.company = @request.auth.tenant_company)',
      '(@request.auth.id != "")',
    )
    .replaceAll(
      '(@request.auth.id != "" && @request.auth.role != "super_admin" && company = @request.auth.tenant_company)',
      '(@request.auth.id != "")',
    );
}

function appendRule(existingRule, constraint) {
  if (existingRule === null || existingRule === undefined) return existingRule;
  const trimmed = removeLegacyCompanyTenantConstraint(existingRule).trim();
  if (!trimmed) return constraint;
  if (trimmed.includes("tenant_company = @request.auth.tenant_company")) return trimmed;
  return `(${trimmed}) && (${constraint})`;
}
function usersAccessRules() {
  const tenant = 'tenant_company = @request.auth.tenant_company';
  const manageableRole = '(role = "user" || role = "staff" || role = "")';
  const requestedManageableRole =
    '(@request.body.role:isset = false || @request.body.role = "user" || @request.body.role = "staff" || @request.body.role = "")';
  const unchangedTenant =
    '(@request.body.tenant_company:isset = false || @request.body.tenant_company = @request.auth.tenant_company)';
  const selfAdminUpdate =
    `(@request.auth.id = id && ${tenant} && ${unchangedTenant} && ` +
    '(@request.body.role:isset = false || @request.body.role = "admin"))';

  return {
    listRule: `(@request.auth.role = "super_admin" || (@request.auth.role = "admin" && ${tenant} && ${manageableRole}) || (@request.auth.role != "admin" && @request.auth.id != "" && ${tenant}))`,
    viewRule: `(@request.auth.role = "super_admin" || (@request.auth.role = "admin" && ${tenant} && ${manageableRole}) || (@request.auth.role != "admin" && @request.auth.id != "" && ${tenant}))`,
    createRule: `(@request.auth.role = "super_admin" || (@request.auth.role = "admin" && @request.body.tenant_company = @request.auth.tenant_company && ${requestedManageableRole}) || (@request.auth.role != "admin" && @request.auth.id != "" && @request.body.tenant_company = @request.auth.tenant_company))`,
    updateRule: `(@request.auth.role = "super_admin" || (@request.auth.role = "admin" && (${selfAdminUpdate} || (${tenant} && ${manageableRole} && ${unchangedTenant} && ${requestedManageableRole}))) || (@request.auth.role != "admin" && @request.auth.id != "" && ${tenant} && ${unchangedTenant}))`,
    deleteRule: `(@request.auth.role = "super_admin" || (@request.auth.role = "admin" && ${tenant} && ${manageableRole}) || (@request.auth.role != "admin" && @request.auth.id != "" && ${tenant}))`,
  };
}

async function ensureTenantRules(collections) {
  const changes = [];
  for (const collection of tenantCollections(collections)) {
    const tenantField = (collection.fields || []).find((item) => item.name === "tenant_company");
    if (!tenantField) continue;

    const recordConstraint = `(@request.auth.role = "super_admin" || (@request.auth.id != "" && tenant_company = @request.auth.tenant_company))`;
    const createBodyConstraint = `(@request.auth.role = "super_admin" || (@request.auth.id != "" && @request.body.tenant_company = @request.auth.tenant_company))`;
    const updateBodyConstraint = `(@request.auth.role = "super_admin" || (@request.auth.id != "" && tenant_company = @request.auth.tenant_company && (@request.body.tenant_company:isset = false || @request.body.tenant_company = @request.auth.tenant_company)))`;
    const deleteConstraint = `(@request.auth.role = "super_admin" || (@request.auth.id != "" && tenant_company = @request.auth.tenant_company))`;
    const tenantIndex = `CREATE INDEX idx_${collection.name}_tenant_company ON ${collection.name} (tenant_company)`;
    const accessRules = collection.name === "users" ? usersAccessRules() : null;
    const next = {
      listRule: accessRules?.listRule || appendRule(collection.listRule, recordConstraint),
      viewRule: accessRules?.viewRule || appendRule(collection.viewRule, recordConstraint),
      createRule: accessRules?.createRule || appendRule(collection.createRule, createBodyConstraint),
      updateRule: accessRules?.updateRule || appendRule(collection.updateRule, updateBodyConstraint),
      deleteRule: accessRules?.deleteRule || appendRule(collection.deleteRule, deleteConstraint),
      fields: (collection.fields || []).map((item) =>
        item.name === "tenant_company" ? { ...item, required: true } : item,
      ),
      indexes: [...new Set([...(collection.indexes || []), tenantIndex])],
    };
    const changed =
      JSON.stringify(next) !==
      JSON.stringify({
        listRule: collection.listRule,
        viewRule: collection.viewRule,
        createRule: collection.createRule,
        updateRule: collection.updateRule,
        deleteRule: collection.deleteRule,
        fields: collection.fields || [],
        indexes: collection.indexes || [],
      });
    if (!changed) continue;
    changes.push({
      collection: collection.name,
      field: "tenant_company",
      action:
        collection.name === "users"
          ? "bắt buộc tenant, thêm index và rule chặn Admin quản trị Admin/Super Admin"
          : "bắt buộc tenant, thêm index và rule tenant",
    });
    if (apply) await pb.collections.update(collection.id, next);
  }
  return changes;
}

async function removeLegacyCompanyFields(collections) {
  const changes = [];
  for (const collection of collections) {
    if (EXCLUDED.has(collection.name) || collection.system) continue;
    const legacy = (collection.fields || []).find((field) => field.name === "company");
    if (!legacy) continue;
    const nextFields = (collection.fields || []).filter((field) => field.name !== "company");
    const nextIndexes = (collection.indexes || []).filter((index) => !/\bcompany\b/.test(index) || /tenant_company/.test(index));
    changes.push({ collection: collection.name, field: "company", action: "xóa field company cũ" });
    if (apply) await pb.collections.update(collection.id, { fields: nextFields, indexes: nextIndexes });
  }
  return changes;
}

const report = {
  apply,
  repairOrphanChatMessages,
  companies: null,
  usersRole: null,
  companyFieldChanges: [],
  defaultCompany: null,
  normalizedAssignments: [],
  inferredBySource: {},
  conflicts: [],
  unresolved: [],
  invalidRecords: [],
  orphanChatMessages: null,
  verification: null,
  removedLegacyCompanyFields: [],
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

    const inference = await inferTenantAssignments(allCollections, companyCollection);
    report.normalizedAssignments = inference.assignments;
    report.inferredBySource = inference.inferredBySource;
    report.conflicts = inference.conflicts;
    report.unresolved = inference.unresolved;
    if (apply && report.unresolved.length) {
      console.error(
        "Migration đã backfill phần xác định được nhưng còn bản ghi thiếu tenant; chưa bật rule bắt buộc.",
      );
      process.exitCode = 1;
    }
    if (!report.unresolved.length) {
      report.tenantRuleChanges = await ensureTenantRules(allCollections);
      if (apply) allCollections = await pb.collections.getFullList();
    }
    if (!report.unresolved.length) {
      allCollections = await pb.collections.getFullList();
      report.removedLegacyCompanyFields = await removeLegacyCompanyFields(allCollections);
      if (apply) allCollections = await pb.collections.getFullList();
    }
    report.verification = await buildVerification(allCollections);
    console.log(JSON.stringify(report, null, 2));
  }
}
if (!apply && !report.invalidRecords.length)
  console.log(
    "Dry-run hoàn tất. Chạy lại với --apply sau khi sao lưu PocketBase và rà soát report.",
  );
