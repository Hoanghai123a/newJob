#!/usr/bin/env node
/**
 * Import phiếu ứng lương từ file Excel của công ty Đại Việt (DV)
 *
 * Chạy: node scripts/import-advances-dv.mjs [--file=path] [--apply] [--force]
 *
 * Mặc định: dry-run (chỉ xem trước, không ghi)
 * --apply: Ghi dữ liệu thật vào PocketBase
 * --force: Bỏ qua cảnh báo trùng reason="Import từ DV"
 *
 * Bố cục file mong đợi (16 cột A–P) — xem EXPECTED_HEADERS, script dừng nếu lệch:
 *   A Trạng thái | B $ yêu cầu | C Giải ngân | D $ giải ngân | E Thu hồi
 *   F Người tạo  | G Tên NLĐ   | H Người tuyển NLĐ | I ID NLĐ | J Công ty NLĐ
 *   K Tên đi làm | L MNV đi làm | M Ngày vào làm | N Hình thức thanh toán
 *   O Người thụ hưởng | P Ngày tạo (số serial Excel)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PocketBase from "pocketbase";
import JSZip from "jszip";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const APPLY = process.argv.includes("--apply");
const FORCE = process.argv.includes("--force");
const FILE_PATH =
  process.argv.find((a) => a.startsWith("--file="))?.slice(7) ||
  path.join(__dirname, "..", "..", "Data_ung_DV.xlsx");
const TARGET_COMPANY_CODE = "DV";
const IMPORT_REASON = "Import từ DV";

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return {};
  return Object.fromEntries(
    fs.readFileSync(envPath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const i = line.indexOf("=");
        return [line.slice(0, i), line.slice(i + 1).replace(/^['"]|['"]$/g, "")];
      }),
  );
}

const env = loadEnv();
const PB_URL = process.env.PB_URL || process.env.VITE_PB_URL || env.PB_URL || env.VITE_PB_URL;
const PB_EMAIL = process.env.PB_ADMIN_EMAIL || env.PB_ADMIN_EMAIL;
const PB_PASSWORD = process.env.PB_ADMIN_PASSWORD || env.PB_ADMIN_PASSWORD;

if (!PB_URL || !PB_EMAIL || !PB_PASSWORD) {
  console.error("❌ Thiếu cấu hình PocketBase (PB_URL, PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD)");
  process.exitCode = 1;
  process.exit(1);
}

const pb = new PocketBase(PB_URL);
pb.autoCancellation(false);

const txt = (v) => String(v || "").trim();

function normalizeLabel(s) {
  return txt(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

// Cột "Ngày tạo" (P) là số serial Excel (46261), cột "Ngày vào làm" (M) là chuỗi
// "2026-08-13". Hàm này nhận cả hai dạng.
function toDateTime(value) {
  const raw = txt(value);
  if (!raw) return "";

  if (/^\d+(\.\d+)?$/.test(raw)) {
    const serial = Number(raw);
    if (serial < 1000 || serial > 100000) return "";
    const ms = Math.round((serial - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return "";
    return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 19)}`;
  }

  const m = raw.match(/^(\d{4}-\d{2}-\d{2})[T ]?(\d{2}:\d{2}:\d{2})?/);
  return m ? `${m[1]} ${m[2] || "00:00:00"}` : "";
}

function toDateOnly(value) {
  return toDateTime(value).slice(0, 10);
}

function dayKey(value) {
  const d = toDateOnly(value);
  return d ? Number(d.replace(/-/g, "")) : null;
}

function pickStintByDate(histories, dateValue) {
  const d = dayKey(dateValue);
  if (d == null || histories.length === 0) {
    return { stint: histories[0] || null, method: histories[0] ? "date_no_value" : "none" };
  }

  const contained = histories.filter((h) => {
    const j = dayKey(h.join_date);
    const l = h.leave_date ? dayKey(h.leave_date) : null;
    return j != null && j <= d && (l == null || d <= l);
  });

  if (contained.length >= 1) {
    const best = contained.sort((a, b) => dayKey(b.join_date) - dayKey(a.join_date))[0];
    return { stint: best, method: contained.length === 1 ? "date_contained" : "date_contained_multi" };
  }

  const before = histories
    .filter((h) => dayKey(h.join_date) != null && dayKey(h.join_date) <= d)
    .sort((a, b) => dayKey(b.join_date) - dayKey(a.join_date));
  if (before.length) return { stint: before[0], method: "date_nearest_before" };

  return { stint: histories[0], method: "date_earliest_fallback" };
}

// Cột A "Trạng thái": Chờ duyệt / Đã duyệt / Từ chối
// Phải xét "tu choi" TRƯỚC "cho", vì "tu choi" cũng chứa chuỗi "cho".
function mapStatus(raw) {
  const norm = normalizeLabel(raw);
  if (norm.includes("tu choi")) return "rejected";
  if (norm.includes("cho duyet") || norm.startsWith("cho")) return "pending";
  return "accepted";
}

// Cột E "Thu hồi": Chưa thu hồi / Đã thu hồi / Không thể thu hồi
function mapRecovery(raw) {
  const norm = normalizeLabel(raw);
  if (norm.includes("khong the")) return "unrecoverable";
  if (norm.includes("da thu hoi")) return "recovered";
  return "none";
}

// Cột N "Hình thức thanh toán": Chuyển khoản / Tiền mặt
function mapPayout(raw) {
  const norm = normalizeLabel(raw);
  if (norm.includes("tien mat") || norm.includes("cash")) return "cash";
  return "bank_transfer";
}

// Cột C "Giải ngân": Chưa giải ngân / Đã giải ngân.
// Không dùng includes("giai ngan") vì "chua giai ngan" cũng khớp.
function mapDisbursed(raw) {
  return normalizeLabel(raw).includes("da giai ngan");
}

console.log(`🔌 Kết nối ${PB_URL}...`);
await pb
  .collection("_superusers")
  .authWithPassword(PB_EMAIL, PB_PASSWORD)
  .catch(() => pb.admins.authWithPassword(PB_EMAIL, PB_PASSWORD));
console.log("✅ Đã kết nối\n");

const companies = await pb.collection("companies").getFullList({ filter: `code="${TARGET_COMPANY_CODE}"` });
if (companies.length === 0) {
  console.error(`❌ Không tìm thấy công ty code="${TARGET_COMPANY_CODE}"`);
  process.exitCode = 1;
  process.exit(1);
}
const tenant = companies[0];
const tenantId = tenant.id;
console.log(`✅ Tenant: ${tenant.name} (${tenantId})\n`);

console.log(`📂 Đọc file: ${FILE_PATH}...`);
const fileBuffer = fs.readFileSync(FILE_PATH);
const zip = await JSZip.loadAsync(fileBuffer);

function decodeXml(s) {
  return String(s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&");
}

// Đọc từng <si> một để chỉ số sharedStrings luôn đúng. File này có cả <t/> rỗng,
// nếu quét thẳng /<t>...<\/t>/ sẽ nhảy qua thẻ rỗng và lệch toàn bộ chỉ số.
const sharedStringsXml = await zip.file("xl/sharedStrings.xml")?.async("text");
const sharedStrings = [];
if (sharedStringsXml) {
  const siRe = /<si>([\s\S]*?)<\/si>|<si\/>/g;
  let sm;
  while ((sm = siRe.exec(sharedStringsXml))) {
    const body = sm[1] || "";
    const parts = [...body.matchAll(/<t[^>]*\/>|<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => decodeXml(x[1] || ""));
    sharedStrings.push(parts.join(""));
  }
}

// Cell có thể mang thuộc tính style (s="1") trước hoặc sau t="s", nên phải đọc
// nguyên khối thuộc tính chứ không chỉ chấp nhận đúng t="...".
const sheetXml = await zip.file("xl/worksheets/sheet1.xml").async("text");
const rowMap = new Map();
const rowRe = /<row[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
let rowMatch;
while ((rowMatch = rowRe.exec(sheetXml))) {
  const rowNumber = rowMatch[1];
  const cells = {};
  const cellRe = /<c\s+r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let cm;
  while ((cm = cellRe.exec(rowMatch[2]))) {
    const col = cm[1];
    const type = (cm[2] || "").match(/\bt="([^"]+)"/)?.[1];
    const body = cm[3] || "";
    let value = "";
    if (type === "inlineStr") {
      value = [...body.matchAll(/<t[^>]*\/>|<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => decodeXml(x[1] || "")).join("");
    } else {
      const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
      value = type === "s" && raw !== "" ? (sharedStrings[Number(raw)] ?? "") : decodeXml(raw);
    }
    cells[col] = value;
  }
  rowMap.set(rowNumber, cells);
}

const headerRow = rowMap.get("1") || {};

// Bố cục file đổi giữa các lần xuất, nên khoá cứng tiêu đề: sai cột thì dừng ngay
// thay vì âm thầm ghi sai dữ liệu.
const EXPECTED_HEADERS = {
  A: "Trạng thái",
  B: "$ yêu cầu",
  C: "Giải ngân",
  D: "$ giải ngân",
  E: "Thu hồi",
  F: "Người tạo",
  G: "Tên NLĐ",
  H: "Người tuyển NLĐ",
  I: "ID NLĐ",
  J: "Công ty NLĐ",
  K: "Tên đi làm",
  L: "MNV đi làm",
  M: "Ngày vào làm",
  N: "Hình thức thanh toán",
  O: "Người thụ hưởng",
  P: "Ngày tạo",
};

const headerMismatch = Object.entries(EXPECTED_HEADERS).filter(
  ([col, label]) => normalizeLabel(headerRow[col]) !== normalizeLabel(label),
);
if (headerMismatch.length > 0) {
  console.error(`\n⛔ BỐ CỤC FILE KHÔNG ĐÚNG — dừng để tránh ghi sai dữ liệu.`);
  for (const [col, label] of headerMismatch) {
    console.error(`   Cột ${col}: cần "${label}" nhưng file có "${txt(headerRow[col]) || "(rỗng)"}"`);
  }
  console.error(`\n   Nếu file xuất đổi cột thật, sửa EXPECTED_HEADERS và phần đọc cột trong script.`);
  process.exitCode = 1;
  process.exit(1);
}

const dataRows = [...rowMap.keys()]
  .map(Number)
  .filter((n) => n > 1)
  .sort((a, b) => a - b)
  .map((n) => ({ rowNum: n, cells: rowMap.get(String(n)) }))
  .filter(({ cells }) => Object.values(cells).some((v) => txt(v)));

console.log(`✅ ${dataRows.length} dòng dữ liệu | bố cục cột A–P khớp\n`);

console.log(`📥 Tải dữ liệu PocketBase...`);
const workers = await pb.collection("workers").getFullList({
  filter: `tenant_company="${tenantId}"`,
  fields: "id,uid,full_name,phone",
});
const workerByUid = new Map(workers.map((w) => [w.uid.toUpperCase(), w]));
console.log(`   → ${workers.length} NLĐ`);

const staffUsers = await pb.collection("users").getFullList({
  filter: `tenant_company="${tenantId}" && role="staff"`,
  fields: "id,full_name",
});
const staffByName = new Map(staffUsers.map((s) => [normalizeLabel(s.full_name), s]));
console.log(`   → ${staffUsers.length} staff`);

const factories = await pb.collection("factories").getFullList({
  filter: `tenant_company="${tenantId}"`,
  fields: "id,name",
});
const factoryById = new Map(factories.map((f) => [f.id, f]));
console.log(`   → ${factories.length} nhà máy`);

const histories = await pb.collection("employment_histories").getFullList({
  filter: `tenant_company="${tenantId}"`,
  fields: "id,worker,employee_code,factory,join_date,leave_date,status",
});
const historiesByWorker = new Map();
for (const h of histories) {
  if (!historiesByWorker.has(h.worker)) historiesByWorker.set(h.worker, []);
  historiesByWorker.get(h.worker).push({
    ...h,
    factoryName: factoryById.get(h.factory)?.name || "",
  });
}
console.log(`   → ${histories.length} lần đi làm\n`);

const alreadyImported = await pb.collection("advances").getFullList({
  filter: `tenant_company="${tenantId}" && reason="${IMPORT_REASON}"`,
  fields: "id",
});

if (alreadyImported.length > 0 && !FORCE) {
  console.error(`\n⛔ ĐÃ CÓ ${alreadyImported.length} phiếu với reason="${IMPORT_REASON}".`);
  console.error(`   Import lại sẽ tạo dữ liệu TRÙNG LẶP.`);
  console.error(`   → Xoá dữ liệu cũ: node scripts/rollback-advances-dv.mjs --apply`);
  console.error(`   → Hoặc import đè có chủ đích: thêm cờ --force`);
  process.exitCode = 1;
  process.exit(1);
}

// Tenant DV có 2 hệ prefix UID trên cùng dải số: DV* (1358 bản) và NLD* (216 bản,
// dữ liệu cũ). File xuất hiện tại dùng DV*, nhưng vài chục người vẫn chỉ tồn tại
// dưới NLD*, nên phải dò thêm theo phần số. Một số ít số có CẢ HAI bản ghi (2 lần
// đi làm khác nhau của cùng một người) → chọn bản có lần đi làm chứa ngày báo ứng.
const workersByNumber = new Map();
for (const w of workers) {
  const num = w.uid.replace(/\D/g, "");
  if (!num) continue;
  if (!workersByNumber.has(num)) workersByNumber.set(num, []);
  workersByNumber.get(num).push(w);
}

function workerCoversDate(worker, dateValue) {
  const d = dayKey(dateValue);
  if (d == null) return false;
  return (historiesByWorker.get(worker.id) || []).some((h) => {
    const j = dayKey(h.join_date);
    const l = h.leave_date ? dayKey(h.leave_date) : null;
    return j != null && j <= d && (l == null || d <= l);
  });
}

function resolveWorker(rawUid, excelName, advanceDate) {
  const direct =
    workerByUid.get(rawUid.toUpperCase()) ||
    workerByUid.get(rawUid.replace(/-/g, "").toUpperCase());

  const num = rawUid.replace(/\D/g, "");
  const candidates = num ? workersByNumber.get(num) || [] : [];

  if (candidates.length <= 1) {
    const only = direct || candidates[0];
    if (!only) return { worker: null, reason: `Không tìm thấy worker UID="${rawUid}"` };
    if (direct) return { worker: direct, method: "uid_truc_tiep" };
    return {
      worker: only,
      method: "doi_prefix",
      warning: `UID Excel "${rawUid}" không có trong DB → dùng "${only.uid}" (${only.full_name}) theo số thứ tự`,
    };
  }

  // Nhiều bản ghi cùng số: chọn bản có lần đi làm chứa ngày báo ứng
  const covering = candidates.filter((w) => workerCoversDate(w, advanceDate));
  if (covering.length === 1) {
    return {
      worker: covering[0],
      method: "nhieu_ban_chon_theo_ngay",
      warning: `UID "${rawUid}" trùng số với ${candidates.map((w) => w.uid).join(" / ")} → chọn "${covering[0].uid}" vì có lần đi làm chứa ngày ${toDateOnly(advanceDate)}`,
    };
  }

  // Không bản nào chứa ngày (hoặc nhiều bản cùng chứa) → ưu tiên khớp UID nguyên văn
  const fallback = direct || candidates[0];
  return {
    worker: fallback,
    method: covering.length > 1 ? "nhieu_ban_nhieu_ngay" : "nhieu_ban_khong_khop_ngay",
    warning: `UID "${rawUid}" trùng số với ${candidates.map((w) => w.uid).join(" / ")}, ${covering.length > 1 ? "nhiều bản cùng chứa" : "không bản nào chứa"} ngày ${toDateOnly(advanceDate)} → dùng "${fallback.uid}". CẦN KIỂM TRA TAY.`,
  };
}

console.log(`🔍 Chuẩn bị dữ liệu...`);

const prepared = [];
const errors = [];
const warnings = [];
let totalAmount = 0;
const matchMethods = new Map();
const uidMethods = new Map();

for (const { rowNum, cells } of dataRows) {
  const workerUid = txt(cells.I);
  const excelWorkerName = txt(cells.G);
  const excelEmployeeCode = txt(cells.L);
  const excelFactory = txt(cells.J);
  const createdAt = txt(cells.P);

  if (!workerUid) {
    errors.push({ row: rowNum, reason: "Thiếu ID NLĐ (cột I)" });
    continue;
  }

  const resolved = resolveWorker(workerUid, excelWorkerName, createdAt);
  if (!resolved.worker) {
    errors.push({ row: rowNum, uid: workerUid, reason: resolved.reason });
    continue;
  }
  const worker = resolved.worker;
  uidMethods.set(resolved.method, (uidMethods.get(resolved.method) || 0) + 1);
  if (resolved.warning) {
    warnings.push({ row: rowNum, uid: workerUid, reason: resolved.warning });
  }

  const workerHistories = historiesByWorker.get(worker.id) || [];
  const workerName = excelWorkerName || worker.full_name || "—";

  let employeeCode = excelEmployeeCode;
  let factoryName = excelFactory;
  let joinDate = toDateOnly(cells.M);
  let stintId = "";
  let matchMethod = "";

  if (excelEmployeeCode && excelFactory) {
    const wantFactory = normalizeLabel(excelFactory);
    const wantCode = excelEmployeeCode.toUpperCase();
    const stint = workerHistories.find(
      (h) => h.employee_code.toUpperCase() === wantCode && normalizeLabel(h.factoryName) === wantFactory,
    );
    if (stint) {
      stintId = stint.id;
      factoryName = stint.factoryName || factoryName;
      employeeCode = stint.employee_code || employeeCode;
      if (!joinDate) joinDate = toDateOnly(stint.join_date);
      matchMethod = "mnv+factory";
    } else {
      matchMethod = "mnv+factory_not_found";
      warnings.push({
        row: rowNum,
        uid: workerUid,
        reason: `MNV="${excelEmployeeCode}" + nhà máy="${excelFactory}" không khớp lần đi làm nào → giữ nguyên giá trị Excel`,
      });
    }
  } else {
    if (workerHistories.length === 0) {
      matchMethod = "no_history";
      warnings.push({
        row: rowNum,
        uid: workerUid,
        reason: `NLĐ không có lần đi làm nào → MNV=${workerUid}, company rỗng`,
      });
      employeeCode = workerUid;
      factoryName = "";
    } else {
      const { stint, method } = pickStintByDate(workerHistories, createdAt);
      if (stint) {
        stintId = stint.id;
        employeeCode = stint.employee_code || employeeCode || workerUid;
        factoryName = stint.factoryName || factoryName;
        if (!joinDate) joinDate = toDateOnly(stint.join_date);
        matchMethod = method;

        warnings.push({
          row: rowNum,
          uid: workerUid,
          reason: `Dò theo ngày tạo ${toDateOnly(createdAt)} → khớp lần đi làm [${toDateOnly(stint.join_date)} → ${stint.leave_date ? toDateOnly(stint.leave_date) : "hiện tại"}] tại ${stint.factoryName}, MNV=${stint.employee_code}`,
          detail: { method },
        });
      } else {
        matchMethod = "no_history";
        employeeCode = workerUid;
        factoryName = "";
      }
    }
  }

  matchMethods.set(matchMethod, (matchMethods.get(matchMethod) || 0) + 1);

  const recruiterName = txt(cells.H);
  const recruiter = recruiterName ? staffByName.get(normalizeLabel(recruiterName)) : null;
  if (recruiterName && !recruiter) {
    warnings.push({ row: rowNum, uid: workerUid, reason: `Không tìm thấy staff "Người tuyển NLĐ" = "${recruiterName}"` });
  }

  const creatorName = txt(cells.F);
  const creator = creatorName ? staffByName.get(normalizeLabel(creatorName)) : null;
  if (creatorName && !creator) {
    warnings.push({ row: rowNum, uid: workerUid, reason: `Không tìm thấy staff "Người tạo" = "${creatorName}"` });
  }

  const amount = Number(txt(cells.B)) || 0;
  if (amount <= 0) {
    warnings.push({ row: rowNum, uid: workerUid, reason: `Số tiền yêu cầu (cột B) = ${txt(cells.B) || "rỗng"}` });
  }
  totalAmount += amount;

  const status = mapStatus(cells.A);
  const recoveryStatus = mapRecovery(cells.E);
  const payoutMethod = mapPayout(cells.N);
  const isDisbursed = mapDisbursed(cells.C);
  const createdDateTime = toDateTime(createdAt);
  if (!createdDateTime) {
    warnings.push({ row: rowNum, uid: workerUid, reason: `Không đọc được "Ngày tạo" (cột P) = "${createdAt}"` });
  }

  prepared.push({
    row: rowNum,
    uid: workerUid,
    payload: {
      tenant_company: tenantId,
      worker: worker.id,
      requested_by: creator?.id || "",
      recruiter_id: recruiter?.id || "",
      employee_code: employeeCode || workerUid,
      full_name: workerName || worker.full_name || "—",
      company: factoryName,
      phone: worker.phone || "",
      join_date: joinDate,
      payout_method: payoutMethod,
      amount,
      reason: IMPORT_REASON,
      status,
      recovery_status: recoveryStatus,
      disbursed: isDisbursed,
      disbursed_at: isDisbursed && createdDateTime ? createdDateTime : "",
      resolved_at: status === "accepted" && createdDateTime ? createdDateTime : "",
    },
  });
}

console.log(`✅ Chuẩn bị xong: ${prepared.length} phiếu | ${errors.length} lỗi | ${warnings.length} cảnh báo\n`);

if (errors.length > 0) {
  console.log(`❌ LỖI (${errors.length}):`);
  for (const e of errors.slice(0, 10)) {
    console.log(`   Dòng ${e.row}: ${e.reason}`);
  }
  if (errors.length > 10) console.log(`   ... và ${errors.length - 10} lỗi khác`);
  console.log();
}

if (warnings.length > 0) {
  console.log(`⚠️  CẢNH BÁO (${warnings.length}):`);
  for (const w of warnings.slice(0, 5)) {
    console.log(`   Dòng ${w.row} | ${w.uid}: ${w.reason}`);
  }
  if (warnings.length > 5) console.log(`   ... và ${warnings.length - 5} cảnh báo khác`);
  console.log();
}

console.log(`📊 TỔNG QUAN`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`Sẽ tạo     : ${prepared.length}`);
console.log(`Lỗi        : ${errors.length}`);
console.log(`Tổng tiền  : ${totalAmount.toLocaleString("vi-VN")}đ`);
console.log();
console.log(`🔑 Cách tìm NLĐ theo cột "ID NLĐ" (I):`);
for (const [method, count] of [...uidMethods.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`   ${method}: ${count}`);
}
console.log();
console.log(`🔍 Cách xác định lần đi làm:`);
for (const [method, count] of [...matchMethods.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`   ${method}: ${count}`);
}
console.log();

const noStint = [...matchMethods.entries()]
  .filter(([m]) => m === "no_history" || m === "mnv+factory_not_found")
  .reduce((sum, [, c]) => sum + c, 0);
console.log(`⚠️  Phiếu không gắn được lần đi làm: ${noStint}`);
console.log();

if (!APPLY) {
  const dryFile = path.join(__dirname, "..", "import_advances_dv_dryrun.json");
  fs.writeFileSync(dryFile, JSON.stringify({ prepared, errors, warnings }, null, 2), "utf8");
  console.log(`🔍 DRY RUN — chưa ghi gì.`);
  console.log(`   Chi tiết: ${dryFile}`);
  console.log(`   Chạy lại với --apply để ghi ${prepared.length} phiếu`);
  pb.authStore.clear();
  process.exit(0);
}

console.log(`💾 BẮT ĐẦU GHI ${prepared.length} phiếu...\n`);

let successCount = 0;
let failCount = 0;
const failures = [];

for (const p of prepared) {
  try {
    await pb.collection("advances").create(p.payload);
    successCount++;
    if (successCount % 20 === 0 || successCount === prepared.length) {
      console.log(`   ✅ Đã tạo ${successCount}/${prepared.length}`);
    }
  } catch (error) {
    failCount++;
    const msg = error?.response?.message || error?.message || String(error);
    failures.push({ row: p.row, uid: p.uid, reason: msg });
    console.error(`   ❌ Dòng ${p.row} (${p.uid}): ${msg}`);
  }
}

console.log(`\n✨ HOÀN TẤT`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`Thành công: ${successCount}`);
console.log(`Thất bại  : ${failCount}`);

if (failures.length > 0) {
  const failFile = path.join(__dirname, "..", "import_advances_dv_errors.json");
  fs.writeFileSync(failFile, JSON.stringify(failures, null, 2), "utf8");
  console.log(`\n📄 Chi tiết lỗi: ${failFile}`);
  process.exitCode = 1;
}

pb.authStore.clear();
