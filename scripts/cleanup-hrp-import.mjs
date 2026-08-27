#!/usr/bin/env node
/**
 * Cleanup script: Xóa dữ liệu một công ty đã import để test lại.
 *
 * Chạy: node scripts/cleanup-hrp-import.mjs --code=HRP [--uid-prefix=HRP] [--apply]
 *
 *   --code        Company code trong `companies` (mặc định HRP)
 *   --uid-prefix  Prefix uid worker cần xóa (mặc định = --code)
 *   --apply       Xóa thật. Không có cờ này = DRY-RUN, chỉ đếm.
 *
 * Phạm vi xóa (chỉ dữ liệu do import tạo, trong tenant của --code):
 *   - employment_histories: của NLĐ có uid bắt đầu bằng uid-prefix
 *   - cccd_versions: của các NLĐ đó
 *   - workers: uid bắt đầu bằng uid-prefix
 *   - factories / recruitment_entities: note="Tạo tự động từ import lịch sử"
 *   - users: staff có username "<code>__<tên>" (KHÔNG đụng admin/tài khoản thủ công)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PocketBase from "pocketbase";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const APPLY = process.argv.includes("--apply");

function argValue(name) {
  const flag = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(flag));
  return found ? found.slice(flag.length).trim() : "";
}

const TARGET_COMPANY_CODE = (argValue("code") || "HRP").toUpperCase();
const WORKER_UID_PREFIX = (argValue("uid-prefix") || TARGET_COMPANY_CODE).toUpperCase();
const STAFF_USERNAME_PREFIX = `${TARGET_COMPANY_CODE.toLowerCase()}__`;
const AUTO_NOTE = "Tạo tự động từ import lịch sử";

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

// Xác định tenant HRP
console.log(`\n📋 Tìm công ty code="${TARGET_COMPANY_CODE}"...`);
const companies = await pb.collection("companies").getFullList({ filter: `code="${TARGET_COMPANY_CODE}"` });
if (companies.length === 0) {
  console.error(`❌ Không tìm thấy công ty có code="${TARGET_COMPANY_CODE}"`);
  process.exit(1);
}
const tenantId = companies[0].id;
console.log(`✅ Tenant: ${companies[0].name} (${tenantId})`);

// Thoát sạch: tránh crash libuv "UV_HANDLE_CLOSING" trên Windows khi gọi
// process.exit() lúc còn socket keep-alive. Đặt exitCode + flush stdout rồi thoát.
function finish(code) {
  try {
    pb.authStore.clear();
  } catch {
    /* ignore */
  }
  process.exitCode = code;
  setTimeout(() => process.exit(code), 300).unref();
}

// Xóa theo lô, chịu lỗi từng bản ghi
async function deleteMany(collection, ids) {
  let ok = 0;
  let fail = 0;
  const BATCH = 8;
  for (let i = 0; i < ids.length; i += BATCH) {
    const slice = ids.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      slice.map((id) => pb.collection(collection).delete(id)),
    );
    for (const r of results) {
      if (r.status === "fulfilled") ok++;
      else fail++;
    }
    if (ids.length > BATCH) {
      console.log(`   ... ${Math.min(i + BATCH, ids.length)}/${ids.length}`);
    }
  }
  return { ok, fail };
}

// Thu thập dữ liệu cần xóa (KHÔNG dùng sort:"created" vì collection không có field đó)
console.log(`\n🔎 Thu thập dữ liệu HRP cần xóa...`);

const allWorkers = await pb.collection("workers").getFullList({
  filter: `tenant_company="${tenantId}"`,
  fields: "id,uid",
  sort: "",
});
const importedWorkers = allWorkers.filter((w) =>
  String(w.uid || "")
    .toUpperCase()
    .startsWith(WORKER_UID_PREFIX),
);
const importedWorkerIds = new Set(importedWorkers.map((w) => w.id));

const allHist = await pb.collection("employment_histories").getFullList({
  filter: `tenant_company="${tenantId}"`,
  fields: "id,worker,uid",
  sort: "",
});
const histToDelete = allHist.filter((h) => importedWorkerIds.has(h.worker));

const allCccd = await pb.collection("cccd_versions").getFullList({
  filter: `tenant_company="${tenantId}"`,
  fields: "id,worker",
  sort: "",
});
const cccdToDelete = allCccd.filter((c) => importedWorkerIds.has(c.worker));

const allFactories = await pb.collection("factories").getFullList({
  filter: `tenant_company="${tenantId}"`,
  fields: "id,name,note",
  sort: "",
});
const factoriesToDelete = allFactories.filter((f) => String(f.note || "") === AUTO_NOTE);

const allEntities = await pb.collection("recruitment_entities").getFullList({
  filter: `tenant_company="${tenantId}"`,
  fields: "id,name,note",
  sort: "",
});
const entitiesToDelete = allEntities.filter((e) => String(e.note || "") === AUTO_NOTE);

const allStaff = await pb.collection("users").getFullList({
  filter: `tenant_company="${tenantId}" && role="staff"`,
  fields: "id,username,full_name,role",
  sort: "",
});
// Chỉ xóa staff do import tự tạo: username = "hrp__" + tên (chỉ chữ + gạch dưới).
// Bỏ qua tài khoản thủ công như "hrp__nvhrp1" (có chữ số) để không xóa nhầm.
const staffToDelete = allStaff.filter((u) => {
  const un = String(u.username || "");
  return un.startsWith(STAFF_USERNAME_PREFIX) && !/\d/.test(un.slice(STAFF_USERNAME_PREFIX.length));
});

// Báo cáo
console.log(`\n📊 SẼ XÓA (tenant ${TARGET_COMPANY_CODE}):`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(
  `  employment_histories : ${histToDelete.length} / ${allHist.length} (giữ lại ${allHist.length - histToDelete.length} không thuộc import)`,
);
console.log(`  cccd_versions        : ${cccdToDelete.length} / ${allCccd.length}`);
console.log(
  `  workers (uid ${WORKER_UID_PREFIX})    : ${importedWorkers.length} / ${allWorkers.length}`,
);
console.log(`  factories (auto)     : ${factoriesToDelete.length} / ${allFactories.length}`);
console.log(`  recruitment_entities : ${entitiesToDelete.length} / ${allEntities.length}`);
console.log(
  `  users staff (${STAFF_USERNAME_PREFIX})  : ${staffToDelete.length} / ${allStaff.length} (KHÔNG đụng admin)`,
);
if (!APPLY) {
  console.log(`\n💡 Đây là DRY-RUN, chưa xóa gì. Chạy lại với --apply để xóa thật:`);
  console.log(`   node scripts/cleanup-hrp-import.mjs --code=${TARGET_COMPANY_CODE} --apply`);
  finish(0);
} else {
  // Xóa theo thứ tự phụ thuộc: histories → cccd → workers → factories/entities → staff
  console.log(`\n🗑️  BẮT ĐẦU XÓA (--apply)`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  const summary = {};

  console.log(`\n1) employment_histories (${histToDelete.length})...`);
  summary.histories = await deleteMany("employment_histories", histToDelete.map((h) => h.id));

  console.log(`\n2) cccd_versions (${cccdToDelete.length})...`);
  summary.cccd = await deleteMany("cccd_versions", cccdToDelete.map((c) => c.id));

  console.log(`\n3) workers (${importedWorkers.length})...`);
  summary.workers = await deleteMany("workers", importedWorkers.map((w) => w.id));

  console.log(`\n4) factories (${factoriesToDelete.length})...`);
  summary.factories = await deleteMany("factories", factoriesToDelete.map((f) => f.id));

  console.log(`\n5) recruitment_entities (${entitiesToDelete.length})...`);
  summary.entities = await deleteMany("recruitment_entities", entitiesToDelete.map((e) => e.id));

  console.log(`\n6) users staff (${staffToDelete.length})...`);
  summary.staff = await deleteMany("users", staffToDelete.map((u) => u.id));

  console.log(`\n✨ HOÀN TẤT XÓA`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  for (const [key, { ok, fail }] of Object.entries(summary)) {
    console.log(`  ${key.padEnd(12)}: xóa ${ok}${fail ? `, lỗi ${fail}` : ""}`);
  }

  const totalFail = Object.values(summary).reduce((s, x) => s + x.fail, 0);
  if (totalFail > 0) {
    console.log(`\n⚠️  Có ${totalFail} bản ghi xóa thất bại (có thể do ràng buộc khóa ngoại). Chạy lại script để dọn nốt.`);
  }

  finish(totalFail > 0 ? 1 : 0);
}



