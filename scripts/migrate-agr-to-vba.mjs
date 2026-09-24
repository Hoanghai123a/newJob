#!/usr/bin/env node
/**
 * Migration script: Đổi mã ngân hàng AGR -> VBA
 *
 * Cập nhật tất cả bản ghi trong collection `workers` có bank_name = "AGR"
 * thành "VBA" (Agribank) - áp dụng cho toàn bộ workers, không phân biệt tenant.
 *
 * Usage: node scripts/migrate-agr-to-vba.mjs
 */

import PocketBase from "pocketbase";

console.log(`🔧 Migration: AGR -> VBA cho toàn bộ workers`);

const pb = new PocketBase("http://127.0.0.1:8290");

try {
  // Đăng nhập bằng superuser
  const adminEmail = process.env.PB_ADMIN_EMAIL || "admin@ccc.com";
  const adminPassword = process.env.PB_ADMIN_PASSWORD || "Hoanghai12!";

  await pb.admins.authWithPassword(adminEmail, adminPassword);
  console.log("✅ Đăng nhập admin thành công");

  // Tìm tất cả workers có bank_name = "AGR" (toàn bộ database)
  const workersWithAGR = await pb.collection("workers").getFullList({
    filter: `bank_name="AGR"`,
    fields: "id,uid,full_name,bank_name,bank_account_number,tenant_company",
  });

  console.log(`\n📊 Tìm thấy ${workersWithAGR.length} bản ghi có mã ngân hàng AGR`);

  if (workersWithAGR.length === 0) {
    console.log("✅ Không có dữ liệu cần migrate");
    process.exit(0);
  }

  // Hiển thị danh sách sẽ update
  console.log("\n🔍 Các bản ghi sẽ được cập nhật:");
  workersWithAGR.forEach((worker, idx) => {
    console.log(`  ${idx + 1}. ${worker.uid} - ${worker.full_name} | Tài khoản: ${worker.bank_account_number || "N/A"}`);
  });

  console.log("\n⏳ Bắt đầu migration...");

  let successCount = 0;
  let errorCount = 0;

  for (const worker of workersWithAGR) {
    try {
      await pb.collection("workers").update(worker.id, {
        bank_name: "VBA",
      });
      successCount++;
      console.log(`  ✅ Updated: ${worker.uid} - ${worker.full_name}`);
    } catch (err) {
      errorCount++;
      console.error(`  ❌ Failed: ${worker.uid} - ${worker.full_name} - ${err.message}`);
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
