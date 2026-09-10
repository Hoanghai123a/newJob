import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  allocateUidPlan,
  buildRollbackRows,
  connectPocketBase,
  countBy,
  duplicateGroups,
  normalizeUid,
  parseArgs,
  rankDuplicateUsers,
  readCsv,
  safeFullList,
  scoreDuplicateUser,
  timestampName,
  isBatchRequestsNotAllowed,
  writeCsv,
} from "./uid-duplicate-tools.mjs";

const MAX_BATCH_REQUESTS = 40;
const USER_FIELDS =
  "id,uid,username,full_name,phone,cccd,status,created,last_login,role,approved,approvalStatus";
const ROLLBACK_COLUMNS = ["user_id", "restore_uid", "applied_uid", "username", "full_name"];
const PLAN_COLUMNS = [
  "approved",
  "decision",
  "old_uid",
  "new_uid",
  "user_id",
  "keeper_user_id",
  "username",
  "full_name",
  "phone",
  "cccd",
  "status",
  "created",
  "last_login",
  "active_employment",
  "employment_count",
  "attendance_count",
  "advance_count",
  "salary_hold_count",
  "check_attendance_count",
  "check_salary_count",
  "relation_count",
  "score",
  "risk",
  "reason",
];

function escapePb(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function jsonStable(value) {
  return JSON.stringify(value);
}

function normalizedRelationValues(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean).sort();
  return value ? [String(value)] : [];
}

async function loadRelationMeta(pb) {
  const collections = await pb.collections.getFullList();
  const usersCollection = collections.find((collection) => collection.name === "users");
  if (!usersCollection) throw new Error("Không tìm thấy collection users.");

  const relationFields = [];
  const unsupportedUidFields = [];
  for (const collection of collections) {
    for (const field of collection.fields || []) {
      if (field.type === "relation" && field.collectionId === usersCollection.id) {
        relationFields.push({ collection: collection.name, field: field.name });
      }
      if (
        field.type === "text" &&
        /uid/i.test(field.name) &&
        !(
          (collection.name === "users" && field.name === "uid") ||
          (collection.name === "employment_histories" && field.name === "uid")
        )
      ) {
        unsupportedUidFields.push({ collection: collection.name, field: field.name });
      }
    }
  }
  return { collections, usersCollection, relationFields, unsupportedUidFields };
}

async function captureRelationSnapshot(pb, relationFields) {
  const byCollection = new Map();
  const grouped = new Map();
  for (const item of relationFields) {
    grouped.set(item.collection, [...(grouped.get(item.collection) || []), item.field]);
  }
  for (const [collection, fields] of grouped) {
    let records;
    try {
      records = await pb.collection(collection).getFullList({
        fields: `id,${[...new Set(fields)].join(",")}`,
      });
    } catch (error) {
      throw new Error(
        `Không thể chụp relation ${collection}: ${error?.message || "không đọc được"}`,
      );
    }
    byCollection.set(
      collection,
      records
        .map((record) => {
          const values = {};
          for (const field of fields) values[field] = normalizedRelationValues(record[field]);
          return { id: record.id, values };
        })
        .sort((a, b) => String(a.id).localeCompare(String(b.id))),
    );
  }
  return byCollection;
}

function relationSnapshotsEqual(before, after) {
  if (before.size !== after.size) return false;
  for (const [collection, beforeRecords] of before) {
    if (jsonStable(beforeRecords) !== jsonStable(after.get(collection))) return false;
  }
  return true;
}

function relationCounts(snapshot) {
  const counts = new Map();
  for (const records of snapshot.values()) {
    for (const record of records) {
      for (const values of Object.values(record.values)) {
        for (const userId of values) counts.set(userId, (counts.get(userId) || 0) + 1);
      }
    }
  }
  return counts;
}

function relationSnapshotSummary(snapshot) {
  return [...snapshot.entries()].map(([collection, records]) => ({
    collection,
    record_count: records.length,
    relation_value_count: records.reduce(
      (total, record) =>
        total + Object.values(record.values).reduce((sum, values) => sum + values.length, 0),
      0,
    ),
    sha256: crypto.createHash("sha256").update(jsonStable(records)).digest("hex"),
  }));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function assertNoUnsupportedUidFields(meta) {
  if (!meta.unsupportedUidFields.length) return;
  const fields = meta.unsupportedUidFields
    .map((item) => `${item.collection}.${item.field}`)
    .join(", ");
  throw new Error(
    `Phát hiện trường văn bản UID chưa được khai báo quy tắc cập nhật: ${fields}. Dừng để tránh sai logic.`,
  );
}

function readReferenceList(filePath, currentUsers) {
  if (!filePath) return null;
  const text = fs.readFileSync(path.resolve(filePath), "utf8");
  const rawValues = text
    .split(/\r?\n/)
    .map((value) => value.trim().replace(/^\uFEFF/, ""))
    .filter(Boolean);
  const values = rawValues.filter((value) => !/uid|mã tài khoản/i.test(value));
  const normalized = values.map(normalizeUid);
  const groups = new Map();
  for (const uid of normalized) groups.set(uid, (groups.get(uid) || 0) + 1);
  const current = new Set(currentUsers.map((user) => normalizeUid(user.uid)).filter(Boolean));
  return {
    rows: values.length,
    unique: groups.size,
    duplicateValues: [...groups.values()].filter((count) => count > 1).length,
    invalidValues: [...new Set(normalized.filter((uid) => !/^[A-Z]+\d{6}$/.test(uid)))],
    listedButMissing: [...groups.keys()].filter((uid) => !current.has(uid)),
    currentNotListed: [...current].filter((uid) => !groups.has(uid)),
  };
}

function buildMetrics(records) {
  const byUser = (collection, field) => countBy(records[collection] || [], field);
  return {
    employment: byUser("employment_histories", "user"),
    attendance: byUser("attendance", "user"),
    advances: byUser("advances", "user"),
    salaryHolds: byUser("salary_holds", "worker"),
    checkAttendance: byUser("check_attendance_items", "user"),
    checkSalary: byUser("check_salary_items", "user"),
  };
}

async function loadPlanningData(pb, users) {
  const [histories, attendance, advances, salaryHolds, checkAttendance, checkSalary] =
    await Promise.all([
      safeFullList(pb, "employment_histories", { fields: "id,user,leave_date,status" }),
      safeFullList(pb, "attendance", { fields: "id,user" }),
      safeFullList(pb, "advances", { fields: "id,user" }),
      safeFullList(pb, "salary_holds", { fields: "id,worker" }),
      safeFullList(pb, "check_attendance_items", { fields: "id,user" }),
      safeFullList(pb, "check_salary_items", { fields: "id,user" }),
    ]);
  const records = {
    employment_histories: histories,
    attendance,
    advances,
    salary_holds: salaryHolds,
    check_attendance_items: checkAttendance,
    check_salary_items: checkSalary,
  };
  const metrics = buildMetrics(records);
  const activeUsers = new Set(
    histories
      .filter((item) => !item.leave_date && (!item.status || item.status === "working"))
      .map((item) => item.user)
      .filter(Boolean),
  );
  return { metrics, activeUsers };
}

async function getUserCounter(pb, prefix) {
  const key = `user:${prefix}`;
  return pb
    .collection("uid_counters")
    .getFirstListItem(`counter_key="${escapePb(key)}"`, { fields: "id,current_value" })
    .catch(() => null);
}

async function getConfiguredPrefix(pb) {
  const settings = await pb
    .collection("app_settings")
    .getList(1, 1, { fields: "account_code_prefix" })
    .catch(() => ({ items: [] }));
  const prefix = normalizeUid(settings.items[0]?.account_code_prefix);
  if (!prefix) throw new Error("app_settings.account_code_prefix đang để trống.");
  return prefix;
}

async function buildAutoPlan(pb, args) {
  const users = await pb
    .collection("users")
    .getFullList({ fields: USER_FIELDS, sort: "uid,created" });
  const groups = duplicateGroups(users);
  const relationMeta = await loadRelationMeta(pb);
  assertNoUnsupportedUidFields(relationMeta);
  const relationSnapshot = await captureRelationSnapshot(pb, relationMeta.relationFields);
  const relationCountByUser = relationCounts(relationSnapshot);
  const { metrics, activeUsers } = await loadPlanningData(pb, users);
  const reference = readReferenceList(args.referenceList, users);

  if (!groups.size) {
    return { users, groups, planned: [], relationMeta, relationSnapshot, reference, prefix: "" };
  }

  const prefix = await getConfiguredPrefix(pb);
  const counter = await getUserCounter(pb, prefix);
  if (args.apply && !counter) {
    throw new Error("Chưa có bộ đếm UID user. Hãy chạy pb:init-uid-counters trước.");
  }

  const rankedGroups = [];
  let changeCount = 0;
  for (const [oldUid, members] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const ranked = rankDuplicateUsers(members, metrics, activeUsers);
    rankedGroups.push({ oldUid, members, ranked });
    changeCount += ranked.length - 1;
  }
  const allocation = allocateUidPlan({
    users,
    count: changeCount,
    prefix,
    counterValue: counter?.current_value || 0,
  });
  let uidIndex = 0;
  const planned = [];
  for (const { oldUid, members, ranked } of rankedGroups) {
    const keeper = ranked[0];
    const cccds = new Map();
    const phones = new Map();
    for (const user of members) {
      if (user.cccd) cccds.set(user.cccd, (cccds.get(user.cccd) || 0) + 1);
      if (user.phone) phones.set(user.phone, (phones.get(user.phone) || 0) + 1);
    }
    const groupRisk =
      members.length >= 5 ||
      [...cccds.values()].some((count) => count > 1) ||
      [...phones.values()].some((count) => count > 1) ||
      ranked.filter((user) => activeUsers.has(user.id)).length > 1;
    for (const user of ranked) {
      const keep = user.id === keeper.id;
      const score = scoreDuplicateUser(user, metrics, activeUsers);
      const reasons = [];
      if (activeUsers.has(user.id)) reasons.push("đang làm");
      if (metrics.employment.get(user.id))
        reasons.push(`${metrics.employment.get(user.id)} lịch sử`);
      if (user.cccd && cccds.get(user.cccd) > 1) reasons.push("trùng CCCD trong nhóm");
      if (user.phone && phones.get(user.phone) > 1) reasons.push("trùng SĐT trong nhóm");
      planned.push({
        approved: args.auto ? "YES" : "NO",
        decision: keep ? "KEEP" : "CHANGE",
        old_uid: oldUid,
        new_uid: keep ? "" : allocation.uids[uidIndex++],
        original_uid: user.uid || oldUid,
        user_id: user.id,
        keeper_user_id: keeper.id,
        username: user.username || "",
        full_name: user.full_name || "",
        phone: user.phone || "",
        cccd: user.cccd || "",
        status: user.status || "",
        created: user.created || "",
        last_login: user.last_login || "",
        active_employment: activeUsers.has(user.id) ? "YES" : "NO",
        employment_count: metrics.employment.get(user.id) || 0,
        attendance_count: metrics.attendance.get(user.id) || 0,
        advance_count: metrics.advances.get(user.id) || 0,
        salary_hold_count: metrics.salaryHolds.get(user.id) || 0,
        check_attendance_count: metrics.checkAttendance.get(user.id) || 0,
        check_salary_count: metrics.checkSalary.get(user.id) || 0,
        relation_count: relationCountByUser.get(user.id) || 0,
        score,
        risk: groupRisk ? "REVIEW" : "NORMAL",
        reason: `${keep ? "Giữ UID hiện tại" : "Cấp UID mới"}${reasons.length ? `; ${reasons.join("; ")}` : ""}`,
      });
    }
  }
  return {
    users,
    groups,
    planned,
    relationMeta,
    relationSnapshot,
    reference,
    prefix,
    counter,
    allocation,
  };
}

async function buildManualPlan(pb, args) {
  if (!args.input) throw new Error("Thiếu --input <file CSV đã duyệt> hoặc dùng --auto.");
  const rows = readCsv(path.resolve(args.input));
  if (!rows.length) throw new Error("CSV không có dữ liệu.");
  const required = ["approved", "decision", "old_uid", "new_uid", "user_id"];
  for (const field of required) if (!(field in rows[0])) throw new Error(`CSV thiếu cột ${field}.`);
  const users = await pb.collection("users").getFullList({ fields: USER_FIELDS });
  const userById = new Map(users.map((user) => [user.id, user]));
  const currentUidOwners = new Map();
  for (const user of users) {
    const uid = normalizeUid(user.uid);
    if (uid) currentUidOwners.set(uid, [...(currentUidOwners.get(uid) || []), user.id]);
  }
  const groupedRows = new Map();
  for (const raw of rows) {
    const row = Object.fromEntries(
      Object.entries(raw).map(([key, value]) => [key, String(value || "").trim()]),
    );
    row.approved = row.approved.toUpperCase();
    row.decision = row.decision.toUpperCase();
    row.old_uid = normalizeUid(row.old_uid);
    row.new_uid = normalizeUid(row.new_uid);
    if (!row.old_uid || !row.user_id) throw new Error("Mỗi dòng phải có old_uid và user_id.");
    groupedRows.set(row.old_uid, [...(groupedRows.get(row.old_uid) || []), row]);
  }
  const errors = [];
  const planned = [];
  const reservedNewUids = new Set();
  for (const [oldUid, group] of groupedRows) {
    if (group.some((row) => row.approved !== "YES"))
      errors.push(`${oldUid}: toàn bộ dòng trong nhóm phải approved=YES.`);
    const keepers = group.filter((row) => row.decision === "KEEP");
    if (keepers.length !== 1) errors.push(`${oldUid}: phải có đúng một dòng decision=KEEP.`);
    for (const row of group) {
      if (row.decision !== "KEEP" && row.decision !== "CHANGE")
        errors.push(`${oldUid}/${row.user_id}: decision chỉ được KEEP hoặc CHANGE.`);
      const user = userById.get(row.user_id);
      if (!user) {
        errors.push(`${oldUid}/${row.user_id}: không còn tồn tại trong users.`);
        continue;
      }
      if (normalizeUid(user.uid) !== oldUid)
        errors.push(`${oldUid}/${row.user_id}: UID hiện tại đã thay đổi.`);
      if (row.decision === "KEEP" && row.new_uid)
        errors.push(`${oldUid}/${row.user_id}: dòng KEEP phải để trống new_uid.`);
      if (row.decision === "CHANGE") {
        if (!row.new_uid) errors.push(`${oldUid}/${row.user_id}: dòng CHANGE thiếu new_uid.`);
        if (row.new_uid === oldUid)
          errors.push(`${oldUid}/${row.user_id}: new_uid phải khác old_uid.`);
        if (reservedNewUids.has(row.new_uid)) errors.push(`${row.new_uid}: bị dùng lặp trong CSV.`);
        reservedNewUids.add(row.new_uid);
        const owners = currentUidOwners.get(row.new_uid) || [];
        if (owners.some((id) => id !== row.user_id))
          errors.push(`${row.new_uid}: đã được tài khoản khác sử dụng.`);
        planned.push({
          ...row,
          original_uid: user.uid || oldUid,
          username: user.username || "",
          full_name: user.full_name || "",
        });
      }
    }
  }
  const liveDuplicateGroups = duplicateGroups(users);
  for (const uid of liveDuplicateGroups.keys()) {
    if (!groupedRows.has(uid))
      errors.push(`${uid}: đang trùng trên PocketBase nhưng không có trong CSV duyệt.`);
  }
  if (errors.length) throw new Error(`CSV chưa hợp lệ:\n${errors.join("\n")}`);
  const relationMeta = await loadRelationMeta(pb);
  assertNoUnsupportedUidFields(relationMeta);
  const relationSnapshot = await captureRelationSnapshot(pb, relationMeta.relationFields);
  const prefix = await getConfiguredPrefix(pb);
  const counter = await getUserCounter(pb, prefix);
  return {
    users,
    planned,
    relationMeta,
    relationSnapshot,
    groups: liveDuplicateGroups,
    reference: null,
    prefix,
    counter,
  };
}

async function ensureNormalizedUidIndex(pb, dryRun = false) {
  const collection = await pb.collections.getOne("users");
  const indexName = "idx_users_uid_normalized_unique";
  const desired =
    "CREATE UNIQUE INDEX `idx_users_uid_normalized_unique` ON `users` (UPPER(TRIM(uid))) WHERE TRIM(uid) != ''";
  const existing = (collection.indexes || []).find((index) => index.includes(indexName));
  const ready = Boolean(existing && /UPPER\s*\(\s*TRIM\s*\(\s*uid\s*\)\s*\)/i.test(existing));
  if (ready || dryRun) return { ready, changed: false };
  const indexes = (collection.indexes || []).filter((index) => !index.includes(indexName));
  await pb.collections.update(collection.id, { indexes: [...indexes, desired] });
  return { ready: true, changed: true };
}

async function updateUsersInBatches(pb, planned, applied = []) {
  for (let offset = 0; offset < planned.length; offset += MAX_BATCH_REQUESTS) {
    const batch = pb.createBatch();
    const chunk = planned.slice(offset, offset + MAX_BATCH_REQUESTS);
    for (const item of chunk) batch.collection("users").update(item.user_id, { uid: item.new_uid });
    try {
      await batch.send();
      applied.push(...chunk);
    } catch (error) {
      if (!isBatchRequestsNotAllowed(error)) throw error;
      console.warn("PocketBase không hỗ trợ batch; chuyển sang cập nhật tuần tự lô hiện tại.");
      for (const item of chunk) {
        await pb.collection("users").update(item.user_id, { uid: item.new_uid });
        applied.push(item);
      }
    }
    console.log(
      `Đã cập nhật lô ${Math.floor(offset / MAX_BATCH_REQUESTS) + 1}: ${chunk.length} tài khoản.`,
    );
  }
  return applied;
}

async function rollbackUsers(pb, planned) {
  const current = await pb.collection("users").getFullList({ fields: "id,uid" });
  const byId = new Map(current.map((user) => [user.id, user]));
  const candidates = planned.filter(
    (item) => normalizeUid(byId.get(item.user_id)?.uid) === normalizeUid(item.new_uid),
  );
  for (let offset = 0; offset < candidates.length; offset += MAX_BATCH_REQUESTS) {
    const batch = pb.createBatch();
    const chunk = candidates.slice(offset, offset + MAX_BATCH_REQUESTS);
    for (const item of chunk) {
      batch.collection("users").update(item.user_id, { uid: item.original_uid ?? item.old_uid });
    }
    try {
      await batch.send();
    } catch (error) {
      if (!isBatchRequestsNotAllowed(error)) throw error;
      for (const item of chunk) {
        await pb
          .collection("users")
          .update(item.user_id, { uid: item.original_uid ?? item.old_uid });
      }
    }
  }
  return candidates.length;
}

async function validateAfterApply(pb, beforeUsers, planned, relationBefore, relationMeta) {
  const afterUsers = await pb.collection("users").getFullList({ fields: "id,uid" });
  const afterById = new Map(afterUsers.map((user) => [user.id, user]));
  const errors = [];
  for (const item of planned) {
    if (normalizeUid(afterById.get(item.user_id)?.uid) !== normalizeUid(item.new_uid)) {
      errors.push(`${item.user_id}: UID mới không đúng.`);
    }
  }
  for (const user of beforeUsers) {
    const changed = planned.some((item) => item.user_id === user.id);
    if (!changed && normalizeUid(afterById.get(user.id)?.uid) !== normalizeUid(user.uid)) {
      errors.push(`${user.id}: UID không thuộc kế hoạch đã bị thay đổi.`);
    }
  }
  const remaining = duplicateGroups(afterUsers);
  if (remaining.size) errors.push(`Còn ${remaining.size} nhóm UID trùng.`);
  const relationAfter = await captureRelationSnapshot(pb, relationMeta.relationFields);
  if (!relationSnapshotsEqual(relationBefore, relationAfter))
    errors.push("Relation tới users.id đã thay đổi ngoài kế hoạch.");
  return { errors, afterUsers, relationAfter };
}

async function main() {
  const args = parseArgs();
  if (args.auto && args.input) throw new Error("Không dùng đồng thời --auto và --input.");
  if (!args.auto && !args.input) throw new Error("Thiếu --auto hoặc --input <file CSV đã duyệt>.");
  const pb = await connectPocketBase({ requireExplicitUrl: args.apply });
  const outputDir = path.resolve(args.outputDir);
  const baseName = timestampName(
    args.apply ? "duplicate-user-uids-applied" : "duplicate-user-uids-dry-run",
  );
  const planPath = path.join(outputDir, `${baseName}.csv`);
  const rollbackPath = path.join(outputDir, `${baseName}-rollback.csv`);
  const relationPath = path.join(outputDir, `${baseName}-relations.json`);
  const referencePath = path.join(outputDir, `${baseName}-reference-list.json`);
  let context;
  try {
    context = args.auto ? await buildAutoPlan(pb, args) : await buildManualPlan(pb, args);
    const planRows = context.planned.length ? context.planned : [];
    writeCsv(
      planPath,
      planRows,
      args.auto ? PLAN_COLUMNS : ["old_uid", "new_uid", "user_id", "username", "full_name"],
    );
    writeCsv(rollbackPath, [], ROLLBACK_COLUMNS);
    writeJson(relationPath, {
      before: relationSnapshotSummary(context.relationSnapshot),
      after: null,
      unchanged: null,
    });
    if (context.reference) writeJson(referencePath, context.reference);
    const referenceReport = context.reference
      ? {
          referenceList: {
            rows: context.reference.rows,
            unique: context.reference.unique,
            duplicateValues: context.reference.duplicateValues,
            invalidValues: context.reference.invalidValues,
            listedButMissingCount: context.reference.listedButMissing.length,
            currentNotListedCount: context.reference.currentNotListed.length,
            report: referencePath,
          },
        }
      : {};
    if (!args.apply) {
      console.log(
        JSON.stringify(
          {
            valid: true,
            mode: "dry-run",
            auto: args.auto,
            duplicateGroups: context.groups.size,
            updates: context.planned.filter((item) => item.decision === "CHANGE").length,
            plan: planPath,
            relationReport: relationPath,
            ...referenceReport,
          },
          null,
          2,
        ),
      );
      console.log("Không có dữ liệu PocketBase nào bị thay đổi. Thêm --apply để thực hiện.");
      return;
    }
    if (!process.env.PB_URL) throw new Error("Khi chạy --apply, bắt buộc cấu hình PB_URL rõ ràng.");
    const changed = context.planned.filter((item) => item.decision === "CHANGE");
    if (!changed.length) {
      const index = await ensureNormalizedUidIndex(pb);
      writeJson(relationPath, {
        before: relationSnapshotSummary(context.relationSnapshot),
        after: relationSnapshotSummary(context.relationSnapshot),
        unchanged: true,
      });
      console.log(
        JSON.stringify(
          {
            valid: true,
            mode: "apply",
            updated: 0,
            remainingDuplicateGroups: 0,
            relationReport: relationPath,
            normalizedIndex: index,
            ...referenceReport,
          },
          null,
          2,
        ),
      );
      return;
    }
    const currentUsers = await pb.collection("users").getFullList({ fields: USER_FIELDS });
    const byId = new Map(currentUsers.map((user) => [user.id, user]));
    const liveUidOwners = new Map();
    for (const user of currentUsers) {
      const uid = normalizeUid(user.uid);
      if (uid) liveUidOwners.set(uid, [...(liveUidOwners.get(uid) || []), user.id]);
    }
    for (const initialUser of context.users) {
      const currentUser = byId.get(initialUser.id);
      if (!currentUser || normalizeUid(currentUser.uid) !== normalizeUid(initialUser.uid)) {
        throw new Error(
          `${initialUser.id}: d? li?u UID ?? thay ??i k? t? l?c l?p k? ho?ch. H?y ch?y l?i.`,
        );
      }
    }
    const liveRelationSnapshot = await captureRelationSnapshot(
      pb,
      context.relationMeta.relationFields,
    );
    if (!relationSnapshotsEqual(context.relationSnapshot, liveRelationSnapshot)) {
      throw new Error("Relation t?i users.id ?? thay ??i k? t? l?c l?p k? ho?ch. H?y ch?y l?i.");
    }
    const escapedPrefix = context.prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const prefixPattern = new RegExp(`^${escapedPrefix}(\\d{6})$`);
    for (const item of changed) {
      if (!prefixPattern.test(item.new_uid)) {
        throw new Error(`UID mới ${item.new_uid} không đúng định dạng ${context.prefix}000001.`);
      }
      const owners = liveUidOwners.get(normalizeUid(item.new_uid)) || [];
      if (owners.some((id) => id !== item.user_id)) {
        throw new Error(`UID mới ${item.new_uid} vừa được tài khoản khác sử dụng. Hãy chạy lại.`);
      }
    }
    const counter = await getUserCounter(pb, context.prefix);
    if (!counter) throw new Error("Chưa có bộ đếm UID user. Hãy chạy pb:init-uid-counters trước.");
    const sequences = changed.map((item) => Number(item.new_uid.match(prefixPattern)?.[1] || 0));
    const lastSequence = Math.max(...sequences);
    if (Number(counter.current_value || 0) >= Math.min(...sequences))
      throw new Error("Bộ đếm UID đã tiến tới dải kế hoạch. Hãy chạy lại.");
    writeCsv(rollbackPath, buildRollbackRows(changed), ROLLBACK_COLUMNS);
    await pb
      .collection("uid_counters")
      .update(counter.id, { current_value: lastSequence, note: "Giữ dải UID cho repair tự động" });
    const applied = [];
    let validation;
    try {
      await updateUsersInBatches(pb, changed, applied);
      validation = await validateAfterApply(
        pb,
        currentUsers,
        changed,
        context.relationSnapshot,
        context.relationMeta,
      );
      writeJson(relationPath, {
        before: relationSnapshotSummary(context.relationSnapshot),
        after: relationSnapshotSummary(validation.relationAfter),
        unchanged: relationSnapshotsEqual(context.relationSnapshot, validation.relationAfter),
      });
      if (validation.errors.length) throw new Error(validation.errors.join("\n"));
    } catch (error) {
      const rollbackCount = await rollbackUsers(pb, applied).catch(() => 0);
      throw new Error(
        `${error?.message || "Cập nhật UID thất bại"}. Đã khôi phục ${rollbackCount} tài khoản. File đối chiếu: ${rollbackPath}`,
      );
    }

    const verifiedCounter = await getUserCounter(pb, context.prefix);
    if (Number(verifiedCounter?.current_value || 0) < lastSequence) {
      throw new Error(
        `Bộ đếm UID chưa được cập nhật tới UID mới cao nhất. Dùng file khôi phục: ${rollbackPath}`,
      );
    }
    let index;
    try {
      index = await ensureNormalizedUidIndex(pb);
    } catch (error) {
      throw new Error(
        `${error?.message || "Không tạo được unique index UID chuẩn hóa"}. UID đã được cập nhật; dùng file khôi phục nếu cần: ${rollbackPath}`,
      );
    }
    console.log(
      JSON.stringify(
        {
          valid: true,
          mode: "apply",
          auto: args.auto,
          updated: changed.length,
          remainingDuplicateGroups: 0,
          plan: planPath,
          rollback: rollbackPath,
          relationReport: relationPath,
          normalizedIndex: index,
          ...referenceReport,
        },
        null,
        2,
      ),
    );
  } finally {
    pb.authStore.clear();
  }
}

await main();
