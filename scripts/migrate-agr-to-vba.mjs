#!/usr/bin/env node
/**
 * Migration script: Đổi mã ngân hàng AGR -> VBA
 *
 * Cập nhật tất cả bản ghi trong collection `users` có bank_name = "AGR"
 * thành "VBA" (Agribank).
 *
 * Usage: node scripts/migrate-agr-to-vba.mjs --code=COMPANY_CODE
 */

import PocketBase from "pocketbase";

const args = process.argv.slice(2);
const codeArg = args.find((a) => a.startsWith("--code="));

if (!codeArg) {
  console.error("❌ Thiếu tham số --code=COMPANY_CODE");
  console.error("Usage: node scripts/migrate-agr-to-vba.mjs --code=COMPANY_CODE");
  process.exit(1);
}

const companyCode = codeArg.split("=")[1];
if (!companyCode) {
  console.error("❌ Mã công ty không hợp lệ");
  process.exit(1);
}

console.log(`🔧 Migration: AGR -> VBA cho tenant [${companyCode}]`);

const pb = new PocketBase("http://127.0.0.1:8090");

try {
  // Đăng nhập bằng superuser
  const adminEmail = process.env.PB_ADMIN_EMAIL || "admin@example.com";
  const adminPassword = process.env.PB_ADMIN_PASSWORD || "admin123456";

  await pb.admins.authWithPassword(adminEmail, adminPassword);
  console.log("✅ Đăng nhập admin thành công");

  // Lấy app_settings của công ty
  const settings = await pb
    .collection("app_settings")
    .getFirstListItem(`company_code="${companyCode}"`)
    .catch(() => null);

  if (!settings) {
    console.error(`❌ Không tìm thấy tenant: ${companyCode}`);
    process.exit(1);
  }

  const tenant = settings.company_code;
  console.log(`📍 Tenant: ${tenant}`);

  // Tìm tất cả users có bank_name = "AGR"
  const usersWithAGR = await pb.collection("users").getFullList({
    filter: `tenant="${tenant}" && bank_name="AGR"`,
    fields: "id,username,bank_name,bank_account_number",
  });

  console.log(`\n📊 Tìm thấy ${usersWithAGR.length} bản ghi có mã ngân hàng AGR`);

  if (usersWithAGR.length === 0) {
    console.log("✅ Không có dữ liệu cần migrate");
    process.exit(0);
  }

  // Hiển thị danh sách sẽ update
  console.log("\n🔍 Các bản ghi sẽ được cập nhật:");
  usersWithAGR.forEach((user, idx) => {
    console.log(`  ${idx + 1}. ${user.username} | Tài khoản: ${user.bank_account_number || "N/A"}`);
  });

  console.log("\n⏳ Bắt đầu migration...");

  let successCount = 0;
  let errorCount = 0;

  for (const user of usersWithAGR) {
    try {
      await pb.collection("users").update(user.id, {
        bank_name: "VBA",
      });
      successCount++;
      console.log(`  ✅ Updated: ${user.username}`);
    } catch (err) {
      errorCount++;
      console.error(`  ❌ Failed: ${user.username} - ${err.message}`);
    }
  }

  console.log("\n" + "=".repeat(50));
  console.log(`✅ Hoàn thành migration`);
  console.log(`   - Thành công: ${successCount}`);
  console.log(`   - Lỗi: ${errorCount}`);
  console.log("=".repeat(50));
} catch (error) {
  console.error("\n❌ Lỗi:", error.message);
  process.exit(1);
}
