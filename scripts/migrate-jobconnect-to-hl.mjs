#!/usr/bin/env node
/**
 * Chuyen du lieu nghiep vu JobConnect -> NewApp tenant HL.
 * Mac dinh dry-run. Apply truc tiep chi duoc phep voi --direct sau preflight.
 * Mat khau tam chi doc tu MIGRATION_TEMP_PASSWORD trong phien chay.
 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import PocketBase from "pocketbase";

const APPLY = process.argv.includes("--apply");
const DIRECT = process.argv.includes("--direct");
const KEEP_BACKUP = !process.argv.includes("--no-backup");
const TEMP_PASSWORD = process.env.MIGRATION_TEMP_PASSWORD || "nv123456";
const MIGRATION_RUN_ID =
  process.env.MIGRATION_RUN_ID ||
  `hl-${new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14)}-${crypto.randomBytes(4).toString("hex")}`;
const SOURCE_ROOT = process.env.JOBCONNECT_ROOT || "D:/My App/JobConnect";
const TARGET_ROOT = process.env.NEWAPP_ROOT || "D:/My App/newApp";
const HL_NAME = "Hoàng Long DJC";
const HL_CODE = "HL";
const TEST_CODE = "HOANGLONGDJC";
const EXCLUDED = new Set([
  "garden_foods",
  "garden_exchange_tiers",
  "garden_balances",
  "garden_exchange_requests",
  "garden_visit_saves",
  "garden_game_sessions",
  "garden_gem_rewards",
  "garden_duels",
  "garden_coin_logs",
  "gems",
  "gem_transactions",
  "minesweeper",
  "minesweeper_scores",
  "counter",
  "counters",
  "game_sessions",
  "game_scores",
]);
const SYSTEM = new Set(["companies", "uid_counters", "tenant_purge_logs", "tenant_restore_logs"]);
const RELATION_ALIAS = new Map([["_pb_users_auth_", "users"]]);

function readEnv(file) {
  return fs
    .readFile(file, "utf8")
    .then((text) =>
      Object.fromEntries(
        text
          .split(/\r?\n/)
          .map((line) => {
            const i = line.indexOf("=");
            return i > 0
              ? [
                  line.slice(0, i).trim(),
                  line
                    .slice(i + 1)
                    .trim()
                    .replace(/^['\"]|['\"]$/g, ""),
                ]
              : null;
          })
          .filter(Boolean),
      ),
    )
    .catch(() => ({}));
}
function envValue(env, key, fallback = "") {
  return process.env[key] || env[key] || fallback;
}
function clean(value) {
  return value === undefined || value === null ? "" : value;
}
function json(value) {
  return JSON.stringify(value, null, 2);
}
async function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}
async function mkdir(dir) {
  await fs.mkdir(dir, { recursive: true });
}
async function saveJson(file, value) {
  await mkdir(path.dirname(file));
  await fs.writeFile(file, json(value), "utf8");
}
function relationValues(value) {
  return Array.isArray(value) ? value.filter(Boolean) : value ? [value] : [];
}
function fileValues(value) {
  return Array.isArray(value) ? value.filter(Boolean) : value ? [value] : [];
}
function redactRecord(value) {
  if (Array.isArray(value)) return value.map(redactRecord);
  if (!value || typeof value !== "object") return value;
  const copy = {};
  for (const [key, item] of Object.entries(value)) {
    if (/password|token|secret|privatekey|authkey|apikey/i.test(key)) continue;
    copy[key] = redactRecord(item);
  }
  return copy;
}

async function writeCheckpoint(backupDir, report, name, status = "completed") {
  report.checkpoints ||= [];
  report.checkpoints.push({ name, status, at: new Date().toISOString() });
  await saveJson(path.join(backupDir, "migration-state.json"), {
    migration_run_id: MIGRATION_RUN_ID,
    status,
    checkpoint: name,
    checkpoints: report.checkpoints,
    created: report.created || null,
    companyId: report.companyId || null,
  });
}

async function connect(root, prefix) {
  const env = await readEnv(path.join(root, ".env"));
  const url = envValue(
    env,
    `${prefix}_PB_URL`,
    envValue(
      env,
      "PB_URL",
      envValue(
        env,
        "VITE_PB_URL",
        prefix === "SOURCE" ? "http://127.0.0.1:8090" : "http://127.0.0.1:8290",
      ),
    ),
  );
  const email = envValue(env, `${prefix}_PB_ADMIN_EMAIL`, envValue(env, "PB_ADMIN_EMAIL"));
  const password = envValue(env, `${prefix}_PB_ADMIN_PASSWORD`, envValue(env, "PB_ADMIN_PASSWORD"));
  if (!url || !email || !password) throw new Error(`Thiếu cấu hình ${prefix} PocketBase.`);
  const pb = new PocketBase(url);
  pb.autoCancellation(false);
  await pb
    .collection("_superusers")
    .authWithPassword(email, password)
    .catch(() => pb.admins.authWithPassword(email, password));
  return { pb, url };
}

async function allRecords(pb, name) {
  return pb.collection(name).getFullList({ sort: "" });
}
function relationTargetName(field, sourceCollections) {
  return (
    RELATION_ALIAS.get(field.collectionId) ||
    sourceCollections.find((c) => c.id === field.collectionId)?.name ||
    ""
  );
}
function isUserRecord(record) {
  return (
    record?.role === "admin" || record?.role === "staff" || record?.role === "user" || !record?.role
  );
}
function normalizedMatch(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("vi-VN")
    .replace(/\s+/g, " ");
}
function inferSourceUser(row, sourceUsers) {
  const explicit = row?.user || row?.submitter || row?.worker;
  if (explicit) return sourceUsers.find((user) => user.id === explicit) || null;
  const phone = normalizedMatch(row?.phone).replace(/\D/g, "");
  if (phone) {
    const matches = sourceUsers.filter(
      (user) => normalizedMatch(user.phone).replace(/\D/g, "") === phone,
    );
    if (matches.length === 1) return matches[0];
  }
  const fullName = normalizedMatch(row?.full_name);
  if (fullName) {
    const matches = sourceUsers.filter((user) => normalizedMatch(user.full_name) === fullName);
    if (matches.length === 1) return matches[0];
  }
  return null;
}
function loginName(username) {
  return String(username || "user")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "_");
}
function buildUsernames(users) {
  const used = new Set();
  const result = new Map();
  for (const user of users) {
    const base = `hl__${loginName(user.username)}`;
    let username = base;
    let index = 2;
    while (used.has(username)) username = `${base}_${index++}`;
    used.add(username);
    result.set(user.id, username);
  }
  return result;
}
function targetFieldMap(collection) {
  return new Map((collection?.fields || []).map((field) => [field.name, field]));
}
function duplicateValues(rows, field) {
  const groups = new Map();
  for (const row of rows) {
    const value = String(row[field] || "").trim();
    if (!value) continue;
    const ids = groups.get(value) || [];
    ids.push(row.id);
    groups.set(value, ids);
  }
  return [...groups.entries()].filter(([, ids]) => ids.length > 1);
}
function mapRelationId(collectionName, sourceId, maps) {
  if (!sourceId) return "";
  return maps.get(collectionName)?.get(sourceId) || "";
}

function relationDependencies(collection, sourceCollections) {
  return [
    ...new Set(
      (collection.fields || [])
        .filter((field) => field.type === "relation")
        .map((field) => relationTargetName(field, sourceCollections))
        .filter((name) => name && name !== "users" && name !== collection.name),
    ),
  ];
}

function portableField(field, sourceCollections, targetCollections, companiesId) {
  const next = { name: field.name, type: field.type };
  for (const key of [
    "required",
    "presentable",
    "min",
    "max",
    "maxSelect",
    "minSelect",
    "pattern",
    "values",
    "autogeneratePattern",
  ]) {
    if (field[key] !== undefined) next[key] = field[key];
  }
  if (field.type === "relation") {
    const targetName = relationTargetName(field, sourceCollections);
    const target = targetCollections.find((collection) => collection.name === targetName);
    next.collectionId = target?.id || (targetName === "users" ? "_pb_users_auth_" : "");
    next.cascadeDelete = false;
    next.maxSelect = field.maxSelect || 1;
  }
  if (field.type === "file") next.maxSelect = field.maxSelect || 1;
  return next;
}

async function ensureMissingCollections(
  target,
  sourceCollections,
  targetCollections,
  sourceRecords,
  report,
) {
  const companies = targetCollections.find((collection) => collection.name === "companies");
  if (!companies) throw new Error("NewApp thiếu collection companies.");
  for (const [name] of sourceRecords) {
    if (
      SYSTEM.has(name) ||
      EXCLUDED.has(name) ||
      targetCollections.some((collection) => collection.name === name)
    )
      continue;
    const source = sourceCollections.find((collection) => collection.name === name);
    if (!source) continue;
    report.warnings.push({ collection: name, reason: "Cần tạo collection từ schema nguồn." });
    if (!APPLY) continue;
    const fields = (source.fields || [])
      .filter((field) => !["id", "created", "updated"].includes(field.name))
      .map((field) => portableField(field, sourceCollections, targetCollections, companies.id))
      .filter((field) => field.type !== "relation" || field.collectionId);
    if (name === "complaints") {
      const user = fields.find((field) => field.name === "user");
      if (user) {
        user.name = "submitter";
        user.required = true;
      }
      fields.push({
        name: "worker",
        type: "relation",
        required: false,
        maxSelect: 1,
        collectionId: targetCollections.find((c) => c.name === "workers")?.id,
        cascadeDelete: false,
      });
    }
    if (name === "attendance") {
      const user = fields.find((field) => field.name === "user");
      if (user) {
        user.name = "worker";
        user.collectionId = targetCollections.find((c) => c.name === "workers")?.id;
        user.required = true;
      }
    }
    fields.push({
      name: "tenant_company",
      type: "relation",
      required: true,
      maxSelect: 1,
      collectionId: companies.id,
      cascadeDelete: false,
    });
    fields.push({ name: "migration_run_id", type: "text", required: false, max: 100 });
    const created = await target.pb.collections.create({
      name,
      type: "base",
      fields,
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: '@request.auth.id != ""',
      updateRule: '@request.auth.id != ""',
      deleteRule: '@request.auth.id != ""',
    });
    targetCollections.push(created);
  }
}

async function backupTenant(target, company, backupDir, collections) {
  const records = {};
  for (const collection of collections) {
    if (collection.system || collection.name.startsWith("_") || collection.name === "companies")
      continue;
    const fields = targetFieldMap(collection);
    const tenantField = fields.has("tenant_company")
      ? "tenant_company"
      : fields.get("company")?.type === "relation"
        ? "company"
        : "";
    if (!tenantField) continue;
    const rows = await target.pb.collection(collection.name).getFullList({
      filter: `${tenantField}="${company.id}"`,
      sort: "",
    });
    if (rows.length) records[collection.name] = rows;
  }
  await saveJson(path.join(backupDir, "target-test-tenant.json"), {
    company,
    records,
  });
  return Object.fromEntries(Object.entries(records).map(([name, rows]) => [name, rows.length]));
}

async function backupSourceFiles(source, sourceRecords, sourceByName, backupDir) {
  const manifest = [];
  for (const [name, rows] of sourceRecords) {
    const fileFields = (sourceByName.get(name)?.fields || []).filter(
      (field) => field.type === "file",
    );
    for (const row of rows) {
      for (const field of fileFields) {
        for (const filename of fileValues(row[field.name])) {
          const response = await fetch(source.pb.files.getURL(row, filename));
          if (!response.ok)
            throw new Error(`Không tải được file backup ${name}/${row.id}/${filename}.`);
          const bytes = Buffer.from(await response.arrayBuffer());
          const relativePath = path.join("files", name, row.id, filename);
          const output = path.join(backupDir, relativePath);
          await mkdir(path.dirname(output));
          await fs.writeFile(output, bytes);
          manifest.push({
            collection: name,
            recordId: row.id,
            field: field.name,
            filename,
            path: relativePath.replaceAll("\\", "/"),
            size: bytes.length,
            sha256: await sha256(bytes),
          });
        }
      }
    }
  }
  await saveJson(path.join(backupDir, "files-manifest.json"), manifest);
  return { count: manifest.length, sha256: await sha256(Buffer.from(json(manifest), "utf8")) };
}

async function copyFiles(source, target, sourceSchema, sourceRow, targetCollection, targetId) {
  const fileFields = (sourceSchema?.fields || []).filter((field) => field.type === "file");
  for (const fileField of fileFields) {
    for (const filename of fileValues(sourceRow[fileField.name])) {
      const response = await fetch(source.pb.files.getURL(sourceRow, filename));
      if (!response.ok)
        throw new Error(`Không tải được file ${targetCollection}/${sourceRow.id}/${filename}.`);
      const form = new FormData();
      form.append(fileField.name, new Blob([await response.arrayBuffer()]), filename);
      await target.pb.collection(targetCollection).update(targetId, form);
    }
  }
}

async function buildRecordFormData(source, sourceSchema, sourceRow, payload) {
  const form = new FormData();
  for (const [key, value] of Object.entries(payload)) {
    if (Array.isArray(value)) {
      for (const item of value) form.append(key, String(item));
    } else if (value !== undefined && value !== null) {
      form.append(key, String(value));
    }
  }
  const fileFields = (sourceSchema?.fields || []).filter((field) => field.type === "file");
  for (const fileField of fileFields) {
    for (const filename of fileValues(sourceRow[fileField.name])) {
      const response = await fetch(source.pb.files.getURL(sourceRow, filename));
      if (!response.ok)
        throw new Error(
          `Không tải được file ${sourceRow.collectionName || "record"}/${sourceRow.id}/${filename}.`,
        );
      form.append(fileField.name, new Blob([await response.arrayBuffer()]), filename);
    }
  }
  return form;
}

async function main() {
  if (process.argv.includes("--purge-test-tenant"))
    throw new Error(
      "Khong ho tro --purge-test-tenant; cleanup tenant test phai lam thu cong sau nghiem thu.",
    );
  if (APPLY && !DIRECT)
    throw new Error(
      "Apply truc tiep bat buoc co --direct; migration khong tu dong xoa tenant test.",
    );
  if (!APPLY && DIRECT)
    throw new Error("--direct chi dung cho apply; preflight/dry-run khong ghi du lieu.");
  if (APPLY && TEMP_PASSWORD.length < 8)
    throw new Error("Thiếu MIGRATION_TEMP_PASSWORD tối thiểu 8 ký tự.");
  const [source, target] = await Promise.all([
    connect(SOURCE_ROOT, "SOURCE"),
    connect(TARGET_ROOT, "TARGET"),
  ]);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(
    TARGET_ROOT,
    "backups",
    `jobconnect-to-hl-${MIGRATION_RUN_ID}-${stamp}`,
  );
  const report = {
    apply: APPLY,
    direct: DIRECT,
    created_at: new Date().toISOString(),
    migration_run_id: MIGRATION_RUN_ID,
    sourceUrl: source.url,
    targetUrl: target.url,
    backupDir,
    excludedCollections: [...EXCLUDED],
    unresolved: [],
    warnings: [],
    counts: {},
    mapping: { users: {}, workers: {}, collections: {} },
    purgePreview: null,
    checkpoints: [],
    created_ids: { companies: [], users: [], workers: [], records: {} },
  };

  const [sourceCollections, initialTargetCollections] = await Promise.all([
    source.pb.collections.getFullList(),
    target.pb.collections.getFullList(),
  ]);
  let targetCollections = initialTargetCollections;
  const sourceByName = new Map(sourceCollections.map((c) => [c.name, c]));
  let targetByName = new Map(targetCollections.map((c) => [c.name, c]));
  const testCompanies = await target.pb
    .collection("companies")
    .getFullList({ filter: `code="${TEST_CODE}"`, fields: "id,code,name,status" });
  const hlCompanies = await target.pb
    .collection("companies")
    .getFullList({ filter: `code="${HL_CODE}"`, fields: "id,code,name,status" });
  if (hlCompanies.length)
    report.warnings.push({
      scope: "company",
      reason: `Mã ${HL_CODE} đã tồn tại; sẽ tái sử dụng để chạy idempotent.`,
    });
  if (!testCompanies.length)
    report.warnings.push({
      scope: "company",
      reason: `Không tìm thấy tenant test ${TEST_CODE}; tiếp tục vì migration không tự động purge tenant test.`,
    });
  if (testCompanies.length > 1)
    report.unresolved.push({
      scope: "company",
      reason: `Tenant test ${TEST_CODE} xuất hiện nhiều hơn một bản ghi; cần xử lý thủ công trước khi apply.`,
      ids: testCompanies.map((company) => company.id),
    });
  if (
    testCompanies.length &&
    (testCompanies[0].name !== HL_NAME || testCompanies[0].code !== TEST_CODE)
  )
    report.unresolved.push({
      scope: "company",
      reason: "Tenant test không khớp chính xác tên/mã đã chốt.",
    });

  const sourceUsers = await allRecords(source.pb, "users");
  const sourceUserById = new Map(sourceUsers.map((row) => [row.id, row]));
  const sourceWorkerUsers = sourceUsers.filter((row) => row.role !== "admin");
  for (const field of ["uid", "employee_code"]) {
    for (const [value, ids] of duplicateValues(sourceUsers, field))
      report.unresolved.push({
        scope: "source",
        field,
        value,
        ids,
        reason: "Giá trị nguồn bị trùng.",
      });
  }
  const sourceRecords = new Map();
  for (const collection of sourceCollections) {
    if (
      collection.system ||
      collection.name.startsWith("_") ||
      SYSTEM.has(collection.name) ||
      EXCLUDED.has(collection.name)
    )
      continue;
    const rows = await allRecords(source.pb, collection.name);
    sourceRecords.set(collection.name, rows);
    report.counts[collection.name] = rows.length;
  }

  await ensureMissingCollections(
    target,
    sourceCollections,
    targetCollections,
    sourceRecords,
    report,
  );
  targetByName = new Map(targetCollections.map((c) => [c.name, c]));

  if (KEEP_BACKUP) {
    await saveJson(path.join(backupDir, "manifest.json"), {
      createdAt: new Date().toISOString(),
      sourceUrl: source.url,
      targetUrl: target.url,
      counts: report.counts,
      excludedCollections: [...EXCLUDED],
    });
    for (const [name, rows] of sourceRecords)
      await saveJson(path.join(backupDir, "records", `${name}.json`), rows.map(redactRecord));
    await saveJson(path.join(backupDir, "schema-source.json"), sourceCollections);
    report.sourceFiles = await backupSourceFiles(source, sourceRecords, sourceByName, backupDir);
    if (!APPLY && testCompanies.length)
      report.testTenantBackup = await backupTenant(
        target,
        testCompanies[0],
        backupDir,
        targetCollections,
      );
  }

  if (testCompanies.length) {
    const tenantCollections = targetCollections.filter(
      (c) =>
        !c.system &&
        !c.name.startsWith("_") &&
        c.name !== "companies" &&
        (c.fields || []).some(
          (f) => f.name === "tenant_company" || (f.name === "company" && f.type === "relation"),
        ),
    );
    const preview = {};
    for (const c of tenantCollections) {
      const fields = targetFieldMap(c);
      const field = fields.has("tenant_company")
        ? "tenant_company"
        : fields.has("company")
          ? "company"
          : "";
      if (!field) continue;
      preview[c.name] = (
        await target.pb
          .collection(c.name)
          .getList(1, 1, { filter: `${field}="${testCompanies[0].id}"`, fields: "id" })
      ).totalItems;
    }
    report.purgePreview = { company: testCompanies[0], counts: preview };
  }

  const targetRowsByCollection = new Map(
    await Promise.all(
      targetCollections
        .filter((collection) => !collection.system && !collection.name.startsWith("_"))
        .map(async (collection) => [collection.name, await allRecords(target.pb, collection.name)]),
    ),
  );
  const targetUsers = targetRowsByCollection.get("users") || [];
  const targetWorkers = targetRowsByCollection.get("workers") || [];
  const hlId = hlCompanies[0]?.id || "";
  // Existing records in HL are valid idempotent migration state. Only rows
  // owned by another tenant (or with no tenant ownership) are conflicts.
  const allowedTenantIds = new Set([testCompanies[0]?.id, hlCompanies[0]?.id].filter(Boolean));
  const isAllowedTenantRow = (row) =>
    allowedTenantIds.has(row.tenant_company) || allowedTenantIds.has(row.company);
  const targetIdsByCollection = new Map(
    [...targetRowsByCollection.entries()].map(([name, rows]) => [
      name,
      new Set(
        rows
          .filter((row) => !hlId || row.tenant_company === hlId || row.company === hlId)
          .map((row) => row.id),
      ),
    ]),
  );
  const targetAnyIdsByCollection = new Map(
    [...targetRowsByCollection.entries()].map(([name, rows]) => [
      name,
      new Set(rows.map((row) => row.id)),
    ]),
  );
  for (const [name, rows] of sourceRecords) {
    const targetRows = targetRowsByCollection.get(name) || [];
    const outsideTestIds = new Set(
      targetRows.filter((row) => !isAllowedTenantRow(row)).map((row) => row.id),
    );
    for (const row of rows) {
      if (outsideTestIds.has(row.id))
        report.unresolved.push({
          scope: "id",
          collection: name,
          sourceId: row.id,
          reason: "ID nguồn đã tồn tại ngoài tenant test; cần mapping thủ công trước khi apply.",
        });
    }
  }
  const sourceUids = new Set(sourceUsers.map((user) => String(user.uid || "")).filter(Boolean));
  const sourceEmployeeCodes = new Set(
    sourceUsers.map((user) => String(user.employee_code || "")).filter(Boolean),
  );
  for (const rows of targetRowsByCollection.values()) {
    for (const row of rows.filter((item) => !isAllowedTenantRow(item))) {
      if (row.uid && sourceUids.has(String(row.uid)))
        report.unresolved.push({
          scope: "uid",
          targetId: row.id,
          uid: row.uid,
          reason: "UID nguồn đã tồn tại ngoài tenant test.",
        });
      if (row.employee_code && sourceEmployeeCodes.has(String(row.employee_code)))
        report.unresolved.push({
          scope: "employee_code",
          targetId: row.id,
          employee_code: row.employee_code,
          reason: "Mã nhân viên nguồn đã tồn tại ngoài tenant test.",
        });
    }
  }
  const usernameByUser = buildUsernames(sourceUsers.filter(isUserRecord));
  for (const user of sourceUsers.filter(isUserRecord)) {
    const id = targetIdsByCollection.get("users")?.has(user.id) ? undefined : user.id;
    const username = usernameByUser.get(user.id);
    report.mapping.users[user.id] = { id: id || "new", username, role: user.role || "user" };
    if (targetUsers.some((x) => x.username === username && !isAllowedTenantRow(x)))
      report.unresolved.push({
        scope: "user",
        sourceId: user.id,
        reason: `Username ${username} đã tồn tại ngoài tenant test.`,
      });
  }
  for (const user of sourceWorkerUsers)
    report.mapping.workers[user.id] = {
      id: targetIdsByCollection.get("workers")?.has(user.id) ? undefined : user.id,
      sourceUserId: user.id,
    };

  const sourceToTargetCollection = new Map();
  for (const [name] of sourceRecords)
    sourceToTargetCollection.set(name, targetByName.has(name) ? name : name);
  report.mapping.collections = Object.fromEntries(sourceToTargetCollection);

  // Kiểm tra relation trước khi ghi; các relation tới user được chuyển theo target field worker khi có.
  for (const [name, rows] of sourceRecords) {
    const sourceSchema = sourceByName.get(name);
    const targetSchema = targetByName.get(name);
    if (!targetSchema) {
      report.warnings.push({
        collection: name,
        reason: "Collection chưa có ở NewApp; cần tạo schema trước khi apply.",
      });
      continue;
    }
    const targetFields = targetFieldMap(targetSchema);
    for (const field of targetSchema.fields || []) {
      if (field.type !== "file" || !field.required) continue;
      for (const row of rows) {
        if (!fileValues(row[field.name]).length)
          report.unresolved.push({
            collection: name,
            recordId: row.id,
            field: field.name,
            reason: "Target yêu cầu file nhưng nguồn không có file.",
          });
      }
    }
    if (
      targetFields.get("submitter")?.type === "relation" &&
      targetFields.get("submitter")?.required
    ) {
      for (const row of rows) {
        if (!inferSourceUser(row, sourceUsers))
          report.unresolved.push({
            collection: name,
            recordId: row.id,
            field: "submitter",
            reason: "Không suy luận được người gửi duy nhất từ user, phone hoặc full_name.",
          });
      }
    }
    for (const field of sourceSchema.fields || []) {
      if (field.type !== "relation") continue;
      const targetName = relationTargetName(field, sourceCollections);
      for (const row of rows)
        for (const relId of relationValues(row[field.name])) {
          const known =
            targetName === "users"
              ? sourceUserById.has(relId)
              : sourceRecords.get(targetName)?.some((x) => x.id === relId);
          if (!known)
            report.unresolved.push({
              collection: name,
              recordId: row.id,
              field: field.name,
              relationId: relId,
              reason: "Không tìm thấy relation nguồn.",
            });
        }
      const workerAlias =
        field.name === "worker" &&
        (targetFields.has("worker") || targetFields.has("worker_profile"));
      if (
        !targetFields.has(field.name) &&
        !(field.name === "user" && targetFields.has("worker")) &&
        !workerAlias &&
        !(field.name === "user" && targetFields.has("submitter"))
      )
        report.unresolved.push({
          collection: name,
          field: field.name,
          reason: "Target thiếu field relation tương ứng.",
        });
    }
  }

  console.log(json(report));
  if (!APPLY) {
    await saveJson(path.join(backupDir, "migration-report.json"), report);
    await saveJson(
      path.join(TARGET_ROOT, "docs", "migration-audit", "latest-jobconnect-to-hl-preflight.json"),
      report,
    );
    console.log(
      "Dry-run: chưa thay đổi PocketBase. Backup nguồn đã được tạo nếu không dùng --no-backup.",
    );
    return;
  }
  if (report.unresolved.length)
    throw new Error(`Dừng apply: còn ${report.unresolved.length} unresolved/safety stop.`);
  if (testCompanies.length) {
    report.testTenantBackup = await backupTenant(
      target,
      testCompanies[0],
      backupDir,
      targetCollections,
    );
  }
  await writeCheckpoint(backupDir, report, "preflight");
  const company =
    hlCompanies[0] ||
    (await target.pb.collection("companies").create({
      code: HL_CODE,
      name: HL_NAME,
      status: "active",
      migration_run_id: MIGRATION_RUN_ID,
    }));
  report.companyId = company.id;
  if (!hlCompanies.length) report.created_ids.companies.push(company.id);
  await writeCheckpoint(backupDir, report, "company");
  const recordMaps = new Map();
  const userMap = new Map();
  const workerMap = new Map();
  let fallbackRoomId = "";
  const ensureFallbackRoom = async () => {
    if (fallbackRoomId) return fallbackRoomId;
    const roomPayload = {
      name: "Phòng chat cũ chưa phân loại",
      description: "Tự động tạo để giữ lại tin nhắn JobConnect không có room.",
      is_default: false,
      tenant_company: company.id,
      migration_run_id: MIGRATION_RUN_ID,
    };
    const room = await target.pb.collection("chat_rooms").create(roomPayload);
    fallbackRoomId = room.id;
    (report.created_ids.records.chat_rooms ||= []).push(room.id);
    return fallbackRoomId;
  };
  recordMaps.set("users", userMap);
  recordMaps.set("workers", workerMap);
  for (const user of sourceUsers.filter(isUserRecord)) {
    const payload = {
      username: usernameByUser.get(user.id),
      password: TEMP_PASSWORD,
      passwordConfirm: TEMP_PASSWORD,
      role: user.role === "user" || !user.role ? "user" : user.role,
      full_name: clean(user.full_name),
      phone: clean(user.phone),
      uid: clean(user.uid),
      cccd: clean(user.cccd),
      cccd_issue_date: clean(user.cccd_issue_date),
      gender: clean(user.gender),
      date_of_birth: clean(user.date_of_birth),
      address: clean(user.address),
      bank_name: clean(user.bank_name),
      bank_account_number: clean(user.bank_account_number),
      bank_account_name: clean(user.bank_account_name),
      bank_account_note: clean(user.bank_account_note),
      employee_code: clean(user.employee_code),
      status: user.status === "disabled" ? "disabled" : "active",
      must_change_password: true,
      tenant_company: company.id,
      migration_run_id: MIGRATION_RUN_ID,
    };
    if (!targetAnyIdsByCollection.get("users")?.has(user.id)) payload.id = user.id;
    const existingId = targetIdsByCollection.get("users")?.has(user.id) ? user.id : "";
    const created = existingId
      ? await target.pb.collection("users").update(existingId, payload)
      : await target.pb.collection("users").create(payload);
    userMap.set(user.id, created.id);
    if (!existingId) report.created_ids.users.push(created.id);
    await copyFiles(source, target, sourceByName.get("users"), user, "users", created.id);
  }
  for (const user of sourceWorkerUsers) {
    const workerPayload = {
      full_name: clean(user.full_name) || "NLĐ chưa có tên",
      phone: clean(user.phone),
      uid: clean(user.uid),
      cccd: clean(user.cccd),
      cccd_issue_date: clean(user.cccd_issue_date),
      gender: clean(user.gender),
      date_of_birth: clean(user.date_of_birth),
      address: clean(user.address),
      bank_name: clean(user.bank_name),
      bank_account_number: clean(user.bank_account_number),
      bank_account_name: clean(user.bank_account_name),
      bank_account_note: clean(user.bank_account_note),
      employee_code: clean(user.employee_code),
      status: user.status === "disabled" ? "inactive" : "active",
      source_user_id: user.id,
      tenant_company: company.id,
      migration_run_id: MIGRATION_RUN_ID,
    };
    if (!targetAnyIdsByCollection.get("workers")?.has(user.id)) workerPayload.id = user.id;
    const existingId = targetIdsByCollection.get("workers")?.has(user.id) ? user.id : "";
    const worker = existingId
      ? await target.pb.collection("workers").update(existingId, workerPayload)
      : await target.pb.collection("workers").create(workerPayload);
    workerMap.set(user.id, worker.id);
    if (!existingId) report.created_ids.workers.push(worker.id);
  }
  report.created = { company: 1, users: userMap.size, workers: workerMap.size, records: {} };
  await writeCheckpoint(backupDir, report, "users-workers");
  const pending = new Set(
    [...sourceRecords.keys()].filter((name) => name !== "users" && targetByName.has(name)),
  );
  const order = [];
  while (pending.size) {
    const next = [...pending].filter((name) =>
      relationDependencies(sourceByName.get(name), sourceCollections).every(
        (dependency) => !pending.has(dependency),
      ),
    );
    if (!next.length)
      throw new Error(`Không thể sắp xếp dependency cho: ${[...pending].join(", ")}`);
    order.push(...next);
    next.forEach((name) => pending.delete(name));
  }
  for (const name of order) {
    const targetSchema = targetByName.get(name);
    if (!targetSchema) continue;
    if (!recordMaps.has(name)) recordMaps.set(name, new Map());
    const recordMap = recordMaps.get(name);
    const sourceSchema = sourceByName.get(name);
    const fields = targetFieldMap(targetSchema);
    let count = 0;
    for (const row of sourceRecords.get(name) || []) {
      const payload = {};
      for (const [key, value] of Object.entries(row)) {
        const field = fields.get(key);
        if (
          !field ||
          ["id", "created", "updated", "collectionId", "collectionName", "expand"].includes(key) ||
          field.type === "file"
        )
          continue;
        let next = value;
        if (field.type === "relation") {
          const sourceField = (sourceSchema.fields || []).find((f) => f.name === key);
          const sourceCollection = sourceField
            ? relationTargetName(sourceField, sourceCollections)
            : "";
          const map =
            sourceCollection === "companies"
              ? new Map()
              : recordMaps.get(sourceCollection) || new Map();
          if (key === "user" && fields.has("worker")) continue;
          if (
            !relationValues(value).length &&
            key === "room" &&
            sourceCollection === "chat_rooms" &&
            (name === "group_chat_messages" || name === "chat_room_members")
          ) {
            next = [await ensureFallbackRoom()];
          } else {
            next = relationValues(value).map((id) =>
              mapRelationId(sourceCollection, id, recordMaps),
            );
          }
          if (relationValues(value).some((id) => !map.get(id)))
            throw new Error(`Relation ${name}.${key} chưa có mapping cho ${sourceCollection}.`);
          next = Array.isArray(value) ? next : next[0] || "";
        }
        payload[key] = next;
      }
      const inferredUser = inferSourceUser(row, sourceUsers);
      const sourceUser = row.user || row.worker || inferredUser?.id;
      if (fields.has("worker") && sourceUser)
        payload.worker = workerMap.get(sourceUser) || workerMap.get(row.worker) || "";
      if (fields.has("worker_profile") && sourceUser)
        payload.worker_profile = workerMap.get(sourceUser) || "";
      if (fields.has("tenant_company")) payload.tenant_company = company.id;
      if (fields.has("migration_run_id")) payload.migration_run_id = MIGRATION_RUN_ID;
      if (fields.has("company") && fields.get("company").type === "relation")
        payload.company = company.id;
      if (fields.has("user") && row.user) payload.user = userMap.get(row.user) || row.user;
      if (fields.has("submitter") && row.user)
        payload.submitter = userMap.get(row.user) || row.user;
      if (fields.has("submitter") && !payload.submitter && inferredUser)
        payload.submitter = userMap.get(inferredUser.id) || "";
      if (!targetAnyIdsByCollection.get(name)?.has(row.id)) payload.id = row.id;
      const existingId = targetIdsByCollection.get(name)?.has(row.id) ? row.id : "";
      let created;
      const fileFields = (sourceSchema?.fields || []).filter((field) => field.type === "file");
      const createBody =
        !existingId &&
        fileFields.some((field) => field.required && fileValues(row[field.name]).length)
          ? await buildRecordFormData(source, sourceSchema, row, payload)
          : payload;
      try {
        created = existingId
          ? await target.pb.collection(name).update(existingId, payload)
          : await target.pb.collection(name).create(createBody);
      } catch (error) {
        const response = error?.response?.data || {};
        const fields = Object.fromEntries(
          Object.entries(response).map(([field, detail]) => [field, detail?.message || detail]),
        );
        throw new Error(
          `Không tạo/cập nhật được ${name}/${row.id}: ${error?.status || "unknown"} ${
            error?.message || "PocketBase error"
          }${Object.keys(fields).length ? `; fields=${JSON.stringify(fields)}` : ""}`,
        );
      }
      count++;
      recordMap.set(row.id, created.id);
      if (!existingId) (report.created_ids.records[name] ||= []).push(created.id);
      if (createBody === payload)
        await copyFiles(source, target, sourceSchema, row, name, created.id);
    }
    report.created.records[name] = count;
    await writeCheckpoint(backupDir, report, name);
  }
  const hlRows = await target.pb
    .collection("users")
    .getFullList({
      filter: `tenant_company="${company.id}" && migration_run_id="${MIGRATION_RUN_ID}"`,
      fields: "id,must_change_password,tenant_company",
    })
    .catch(() => []);
  const audit = {
    usersMissingPasswordChange: hlRows
      .filter((row) => row.must_change_password !== true)
      .map((row) => row.id),
    usersOutsideHl: hlRows.filter((row) => row.tenant_company !== company.id).map((row) => row.id),
  };
  report.postApplyAudit = audit;
  if (audit.usersMissingPasswordChange.length || audit.usersOutsideHl.length)
    throw new Error(
      "Post-apply audit thất bại: tài khoản HL không đạt must_change_password/tenant.",
    );
  await saveJson(path.join(backupDir, "migration-report.json"), {
    ...report,
    tempPassword: undefined,
  });
  console.log(json(report));
}

export { buildUsernames, mapRelationId, relationDependencies };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
