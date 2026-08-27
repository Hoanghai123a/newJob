#!/usr/bin/env node
/**
 * Nhập/cập nhật phiếu ứng lương HRP từ Excel (sheet "History").
 *
 * Đối chiếu NLĐ theo cột A "ID NLĐ" (UID worker).
 * Xác định lần đi làm (employment_history) của phiếu ứng:
 *   1. Có MNV (H) + nhà máy (G)  → khớp employee_code + factory
 *   2. Thiếu MNV/nhà máy         → dò theo cột M "Ngày tạo" (ngày báo ứng)
 *                                   xem ngày đó nằm trong lần đi làm nào
 *
 * Chạy: node scripts/import-advances-hrp.mjs [--file=...] [--apply] [--force]
 * Mặc định: dry-run (không ghi dữ liệu)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import PocketBase from "pocketbase";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(envPath, "utf8")
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

const APPLY = process.argv.includes("--apply");
const FORCE = process.argv.includes("--force");
const FILE_PATH =
  process.argv.find((a) => a.startsWith("--file="))?.slice(7) ||
  path.join(__dirname, "..", "..", "export_pheduyet_all.xlsx");

const TARGET_COMPANY_CODE = "HRP";
const IMPORT_REASON = "Import từ HRP";

function normalizeLabel(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function txt(value) {
  return String(value ?? "").trim();
}

function parseNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

const pad2 = (n) => String(n).padStart(2, "0");

/** Excel serial (epoch 1899-12-30) → "YYYY-MM-DD HH:mm:ss". Cũng nhận sẵn chuỗi ngày. */
function toDateTime(value) {
  const raw = txt(value);
  if (!raw) return "";
  const num = Number(raw);
  if (Number.isFinite(num) && num > 20000) {
    const d = new Date(Math.round((num - 25569) * 86400 * 1000));
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
  }
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})[T ]?(\d{2}:\d{2}:\d{2})?/);
  return m ? `${m[1]} ${m[2] || "00:00:00"}` : "";
}

/** Lấy phần ngày "YYYY-MM-DD" từ serial Excel hoặc chuỗi ngày. */
function toDateOnly(value) {
  return toDateTime(value).slice(0, 10);
}

/** So sánh theo ngày (bỏ giờ) để tránh lệch múi giờ khi dò khoảng đi làm. */
function dayKey(value) {
  const d = toDateOnly(value);
  return d ? Number(d.replace(/-/g, "")) : null;
}

async function readExcel(filePath) {
  const zip = await JSZip.loadAsync(await fs.promises.readFile(filePath));

  const sharedRaw = (await zip.file("xl/sharedStrings.xml")?.async("string")) || "";
  const shared = [...sharedRaw.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
      .map((t) => t[1])
      .join("")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'"),
  );

  const sheetPath =
    Object.keys(zip.files).find((f) => /^xl\/worksheets\/sheet1\.xml$/.test(f)) ||
    Object.keys(zip.files).find((f) => /^xl\/worksheets\/.*\.xml$/.test(f));
  if (!sheetPath) throw new Error("Không tìm thấy sheet trong file Excel");

  const sheetXml = await zip.file(sheetPath).async("string");
  const rows = [...sheetXml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)];

  function cellValue(cellXml) {
    const type = /t="([^"]*)"/.exec(cellXml)?.[1];
    if (type === "inlineStr")
      return [...cellXml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join("");
    const v = /<v>([\s\S]*?)<\/v>/.exec(cellXml)?.[1];
    if (v == null) return null;
    if (type === "s") return shared[Number(v)] ?? null;
    return v;
  }

  function parseRow(rowXml) {
    const out = {};
    for (const m of rowXml.matchAll(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /r="([A-Z]+)\d+"/.exec(m[1])?.[1];
      if (!ref) continue;
      out[ref] = cellValue(`<c${m[1]}>${m[2] ?? ""}</c>`);
    }
    return out;
  }

  return rows.map((r) => ({ rowNumber: Number(r[1]), cells: parseRow(r[2]) }));
}

function mapStatus(tinhTrang) {
  const n = normalizeLabel(tinhTrang);
  if (n.includes("tu choi")) return "rejected";
  if (n.includes("cho")) return "pending";
  return "accepted"; // "Đã giải ngân"/"Đã duyệt" → tiếp nhận
}

function mapRecovery(thuHoi) {
  const n = normalizeLabel(thuHoi);
  if (n.includes("khong the")) return "unrecoverable";
  if (n.includes("da thu hoi")) return "recovered";
  return "none";
}

function mapPayout(hinhThuc) {
  const n = normalizeLabel(hinhThuc);
  if (n.includes("tien mat") || n.includes("cash")) return "cash";
  return "bank_transfer";
}

/**
 * Chọn lần đi làm theo ngày báo ứng.
 * histories: [{join_date, leave_date, employee_code, factoryId, factoryName}] đã sort join_date tăng dần.
 */
function pickStintByDate(histories, advanceDateValue) {
  const d = dayKey(advanceDateValue);
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

if (!PB_URL || !PB_EMAIL || !PB_PASSWORD) {
  console.error("❌ Thiếu cấu hình PocketBase (PB_URL, PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD)");
  process.exit(1);
}
if (!fs.existsSync(FILE_PATH)) {
  console.error(`❌ File không tồn tại: ${FILE_PATH}`);
  process.exit(1);
}

const pb = new PocketBase(PB_URL);
pb.autoCancellation(false);

console.log(`🔌 Kết nối ${PB_URL}...`);
await pb
  .collection("_superusers")
  .authWithPassword(PB_EMAIL, PB_PASSWORD)
  .catch(() => pb.admins.authWithPassword(PB_EMAIL, PB_PASSWORD));
console.log("✅ Đã kết nối");

const companies = await pb
  .collection("companies")
  .getFullList({ filter: `code="${TARGET_COMPANY_CODE}"` });
if (companies.length === 0) {
  console.error(`❌ Không tìm thấy công ty code="${TARGET_COMPANY_CODE}"`);
  process.exit(1);
}
const company = companies[0];
const tenantId = company.id;
console.log(`✅ Tenant: ${company.name} (${tenantId})`);

console.log(`\n📂 Đọc ${FILE_PATH}`);
const allRows = await readExcel(FILE_PATH);
const dataRows = allRows.slice(1);
console.log(`✅ ${dataRows.length} dòng dữ liệu`);

console.log(`\n🔍 Nạp dữ liệu hiện có...`);

const workers = await pb.collection("workers").getFullList({
  filter: `tenant_company="${tenantId}"`,
  fields: "id,uid,full_name,phone",
});
const workerByUid = new Map(workers.map((w) => [txt(w.uid).toUpperCase(), w]));
console.log(`   → ${workers.length} workers`);

const factories = await pb.collection("factories").getFullList({
  filter: `tenant_company="${tenantId}"`,
  fields: "id,name,code",
});
const factoryByName = new Map(factories.map((f) => [normalizeLabel(f.name), f]));
const factoryById = new Map(factories.map((f) => [f.id, f]));
console.log(`   → ${factories.length} factories`);

const histories = await pb.collection("employment_histories").getFullList({
  filter: `tenant_company="${tenantId}"`,
  fields: "id,worker,employee_code,factory,join_date,leave_date,status",
});
const historiesByWorker = new Map();
for (const h of histories) {
  const entry = {
    id: h.id,
    join_date: h.join_date,
    leave_date: h.leave_date,
    employee_code: txt(h.employee_code),
    factoryId: h.factory,
    factoryName: factoryById.get(h.factory)?.name || "",
  };
  if (!historiesByWorker.has(h.worker)) historiesByWorker.set(h.worker, []);
  historiesByWorker.get(h.worker).push(entry);
}
for (const list of historiesByWorker.values()) {
  list.sort((a, b) => (dayKey(a.join_date) || 0) - (dayKey(b.join_date) || 0));
}
console.log(`   → ${histories.length} employment histories`);

const staff = await pb.collection("users").getFullList({
  filter: `tenant_company="${tenantId}" && (role="staff" || role="admin")`,
  fields: "id,username,full_name",
});
const staffByName = new Map(
  staff.filter((s) => s.full_name).map((s) => [normalizeLabel(s.full_name), s]),
);
console.log(`   → ${staff.length} staff`);

const existingAdvances = await pb.collection("advances").getFullList({
  filter: `tenant_company="${tenantId}"`,
  fields: "id,reason",
});
const alreadyImported = existingAdvances.filter((a) => a.reason === IMPORT_REASON);
console.log(
  `   → ${existingAdvances.length} advances hiện có (${alreadyImported.length} thuộc "${IMPORT_REASON}")`,
);

console.log(`\n⚙️  Chuẩn bị dữ liệu...`);

const prepared = [];
const errors = [];
const warnings = [];

for (const { rowNumber, cells } of dataRows) {
  const workerUid = txt(cells.A).toUpperCase();
  const workerName = txt(cells.B);
  const amount = parseNumber(cells.C);
  const creatorName = txt(cells.F);
  const excelFactory = txt(cells.G);
  const excelEmployeeCode = txt(cells.H);
  const excelJoinDate = toDateOnly(cells.J);
  const advanceDateTime = toDateTime(cells.M);

  const status = mapStatus(cells.D);
  const recoveryStatus = mapRecovery(cells.E);
  const payoutMethod = mapPayout(cells.K);
  const isDisbursed = normalizeLabel(cells.D).includes("giai ngan");

  if (!workerUid) {
    errors.push({ rowNumber, reason: "Thiếu ID NLĐ (cột A)" });
    continue;
  }
  if (!(amount > 0)) {
    errors.push({ rowNumber, workerUid, reason: "Số tiền không hợp lệ (cột C)" });
    continue;
  }

  // Đối chiếu worker theo UID (có fallback bỏ dấu gạch ngang)
  let worker = workerByUid.get(workerUid);
  if (!worker && workerUid.includes("-")) {
    worker = workerByUid.get(workerUid.replace(/-/g, ""));
  }
  if (!worker) {
    errors.push({ rowNumber, workerUid, reason: `Không tìm thấy worker UID="${workerUid}"` });
    continue;
  }

  const workerHistories = historiesByWorker.get(worker.id) || [];

  // Xác định lần đi làm + các trường denormalized
  let employeeCode = excelEmployeeCode;
  let factoryName = excelFactory;
  let joinDate = excelJoinDate;
  let stintId = "";
  let matchMethod;

  if (excelEmployeeCode && excelFactory) {
    // Có đủ MNV + nhà máy → khớp lần đi làm theo employee_code + factory
    const wantFactory = normalizeLabel(excelFactory);
    const wantCode = excelEmployeeCode.toUpperCase();
    const stint = workerHistories.find(
      (h) =>
        h.employee_code.toUpperCase() === wantCode &&
        normalizeLabel(h.factoryName) === wantFactory,
    );
    if (stint) {
      stintId = stint.id;
      // Dùng tên nhà máy chuẩn trong DB — bộ lọc nhà máy của UI so khớp advances.company
      // với factories.name nguyên văn, nên sai hoa/thường sẽ làm phiếu bị lọc mất.
      factoryName = stint.factoryName || factoryName;
      employeeCode = stint.employee_code || employeeCode;
      if (!joinDate) joinDate = toDateOnly(stint.join_date);
      matchMethod = "mnv+factory";
    } else {
      matchMethod = "mnv+factory (excel, không khớp lịch sử)";
      warnings.push({
        rowNumber,
        workerUid,
        message: `MNV="${excelEmployeeCode}" + nhà máy="${excelFactory}" không khớp lịch sử đi làm nào của worker → dùng giá trị từ Excel`,
      });
    }
  } else {
    // Thiếu MNV/nhà máy → dò theo ngày báo ứng
    if (workerHistories.length === 0) {
      matchMethod = "no_history";
      warnings.push({
        rowNumber,
        workerUid,
        message: `Thiếu MNV+nhà máy và worker không có lịch sử đi làm → phiếu ứng không gắn được lần đi làm`,
      });
    } else {
      const { stint, method } = pickStintByDate(workerHistories, cells.M);
      if (stint) {
        stintId = stint.id;
        employeeCode = stint.employee_code || employeeCode;
        factoryName = stint.factoryName || factoryName;
        if (!joinDate) joinDate = toDateOnly(stint.join_date);
        matchMethod = method;
        warnings.push({
          rowNumber,
          workerUid,
          message: `Thiếu MNV+nhà máy → dò theo ngày báo ứng ${advanceDateTime.slice(0, 10)} khớp lần đi làm [${toDateOnly(stint.join_date)}→${stint.leave_date ? toDateOnly(stint.leave_date) : "đang làm"}] MNV=${stint.employee_code || "—"} nhà máy=${stint.factoryName || "—"} (${method})`,
        });
      }
    }
  }

  const creator = creatorName ? staffByName.get(normalizeLabel(creatorName)) : null;
  if (creatorName && !creator) {
    warnings.push({ rowNumber, workerUid, message: `Không tìm thấy staff "${creatorName}"` });
  }

  prepared.push({
    rowNumber,
    workerUid,
    matchMethod,
    stintId,
    advanceDateTime,
    payload: {
      tenant_company: tenantId,
      worker: worker.id,
      requested_by: creator?.id || "",
      recruiter_id: "",
      employee_code: employeeCode || workerUid,
      full_name: workerName || worker.full_name || "—",
      company: factoryName,
      phone: worker.phone || "",
      join_date: joinDate,
      payout_method: payoutMethod,
      amount,
      original_amount: amount,
      reason: IMPORT_REASON,
      status,
      recovery_status: recoveryStatus,
      disbursed: isDisbursed,
      disbursed_at: isDisbursed && advanceDateTime ? advanceDateTime : "",
      resolved_at: status === "accepted" && advanceDateTime ? advanceDateTime : "",
    },
  });
}

console.log(`✅ Chuẩn bị xong: ${prepared.length} phiếu | ${errors.length} lỗi | ${warnings.length} cảnh báo`);

if (!APPLY) {
  console.log(`\n📊 BÁO CÁO DRY-RUN (chưa ghi dữ liệu)`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Tenant     : ${company.name} (${tenantId})`);
  console.log(`File       : ${FILE_PATH}`);
  console.log(`Tổng dòng  : ${dataRows.length}`);
  console.log(`Sẽ tạo     : ${prepared.length}`);
  console.log(`Lỗi        : ${errors.length}`);
  console.log(`Tổng tiền  : ${prepared.reduce((s, p) => s + p.payload.amount, 0).toLocaleString("vi-VN")}đ`);

  const tally = (fn) => {
    const out = {};
    for (const p of prepared) {
      const k = fn(p) || "(rỗng)";
      out[k] = (out[k] || 0) + 1;
    }
    return Object.entries(out).sort((a, b) => b[1] - a[1]);
  };

  console.log(`\n🔍 Cách xác định lần đi làm:`);
  for (const [k, v] of tally((p) => p.matchMethod)) console.log(`   ${k}: ${v}`);

  console.log(`\n📈 Trạng thái:`);
  for (const [k, v] of tally((p) => p.payload.status)) console.log(`   ${k}: ${v}`);

  console.log(`\n💰 Thu hồi:`);
  for (const [k, v] of tally((p) => p.payload.recovery_status)) console.log(`   ${k}: ${v}`);

  console.log(`\n🏭 Nhà máy (sau khi dò):`);
  for (const [k, v] of tally((p) => p.payload.company)) console.log(`   ${k}: ${v}`);

  const noStint = prepared.filter((p) => !p.stintId);
  console.log(`\n⚠️  Phiếu không gắn được lần đi làm: ${noStint.length}`);
  for (const p of noStint) {
    console.log(`   dòng ${p.rowNumber}: ${p.workerUid} | ${p.payload.full_name}`);
  }

  if (errors.length) {
    console.log(`\n❌ Lỗi:`);
    for (const e of errors) {
      console.log(`   dòng ${e.rowNumber}: ${e.workerUid || "N/A"} — ${e.reason}`);
    }
  }

  if (warnings.length) {
    console.log(`\n⚠️  Cảnh báo (${warnings.length}):`);
    for (const w of warnings) console.log(`   dòng ${w.rowNumber}: ${w.message}`);
  }

  const reportFile = path.join(__dirname, "..", "import_advances_hrp_dryrun.json");
  fs.writeFileSync(
    reportFile,
    JSON.stringify(
      prepared.map((p) => ({
        rowNumber: p.rowNumber,
        workerUid: p.workerUid,
        matchMethod: p.matchMethod,
        stintId: p.stintId,
        advanceDateTime: p.advanceDateTime,
        ...p.payload,
      })),
      null,
      2,
    ),
    "utf8",
  );
  console.log(`\n📄 Chi tiết: ${reportFile}`);

  console.log(`\n💡 Chạy lại với --apply để ghi dữ liệu`);
  if (alreadyImported.length > 0) {
    console.log(
      `\n⛔ Tenant đã có ${alreadyImported.length} phiếu "${IMPORT_REASON}" → --apply sẽ bị chặn.`,
    );
    console.log(`   Xoá dữ liệu cũ: node scripts/rollback-advances-hrp.mjs --apply`);
    console.log(`   Hoặc bỏ qua kiểm tra: thêm cờ --force`);
  }
  pb.authStore.clear();
} else {
  if (alreadyImported.length > 0 && !FORCE) {
    console.error(`\n⛔ ĐÃ CÓ ${alreadyImported.length} phiếu với reason="${IMPORT_REASON}".`);
    console.error(`   Import lại sẽ tạo dữ liệu TRÙNG LẶP.`);
    console.error(`   → Xoá dữ liệu cũ: node scripts/rollback-advances-hrp.mjs --apply`);
    console.error(`   → Hoặc import đè có chủ đích: thêm cờ --force`);
    process.exit(1);
  }

  console.log(`\n🚀 GHI DỮ LIỆU (--apply)`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  let successCount = 0;
  let failCount = 0;

  for (const item of prepared) {
    try {
      await pb.collection("advances").create(item.payload);
      successCount++;
      if (successCount % 10 === 0 || successCount === prepared.length) {
        console.log(`   ✅ ${successCount}/${prepared.length}`);
      }
    } catch (error) {
      failCount++;
      const msg = error?.response?.message || error?.message || String(error);
      console.error(`   ❌ dòng ${item.rowNumber} (${item.workerUid}): ${msg}`);
      errors.push({
        rowNumber: item.rowNumber,
        workerUid: item.workerUid,
        reason: msg,
        detail: error?.response?.data,
      });
    }
  }

  console.log(`\n✨ HOÀN TẤT`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Thành công: ${successCount}`);
  console.log(`Thất bại  : ${failCount}`);

  if (errors.length) {
    const errorFile = path.join(__dirname, "..", "import_advances_hrp_errors.json");
    fs.writeFileSync(errorFile, JSON.stringify(errors, null, 2), "utf8");
    console.log(`\n📄 Chi tiết lỗi: ${errorFile}`);
    process.exitCode = 1;
  }

  pb.authStore.clear();
}
