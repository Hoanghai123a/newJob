import fs from "node:fs";
import path from "node:path";
import PocketBase from "pocketbase";

export const AUDIT_COLUMNS = [
  "approved",
  "decision",
  "old_uid",
  "new_uid",
  "user_id",
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
  "score",
  "risk",
  "reason",
];

export function parseArgs(argv = process.argv.slice(2)) {
  const result = {
    apply: false,
    auto: false,
    input: "",
    outputDir: "uid-audit-output",
    referenceList: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") result.apply = true;
    else if (arg === "--auto") result.auto = true;
    else if (arg === "--input") result.input = argv[++index] || "";
    else if (arg === "--output-dir") result.outputDir = argv[++index] || result.outputDir;
    else if (arg === "--reference-list") result.referenceList = argv[++index] || "";
    else if (arg.startsWith("--input=")) result.input = arg.slice(8);
    else if (arg.startsWith("--output-dir=")) result.outputDir = arg.slice(13);
    else if (arg.startsWith("--reference-list=")) result.referenceList = arg.slice(17);
  }
  return result;
}

export async function connectPocketBase({ requireExplicitUrl = false } = {}) {
  if (requireExplicitUrl && !process.env.PB_URL) {
    throw new Error("Khi chạy --apply, bắt buộc cấu hình PB_URL rõ ràng cho PocketBase đích.");
  }
  const baseUrl = process.env.PB_URL || process.env.VITE_PB_URL || "http://127.0.0.1:8290";
  const identity = process.env.PB_ADMIN_EMAIL;
  const password = process.env.PB_ADMIN_PASSWORD;
  const token = process.env.PB_ADMIN_TOKEN;
  if (!token && (!identity || !password)) {
    throw new Error("Thiếu PB_ADMIN_TOKEN hoặc PB_ADMIN_EMAIL/PB_ADMIN_PASSWORD.");
  }
  const pb = new PocketBase(baseUrl);
  pb.autoCancellation(false);
  if (token) pb.authStore.save(token, null);
  else {
    await pb
      .collection("_superusers")
      .authWithPassword(identity, password)
      .catch(async () => {
        await pb.admins.authWithPassword(identity, password);
      });
  }
  return pb;
}

export function normalizeUid(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

export function duplicateGroups(users) {
  const groups = new Map();
  for (const user of users) {
    const uid = normalizeUid(user.uid);
    if (!uid) continue;
    groups.set(uid, [...(groups.get(uid) || []), user]);
  }
  return new Map([...groups].filter(([, items]) => items.length > 1));
}

export function scoreDuplicateUser(user, metrics, activeUsers) {
  return (
    Number(activeUsers.has(user.id)) * 10000 +
    (metrics.employment.get(user.id) || 0) * 500 +
    (metrics.attendance.get(user.id) || 0) * 10 +
    (metrics.checkAttendance.get(user.id) || 0) * 10 +
    (metrics.checkSalary.get(user.id) || 0) * 20 +
    (metrics.advances.get(user.id) || 0) * 30 +
    (metrics.salaryHolds.get(user.id) || 0) * 30 +
    Number(Boolean(user.cccd)) * 5 +
    Number(Boolean(user.phone)) * 3 +
    Number(Boolean(user.last_login)) * 2
  );
}

export function rankDuplicateUsers(users, metrics, activeUsers) {
  return [...users].sort(
    (a, b) =>
      scoreDuplicateUser(b, metrics, activeUsers) - scoreDuplicateUser(a, metrics, activeUsers) ||
      String(a.created || "").localeCompare(String(b.created || "")) ||
      String(a.id).localeCompare(String(b.id)),
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function allocateUidPlan({ users, count, prefix, counterValue }) {
  const normalizedPrefix = normalizeUid(prefix);
  if (!normalizedPrefix) throw new Error("Tiền tố UID hệ thống đang để trống.");
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("Số UID cần cấp không hợp lệ.");
  const pattern = new RegExp(`^${escapeRegExp(normalizedPrefix)}(\\d{6})$`);
  const used = new Set(users.map((user) => normalizeUid(user.uid)).filter(Boolean));
  let next = Math.max(
    Number(counterValue || 0),
    0,
    ...[...used].map((uid) => Number(uid.match(pattern)?.[1] || 0)),
  );
  const uids = [];
  while (uids.length < count) {
    next += 1;
    if (next > 999999) throw new Error("Đã vượt giới hạn 999999 UID cho tiền tố hiện tại.");
    const uid = `${normalizedPrefix}${String(next).padStart(6, "0")}`;
    if (used.has(uid)) continue;
    used.add(uid);
    uids.push(uid);
  }
  return { uids, startValue: uids.length ? Number(uids[0].slice(-6)) : next, endValue: next };
}

export function buildRollbackRows(planned) {
  return planned.map((item) => ({
    user_id: item.user_id,
    restore_uid: item.original_uid ?? item.old_uid,
    applied_uid: item.new_uid,
    username: item.username || item.current_username || "",
    full_name: item.full_name || item.current_full_name || "",
  }));
}

export function isBatchRequestsNotAllowed(error) {
  const message = String(error?.message || error || "");
  return /batch requests are not allowed/i.test(message);
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function writeCsv(filePath, rows, columns = AUDIT_COLUMNS) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const content = [
    columns.join(","),
    ...rows.map((row) => columns.map((key) => csvEscape(row[key])).join(",")),
  ].join("\r\n");
  fs.writeFileSync(filePath, `\uFEFF${content}\r\n`, "utf8");
}

export function parseCsv(text) {
  const rows = [];
  let row = [],
    field = "",
    quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  const headers = (rows.shift() || []).map((item) => item.replace(/^\uFEFF/, "").trim());
  return rows
    .filter((items) => items.some(Boolean))
    .map((items) =>
      Object.fromEntries(headers.map((header, index) => [header, items[index] || ""])),
    );
}

export function readCsv(filePath) {
  return parseCsv(fs.readFileSync(filePath, "utf8"));
}

export async function safeFullList(pb, collection, options) {
  try {
    return await pb.collection(collection).getFullList(options);
  } catch (error) {
    if (error?.status === 404) return [];
    console.warn(`Bỏ qua collection ${collection}: ${error?.message || "không đọc được"}`);
    return [];
  }
}

export function countBy(records, field) {
  const counts = new Map();
  for (const record of records) {
    const id = String(record[field] || "");
    if (id) counts.set(id, (counts.get(id) || 0) + 1);
  }
  return counts;
}

export function timestampName(prefix) {
  return `${prefix}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
}
