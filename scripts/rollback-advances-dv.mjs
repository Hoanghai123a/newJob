#!/usr/bin/env node
/**
 * Xoá toàn bộ phiếu ứng đã import từ DV (reason="Import từ DV")
 *
 * Chạy: node scripts/rollback-advances-dv.mjs [--apply]
 * Mặc định: dry-run (chỉ liệt kê, không xoá)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
const TARGET_COMPANY_CODE = "DV";
const IMPORT_REASON = "Import từ DV";

if (!PB_URL || !PB_EMAIL || !PB_PASSWORD) {
  console.error("❌ Thiếu cấu hình PocketBase (PB_URL, PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD)");
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
  console.error(`❌ Không tìm thấy công ty có code="${TARGET_COMPANY_CODE}"`);
  process.exit(1);
}
const company = companies[0];
console.log(`✅ Tenant: ${company.name} (${company.id})`);

const targets = await pb.collection("advances").getFullList({
  filter: `tenant_company="${company.id}" && reason="${IMPORT_REASON}"`,
  fields: "id,full_name,employee_code,amount,created",
  sort: "created",
});

console.log(`\n📋 Tìm thấy ${targets.length} bản ghi reason="${IMPORT_REASON}"`);

if (targets.length === 0) {
  console.log("   Không có gì để xoá.");
  process.exit(0);
}

// Nhóm theo phút tạo để thấy các lô import
const batches = new Map();
for (const a of targets) {
  const minute = String(a.created).slice(0, 16);
  batches.set(minute, (batches.get(minute) || 0) + 1);
}
console.log(`\n📦 Phân bổ theo thời điểm tạo:`);
for (const [minute, count] of [...batches.entries()].sort()) {
  console.log(`   ${minute} → ${count} bản ghi`);
}

console.log(`\n5 bản ghi đầu tiên:`);
for (const a of targets.slice(0, 5)) {
  console.log(`   ${a.id} | ${a.full_name} | ${a.employee_code} | ${a.amount}`);
}

if (!APPLY) {
  console.log(`\n🔍 DRY RUN — chưa xoá gì.`);
  console.log(`   Chạy lại với --apply để xoá ${targets.length} bản ghi`);
  pb.authStore.clear();
} else {
  console.log(`\n🗑️  BẮT ĐẦU XOÁ ${targets.length} bản ghi...`);

  let successCount = 0;
  let failCount = 0;
  const failures = [];

  for (const a of targets) {
    try {
      await pb.collection("advances").delete(a.id);
      successCount++;
      if (successCount % 20 === 0 || successCount === targets.length) {
        console.log(`   ✅ Đã xoá ${successCount}/${targets.length}`);
      }
    } catch (error) {
      failCount++;
      const msg = error?.response?.message || error?.message || String(error);
      failures.push({ id: a.id, full_name: a.full_name, reason: msg });
      console.error(`   ❌ ${a.id}: ${msg}`);
    }
  }

  console.log(`\n✨ HOÀN TẤT`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Đã xoá: ${successCount}`);
  console.log(`Thất bại: ${failCount}`);

  if (failures.length > 0) {
    const failFile = path.join(__dirname, "..", "rollback_advances_dv_errors.json");
    fs.writeFileSync(failFile, JSON.stringify(failures, null, 2), "utf8");
    console.log(`\n📄 Chi tiết lỗi: ${failFile}`);
    process.exitCode = 1;
  }

  pb.authStore.clear();
}
