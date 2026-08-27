#!/usr/bin/env node
/**
 * Migration script: Nhập lịch sử lao động từ Excel (1 sheet) vào MỘT công ty.
 *
 * Chạy: node scripts/migrate-hrp-history.mjs --code=HRP --file=/duong/dan/file.xlsx [--apply]
 *
 *   --code   Company code trong collection `companies` (mặc định HRP)
 *   --file   Đường dẫn file Excel
 *   --apply  Ghi dữ liệu thật. Không có cờ này = dry-run, chỉ báo cáo.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PocketBase from "pocketbase";
import XLSX from "xlsx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================================
// CẤU HÌNH
// ============================================================================

const APPLY = process.argv.includes("--apply");

function argValue(name) {
  const flag = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(flag));
  return found ? found.slice(flag.length).trim() : "";
}

const FILE_PATH =
  argValue("file") ||
  "C:\\Users\\admin\\Documents\\HiTech files\\application\\op_history_08_25_0139.xlsx";

const DEFAULT_STAFF_PASSWORD = "nv123456";
const TARGET_COMPANY_CODE = (argValue("code") || "HRP").toUpperCase();
// Username staff tạo tự động: "<code>__<hotenlien><code>" (vd ABC__hoangminhhaiabc).
// Tên viết liền không dấu + hậu tố code; username unique toàn hệ thống nên hậu tố
// code giúp hai công ty có cùng tên người tuyển không đụng nhau.
const STAFF_USERNAME_PREFIX = `${TARGET_COMPANY_CODE.toLowerCase()}__`;
const STAFF_USERNAME_SUFFIX = TARGET_COMPANY_CODE.toLowerCase();
const staffUsernameFor = (fullName) => {
  const compactName = normalizeLabel(fullName).replace(/[^a-z0-9]+/g, "");
  return `${STAFF_USERNAME_PREFIX}${compactName}${STAFF_USERNAME_SUFFIX}`;
};
const BATCH_SIZE = 40; // Số request tối đa trong 1 batch

// ============================================================================
// KẾT NỐI POCKETBASE
// ============================================================================

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
        return [line.slice(0, i), line.slice(i + 1).replace(/^['\"]|['\"]$/g, "")];
      }),
  );
}

const env = loadEnv();
const url = process.env.PB_URL || process.env.VITE_PB_URL || env.PB_URL || env.VITE_PB_URL;
const email = process.env.PB_ADMIN_EMAIL || env.PB_ADMIN_EMAIL;
const password = process.env.PB_ADMIN_PASSWORD || env.PB_ADMIN_PASSWORD;

if (!url || !email || !password) {
  console.error("❌ Thiếu cấu hình PocketBase (PB_URL, PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD)");
  process.exit(1);
}

const pb = new PocketBase(url);
pb.autoCancellation(false);

console.log("🔌 Đang kết nối PocketBase...");
try {
  await pb
    .collection("_superusers")
    .authWithPassword(email, password)
    .catch(() => pb.admins.authWithPassword(email, password));
  console.log("✅ Đã kết nối superadmin");
} catch (error) {
  console.error("❌ Không đăng nhập được:", error.message);
  process.exit(1);
}

// ============================================================================
// TIỆN ÍCH
// ============================================================================

function normalizeLabel(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .trim()
    .toLowerCase();
}

function normalizeId(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function normalizeCccd(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizePhone(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizeDate(value) {
  if (!value) return "";
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(value).trim();
}

function createRecordId() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(15);
  crypto.getRandomValues(bytes);
  let id = "";
  for (const byte of bytes) id += chars[byte % chars.length];
  return id;
}

function txt(value) {
  return String(value ?? "").trim();
}

// ============================================================================
// GĐ0: XÁC ĐỊNH TENANT
// ============================================================================

console.log(`\n📋 Tìm công ty code="${TARGET_COMPANY_CODE}"...`);
const companies = await pb.collection("companies").getFullList({ filter: `code="${TARGET_COMPANY_CODE}"` });
if (companies.length === 0) {
  console.error(`❌ Không tìm thấy công ty có code="${TARGET_COMPANY_CODE}"`);
  process.exit(1);
}
const company = companies[0];
const tenantId = company.id;
console.log(`✅ Tenant: ${company.name} (${tenantId})`);

// Đọc prefix từ app_settings
let prefix = TARGET_COMPANY_CODE;
try {
  const settings = await pb
    .collection("app_settings")
    .getFullList({ filter: `tenant_company="${tenantId}"`, fields: "account_code_prefix" });
  if (settings[0]?.account_code_prefix) {
    prefix = settings[0].account_code_prefix.toUpperCase();
  }
} catch (err) {
  console.warn(`⚠️  Không đọc được app_settings, dùng prefix="${prefix}"`);
}
console.log(`   Prefix: ${prefix}`);

// ============================================================================
// GĐ1: ĐỌC FILE EXCEL
// ============================================================================

console.log(`\n📂 Đọc file: ${FILE_PATH}`);
if (!fs.existsSync(FILE_PATH)) {
  console.error(`❌ File không tồn tại: ${FILE_PATH}`);
  process.exit(1);
}

const workbook = XLSX.readFile(FILE_PATH, { cellDates: true });
const sheetName = workbook.SheetNames.find((s) => normalizeLabel(s) === "history") || workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];
const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: true });

console.log(`✅ Đọc được ${rawRows.length} dòng từ sheet "${sheetName}"`);

// Gom theo ID
const workerGroups = new Map();
for (const [index, raw] of rawRows.entries()) {
  const id = normalizeId(raw.ID || raw.id);
  if (!id) {
    console.warn(`⚠️  Dòng ${index + 2}: thiếu ID, bỏ qua`);
    continue;
  }
  if (!workerGroups.has(id)) workerGroups.set(id, []);
  workerGroups.get(id).push({ rowNumber: index + 2, raw });
}

console.log(`   Gom được ${workerGroups.size} NLĐ (có ${rawRows.length - workerGroups.size} dòng lịch sử bổ sung)`);

// ============================================================================
// GĐ2: GIẢI QUYẾT THAM CHIẾU
// ============================================================================

console.log(`\n🔍 Kiểm tra nhà máy, nhà chính, vendor, người tuyển...`);

// Nhà máy
const existingFactories = await pb.collection("factories").getFullList({
  filter: `tenant_company="${tenantId}"`,
  fields: "id,name,code,status",
});
const factoryByName = new Map(
  existingFactories.filter((f) => f.name).map((f) => [normalizeLabel(f.name), f]),
);

const factoryNames = new Set();
for (const rows of workerGroups.values()) {
  for (const { raw } of rows) {
    const name = txt(raw["Công ty"]);
    if (name) factoryNames.add(name);
  }
}

const missingFactories = [...factoryNames].filter((name) => !factoryByName.has(normalizeLabel(name)));
console.log(`   Nhà máy: ${existingFactories.length} có sẵn, ${missingFactories.length} cần tạo`);
if (missingFactories.length > 0) {
  console.log(`   → Sẽ tạo: ${missingFactories.slice(0, 5).join(", ")}${missingFactories.length > 5 ? "..." : ""}`);
}

// Nhà chính + Vendor
const existingEntities = await pb.collection("recruitment_entities").getFullList({
  filter: `tenant_company="${tenantId}"`,
  fields: "id,name,status",
});
const entityByName = new Map(
  existingEntities.filter((e) => e.name).map((e) => [normalizeLabel(e.name), e]),
);

const entityNames = new Set();
for (const rows of workerGroups.values()) {
  for (const { raw } of rows) {
    const main = txt(raw["Nhà chính"]);
    const vendor = txt(raw.Vendor);
    if (main) entityNames.add(main);
    if (vendor) entityNames.add(vendor);
  }
}

const missingEntities = [...entityNames].filter((name) => !entityByName.has(normalizeLabel(name)));
console.log(`   Nhà chính/Vendor: ${existingEntities.length} có sẵn, ${missingEntities.length} cần tạo`);
if (missingEntities.length > 0) {
  console.log(`   → Sẽ tạo: ${missingEntities.join(", ")}`);
}

// Người tuyển (staff)
const existingUsers = await pb.collection("users").getFullList({
  filter: `tenant_company="${tenantId}" && (role="admin" || role="staff")`,
  fields: "id,username,full_name,role",
});
const userByFullName = new Map(
  existingUsers.filter((u) => u.full_name).map((u) => [normalizeLabel(u.full_name), u]),
);

const recruiterNames = new Set();
for (const rows of workerGroups.values()) {
  for (const { raw } of rows) {
    const recruiter = txt(raw["Người tuyển"]);
    if (recruiter) recruiterNames.add(recruiter);
  }
}

const missingRecruiters = [...recruiterNames].filter((name) => !userByFullName.has(normalizeLabel(name)));
console.log(`   Người tuyển: ${existingUsers.length} staff có sẵn, ${missingRecruiters.length} cần tạo`);
if (missingRecruiters.length > 0) {
  console.log(`   → Sẽ tạo tài khoản staff:`);
  missingRecruiters.forEach((name, i) => console.log(`      ${i + 1}. ${name}`));
}

// ============================================================================
// GĐ3: CHUẨN BỊ DỮ LIỆU
// ============================================================================

console.log(`\n⚙️  Chuẩn bị dữ liệu workers + histories...`);

const preparedWorkers = [];
const errors = [];

for (const [workerId, rows] of workerGroups) {
  // Chọn profile gốc từ dòng đầu
  const first = rows[0].raw;
  const fullName = txt(first["Họ tên"]) || "NLĐ chưa có tên";
  const phone = normalizePhone(first.SĐT || first["SĐT"] || "");
  const cccd = normalizeCccd(first["Số CCCD"] || "");
  const gender = txt(first["Giới tính"]);
  const dateOfBirth = normalizeDate(first["Ngày sinh"]);
  const address = txt(first["Địa chỉ"]);
  const bankName = txt(first["Ngân hàng"]);
  const bankAccountNumber = normalizePhone(first["Số tài khoản"] || "");
  const bankAccountName = txt(first["Chủ tài khoản"]);

  // Chuẩn bị lịch sử
  const histories = [];
  for (const { raw, rowNumber } of rows) {
    const factoryName = txt(raw["Công ty"]);
    const mainHouseName = txt(raw["Nhà chính"]);
    const recruiterName = txt(raw["Người tuyển"]);
    const vendorName = txt(raw.Vendor);
    const joinDate = normalizeDate(raw["Ngày vào làm"]);
    const leaveDate = normalizeDate(raw["Ngày nghỉ"]);
    const employeeCode = txt(raw["Mã nhân viên đi làm"]);
    const note = txt(raw["Ghi chú"]);

    if (!factoryName || !joinDate) {
      errors.push({
        workerId,
        fullName,
        rowNumber,
        reason: `Thiếu ${!factoryName ? "Công ty" : "Ngày vào làm"}`,
      });
      continue;
    }

    const status = leaveDate ? "left" : "working";

    histories.push({
      rowNumber,
      factoryName,
      mainHouseName,
      recruiterName,
      vendorName,
      employeeCode,
      joinDate,
      leaveDate,
      status,
      note,
      // Snapshot
      workerNameSnapshot: txt(raw["Tên đi làm"]) || fullName,
      workerCccdSnapshot: normalizeCccd(raw["Số CCCD đi làm"]) || cccd,
      workerDateOfBirthSnapshot: dateOfBirth,
      workerAddressSnapshot: address,
    });
  }

  if (histories.length === 0) {
    errors.push({ workerId, fullName, reason: "Không có lịch sử hợp lệ" });
    continue;
  }

  // Sắp xếp theo join_date
  histories.sort((a, b) => a.joinDate.localeCompare(b.joinDate));

  // Ràng buộc DB: mỗi worker chỉ được 1 lịch sử status="working"
  // (unique index idx_emphist_one_active). Nếu có nhiều bản không có ngày nghỉ,
  // chỉ giữ bản mới nhất là "working", các bản cũ hơn chuyển thành "left".
  const workingIdx = [];
  histories.forEach((h, i) => {
    if (h.status === "working") workingIdx.push(i);
  });
  if (workingIdx.length > 1) {
    const keep = workingIdx[workingIdx.length - 1];
    for (const i of workingIdx) {
      if (i !== keep) histories[i].status = "left";
    }
  }

  // Company cuối
  const latestCompany = histories[histories.length - 1].factoryName;

  preparedWorkers.push({
    workerId,
    workerPayload: {
      uid: workerId,
      full_name: fullName,
      phone,
      cccd,
      cccd_issue_date: "", // Để trống theo yêu cầu
      gender,
      date_of_birth: dateOfBirth,
      address,
      bank_name: bankName,
      bank_account_number: bankAccountNumber,
      bank_account_name: bankAccountName,
      company: latestCompany,
      employee_code: histories[histories.length - 1].employeeCode,
      status: "active",
      tenant_company: tenantId,
    },
    cccdVersions: cccd
      ? [
          {
            cccd_number: cccd,
            is_current: true,
          },
        ]
      : [],
    histories,
  });
}

console.log(`✅ Chuẩn bị xong: ${preparedWorkers.length} NLĐ, ${preparedWorkers.reduce((sum, w) => sum + w.histories.length, 0)} lịch sử`);
if (errors.length > 0) {
  console.log(`⚠️  ${errors.length} lỗi:`);
  errors.slice(0, 5).forEach((e) => console.log(`   - ${e.workerId} ${e.fullName}: ${e.reason}`));
  if (errors.length > 5) console.log(`   ... và ${errors.length - 5} lỗi khác`);
}

// ============================================================================
// GĐ3b: KIỂM TRA TRÙNG UID WORKER CHÉO CÔNG TY
// idx_workers_uid là UNIQUE toàn hệ thống (không theo tenant), nên một ID trong
// Excel đã thuộc worker của công ty khác sẽ làm create thất bại giữa lúc import.
// ============================================================================

const allWorkersGlobal = await pb.collection("workers").getFullList({
  fields: "id,uid,tenant_company",
  sort: "",
});
const foreignWorkerByUid = new Map(
  allWorkersGlobal
    .filter((w) => w.uid && w.tenant_company !== tenantId)
    .map((w) => [String(w.uid), w]),
);
const uidConflicts = preparedWorkers.filter((w) => foreignWorkerByUid.has(String(w.workerId)));
if (uidConflicts.length > 0) {
  console.log(`\n🚫 ${uidConflicts.length} ID trong Excel đã thuộc worker của CÔNG TY KHÁC:`);
  uidConflicts.slice(0, 10).forEach((w) => {
    const other = foreignWorkerByUid.get(String(w.workerId));
    console.log(
      `   - ${w.workerId} (${w.workerPayload.full_name}) → đang thuộc tenant ${other.tenant_company}`,
    );
  });
  if (uidConflicts.length > 10) console.log(`   ... và ${uidConflicts.length - 10} ID khác`);
  console.log(
    `   → Phải đổi cột ID trong file sang prefix riêng của công ty này trước khi --apply.`,
  );
}

// ============================================================================
// BÁO CÁO DRY-RUN
// ============================================================================

if (!APPLY) {
  console.log(`\n📊 BÁO CÁO DRY-RUN (chưa ghi dữ liệu)`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Tenant: ${company.name} (${tenantId})`);
  console.log(`Prefix: ${prefix}`);
  console.log(`File: ${FILE_PATH}`);
  console.log(`Tổng dòng đọc: ${rawRows.length}`);
  console.log(`NLĐ sẽ tạo: ${preparedWorkers.length}`);
  console.log(`Lịch sử sẽ tạo: ${preparedWorkers.reduce((s, w) => s + w.histories.length, 0)}`);
  console.log(`\nTham chiếu sẽ tạo:`);
  console.log(`  - Nhà máy: ${missingFactories.length}`);
  console.log(`  - Nhà chính/Vendor: ${missingEntities.length}`);
  console.log(`  - Staff (người tuyển): ${missingRecruiters.length}`);
  if (missingRecruiters.length > 0) {
    console.log(`\n👤 Tài khoản staff sẽ tạo (mật khẩu: ${DEFAULT_STAFF_PASSWORD}):`);
    missingRecruiters.forEach((name, i) => {
      const username = staffUsernameFor(name);
      console.log(`   ${i + 1}. ${name} → username: ${username}`);
    });
  }
  console.log(`\n⚠️  Lỗi: ${errors.length} dòng`);
  console.log(`⚠️  ID trùng worker công ty khác: ${uidConflicts.length}`);
  console.log(`\n💡 Chạy lại với --apply để ghi dữ liệu vào PocketBase`);
  console.log(
    `   node scripts/migrate-hrp-history.mjs --code=${TARGET_COMPANY_CODE} --file="${FILE_PATH}" --apply`,
  );
  process.exit(0);
}

if (uidConflicts.length > 0) {
  console.error(
    `\n❌ Dừng --apply: ${uidConflicts.length} ID đã thuộc worker công ty khác (uid unique toàn hệ thống).`,
  );
  console.error(`   Sửa cột ID trong file Excel rồi chạy lại dry-run.`);
  process.exit(1);
}

// ============================================================================
// GĐ4: GHI DỮ LIỆU (--apply)
// ============================================================================

console.log(`\n🚀 BẮT ĐẦU GHI DỮ LIỆU (--apply)`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

// Tạo nhà máy thiếu
console.log(`\n🏭 Tạo ${missingFactories.length} nhà máy...`);
for (const name of missingFactories) {
  try {
    const factory = await pb.collection("factories").create({
      name,
      code: "",
      address: "",
      hotline: "",
      status: "active",
      tenant_company: tenantId,
      note: "Tạo tự động từ import lịch sử",
    });
    factoryByName.set(normalizeLabel(name), factory);
    console.log(`   ✅ ${name}`);
  } catch (error) {
    console.error(`   ❌ ${name}: ${error.message}`);
  }
}

// Tạo nhà chính/vendor thiếu
console.log(`\n🏠 Tạo ${missingEntities.length} nhà chính/vendor...`);
for (const name of missingEntities) {
  try {
    const entity = await pb.collection("recruitment_entities").create({
      name,
      address: "",
      hotline: "",
      status: "active",
      tenant_company: tenantId,
      note: "Tạo tự động từ import lịch sử",
    });
    entityByName.set(normalizeLabel(name), entity);
    console.log(`   ✅ ${name}`);
  } catch (error) {
    console.error(`   ❌ ${name}: ${error.message}`);
  }
}

// Tạo tài khoản staff thiếu
console.log(`\n👤 Tạo ${missingRecruiters.length} tài khoản staff...`);
for (const name of missingRecruiters) {
  const username = staffUsernameFor(name);
  try {
    const user = await pb.collection("users").create({
      username,
      full_name: name,
      password: DEFAULT_STAFF_PASSWORD,
      passwordConfirm: DEFAULT_STAFF_PASSWORD,
      role: "staff",
      tenant_company: tenantId,
      status: "active",
    });
    userByFullName.set(normalizeLabel(name), user);
    console.log(`   ✅ ${name} → ${username}`);
  } catch (error) {
    console.error(`   ❌ ${name}: ${error.message}`);
  }
}

// Ghi workers + histories
console.log(`\n💼 Ghi ${preparedWorkers.length} NLĐ + lịch sử...`);

// Prefetch dữ liệu hiện có để idempotent (chạy lại an toàn, không tạo trùng)
// Lưu ý: KHÔNG dùng sort:"created" vì collection không có field đó -> lỗi 400
console.log(`   🔎 Nạp dữ liệu hiện có để tránh tạo trùng...`);
const existingWorkersList = await pb.collection("workers").getFullList({
  filter: `tenant_company="${tenantId}"`,
  fields: "id,uid",
  sort: "",
});
const workerByUid = new Map(existingWorkersList.map((w) => [String(w.uid), w]));

const existingCccdList = await pb.collection("cccd_versions").getFullList({
  filter: `tenant_company="${tenantId}"`,
  fields: "id,worker",
  sort: "",
});
const workersWithCccd = new Set(existingCccdList.map((c) => c.worker));

const existingHistList = await pb.collection("employment_histories").getFullList({
  filter: `tenant_company="${tenantId}"`,
  fields: "id,worker,factory,join_date,uid",
  sort: "",
});
const histSigByWorker = new Map();
const dateKey = (v) => String(v ?? "").slice(0, 10);
for (const h of existingHistList) {
  if (!histSigByWorker.has(h.worker)) histSigByWorker.set(h.worker, new Set());
  histSigByWorker.get(h.worker).add(`${h.factory}|${dateKey(h.join_date)}`);
}

// Bộ cấp UID lịch sử theo định dạng của ứng dụng: {PREFIX}{yy}{mm}{seq4}.
// uid là trường bắt buộc + unique (idx_employment_histories_uid_unique).
// Khởi tạo seq mỗi kỳ (năm-tháng) từ UID lớn nhất đang có để không trùng.
const HISTORY_UID_PREFIX = prefix || TARGET_COMPANY_CODE;
const seqByPeriod = new Map();
const periodOf = (isoDate) => {
  const yy = isoDate.slice(2, 4);
  const mm = isoDate.slice(5, 7);
  return `${yy}${mm}`;
};
for (const h of existingHistList) {
  const uid = String(h.uid || "");
  const m = uid.match(new RegExp(`^${HISTORY_UID_PREFIX}(\\d{2})(\\d{2})(\\d{4})$`));
  if (!m) continue;
  const period = `${m[1]}${m[2]}`;
  const seq = parseInt(m[3], 10);
  if (seq > (seqByPeriod.get(period) || 0)) seqByPeriod.set(period, seq);
}
const allocHistoryUid = (isoJoinDate) => {
  const period = periodOf(isoJoinDate);
  const next = (seqByPeriod.get(period) || 0) + 1;
  if (next > 9999) throw new Error(`Vượt 9999 UID lịch sử trong kỳ ${period}`);
  seqByPeriod.set(period, next);
  return `${HISTORY_UID_PREFIX}${period}${String(next).padStart(4, "0")}`;
};

console.log(
  `   → ${workerByUid.size} worker, ${workersWithCccd.size} cccd, ${existingHistList.length} lịch sử đã có (prefix UID lịch sử: ${HISTORY_UID_PREFIX})`,
);

let successCount = 0;
let failCount = 0;
let createdWorkers = 0;
let reusedWorkers = 0;
let createdHistories = 0;
let skippedHistories = 0;

for (const worker of preparedWorkers) {
  try {
    // Tạo worker nếu chưa có, ngược lại tái sử dụng bản ghi hiện có
    let workerRecord = workerByUid.get(String(worker.workerId));
    if (!workerRecord) {
      workerRecord = await pb.collection("workers").create(worker.workerPayload);
      workerByUid.set(String(worker.workerId), workerRecord);
      createdWorkers++;
    } else {
      reusedWorkers++;
    }

    // Tạo cccd_versions nếu worker chưa có bản nào
    if (worker.cccdVersions.length > 0 && !workersWithCccd.has(workerRecord.id)) {
      for (const version of worker.cccdVersions) {
        await pb.collection("cccd_versions").create({
          ...version,
          worker: workerRecord.id,
          tenant_company: tenantId,
        });
      }
      workersWithCccd.add(workerRecord.id);
    }


    // Tạo employment_histories (bỏ qua bản đã tồn tại theo factory + join_date)
    const workerSigs = histSigByWorker.get(workerRecord.id) || new Set();
    for (const history of worker.histories) {
      const factory = factoryByName.get(normalizeLabel(history.factoryName));
      const mainHouse = history.mainHouseName
        ? entityByName.get(normalizeLabel(history.mainHouseName))
        : null;
      const recruiterStaff = history.recruiterName
        ? userByFullName.get(normalizeLabel(history.recruiterName))
        : null;
      const recruiterPartner = history.vendorName
        ? entityByName.get(normalizeLabel(history.vendorName))
        : null;

      if (!factory) {
        console.warn(`   ⚠️  ${worker.workerId}: Không tìm thấy factory "${history.factoryName}"`);
        errors.push({ workerId: worker.workerId, rowNumber: history.rowNumber, reason: `Không tìm thấy nhà máy "${history.factoryName}"` });
        continue;
      }

      // main_house là trường bắt buộc trên employment_histories
      if (!mainHouse) {
        console.warn(`   ⚠️  ${worker.workerId}: Thiếu/không khớp Nhà chính "${history.mainHouseName}"`);
        errors.push({ workerId: worker.workerId, rowNumber: history.rowNumber, reason: `Thiếu/không khớp Nhà chính "${history.mainHouseName}"` });
        continue;
      }

      const sig = `${factory.id}|${dateKey(history.joinDate)}`;
      if (workerSigs.has(sig)) {
        skippedHistories++;
        continue;
      }

      await pb.collection("employment_histories").create({
        uid: allocHistoryUid(dateKey(history.joinDate)),
        worker: workerRecord.id,
        factory: factory.id,
        main_house: mainHouse.id,
        employee_code: history.employeeCode,
        worker_name_snapshot: history.workerNameSnapshot,
        worker_cccd_snapshot: history.workerCccdSnapshot,
        worker_date_of_birth_snapshot: history.workerDateOfBirthSnapshot,
        worker_address_snapshot: history.workerAddressSnapshot,
        hometown_snapshot: history.workerAddressSnapshot,
        cccd_issue_date: "",
        recruiter_staff: recruiterStaff?.id || "",
        recruiter_partner: recruiterPartner?.id || "",
        join_date: history.joinDate,
        leave_date: history.leaveDate,
        status: history.status,
        note: history.note,
        tenant_company: tenantId,
      });
      workerSigs.add(sig);
      createdHistories++;
    }
    histSigByWorker.set(workerRecord.id, workerSigs);

    successCount++;
    if (successCount % 10 === 0) {
      console.log(`   ✅ Đã ghi ${successCount}/${preparedWorkers.length}...`);
    }
  } catch (error) {
    failCount++;
    const errorDetail = error?.response?.data || error?.response || error;
    const errorMsg = error?.response?.message || error?.message || String(error);
    console.error(`   ❌ ${worker.workerId} ${worker.workerPayload.full_name}: ${errorMsg}`);
    if (error?.response?.data) {
      console.error(`      Chi tiết:`, JSON.stringify(error.response.data));
    }
    errors.push({
      workerId: worker.workerId,
      fullName: worker.workerPayload.full_name,
      reason: errorMsg,
      detail: errorDetail,
    });
  }
}

// ============================================================================
// KẾT QUẢ
// ============================================================================

console.log(`\n✨ HOÀN TẤT`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`NLĐ xử lý thành công: ${successCount}`);
console.log(`  - Worker tạo mới:     ${createdWorkers}`);
console.log(`  - Worker tái sử dụng: ${reusedWorkers}`);
console.log(`Lịch sử tạo mới:        ${createdHistories}`);
console.log(`Lịch sử bỏ qua (đã có): ${skippedHistories}`);
console.log(`NLĐ thất bại: ${failCount}`);
console.log(`Lỗi tổng: ${errors.length}`);

if (errors.length > 0) {
  const errorFile = path.join(
    __dirname,
    "..",
    `import_${TARGET_COMPANY_CODE.toLowerCase()}_errors.json`,
  );
  fs.writeFileSync(errorFile, JSON.stringify(errors, null, 2), "utf8");
  console.log(`\n📄 Chi tiết lỗi: ${errorFile}`);
}

pb.authStore.clear();
process.exit(errors.length > 0 ? 1 : 0);
