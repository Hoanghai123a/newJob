#!/usr/bin/env node
/**
 * Xóa toàn bộ tài khoản có role = user trong một công ty
 *
 * Usage:
 *   node scripts/delete-users-by-role.mjs --code=HL
 *   node scripts/delete-users-by-role.mjs --code=DV --yes
 *
 * Options:
 *   --code=XX    : Mã công ty (bắt buộc)
 *   --yes        : Tự động confirm, không hỏi
 */

import fs from "node:fs";
import readline from "node:readline";
import PocketBase from "pocketbase";

// ============================================================================
// Parse arguments
// ============================================================================

const args = process.argv.slice(2);
const companyCode = args
  .find((arg) => arg.startsWith("--code="))
  ?.split("=")[1]
  ?.toUpperCase();
const autoYes = args.includes("--yes");

if (!companyCode) {
  console.error("❌ Lỗi: Thiếu tham số --code=");
  console.log("\nUsage:");
  console.log("  node scripts/delete-users-by-role.mjs --code=HL");
  console.log("  node scripts/delete-users-by-role.mjs --code=DV --yes");
  process.exit(1);
}

// ============================================================================
// Read .env
// ============================================================================

const env = fs.existsSync(".env")
  ? Object.fromEntries(
      fs
        .readFileSync(".env", "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => {
          const index = line.indexOf("=");
          return [line.slice(0, index), line.slice(index + 1).replace(/^['\"]|['\"]$/g, "")];
        }),
    )
  : {};

const url = process.env.PB_URL || env.PB_URL || process.env.VITE_PB_URL || env.VITE_PB_URL;
const email = process.env.PB_ADMIN_EMAIL || env.PB_ADMIN_EMAIL;
const password = process.env.PB_ADMIN_PASSWORD || env.PB_ADMIN_PASSWORD;

if (!url || !email || !password) {
  throw new Error("Thiếu PB_URL, PB_ADMIN_EMAIL hoặc PB_ADMIN_PASSWORD.");
}

// ============================================================================
// Connect to PocketBase
// ============================================================================

const pb = new PocketBase(url);
pb.autoCancellation(false);

await pb
  .collection("_superusers")
  .authWithPassword(email, password)
  .catch(() => pb.admins.authWithPassword(email, password));

console.log(`🔗 Đã kết nối: ${url}\n`);

// ============================================================================
// Main
// ============================================================================

const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);

try {
  // 1. Lấy company
  console.log(`1️⃣ Lấy thông tin công ty ${companyCode}...`);
  const company = await pb
    .collection("companies")
    .getFirstListItem(`code="${companyCode}"`)
    .catch(() => null);

  if (!company) {
    throw new Error(`Không tìm thấy công ty với mã ${companyCode}`);
  }

  console.log(`   ✅ ${company.name} (ID: ${company.id})\n`);

  // 2. Lấy danh sách users cần xóa
  console.log("2️⃣ Lấy danh sách users có role=user...");
  const users = await pb.collection("users").getFullList({
    filter: `tenant_company="${company.id}" && role="user"`,
    fields: "id,username,full_name,uid,cccd,created",
    sort: "created",
  });

  console.log(`   ✅ Tìm thấy ${users.length} users\n`);

  if (users.length === 0) {
    console.log("✅ Không có users nào cần xóa. Thoát.\n");
    process.exit(0);
  }

  // 3. Hiển thị danh sách
  console.log("3️⃣ Danh sách users sẽ bị xóa:");
  console.log("=".repeat(80));
  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    console.log(`${String(i + 1).padStart(3)}. ${user.username.padEnd(35)} ${user.full_name}`);
    console.log(
      `     ID: ${user.id} | UID: ${user.uid || "N/A"} | Created: ${user.created.slice(0, 10)}`,
    );
  }
  console.log("=".repeat(80));
  console.log("");

  // 4. Confirm
  if (!autoYes) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = await new Promise((resolve) => {
      rl.question(
        `⚠️  BẠN ĐỒNG Ý XÓA ${users.length} USERS Ở CÔNG TY ${company.name}? (yes/no): `,
        resolve,
      );
    });

    rl.close();

    if (answer.trim().toLowerCase() !== "yes") {
      console.log("\n❌ Đã hủy. Không xóa gì cả.\n");
      process.exit(0);
    }
    console.log("");
  }

  // 5. Xóa users
  console.log("4️⃣ Bắt đầu xóa users...");
  console.log("-".repeat(80));

  const report = {
    timestamp,
    company: { id: company.id, name: company.name, code: companyCode },
    totalUsers: users.length,
    deleted: [],
    failed: [],
  };

  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    try {
      await pb.collection("users").delete(user.id);
      console.log(
        `✅ [${i + 1}/${users.length}] Đã xóa: ${user.username} (${user.full_name})`,
      );
      report.deleted.push({
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        uid: user.uid,
        cccd: user.cccd,
        created: user.created,
      });
    } catch (err) {
      console.error(
        `❌ [${i + 1}/${users.length}] Lỗi khi xóa ${user.username}: ${err.message}`,
      );
      report.failed.push({
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        error: err.message,
      });
    }
  }

  console.log("-".repeat(80));
  console.log("");

  // 6. Lưu report
  const reportDir = "scripts/reports";
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  const reportPath = `${reportDir}/delete-users-${companyCode}-${timestamp}.json`;
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

  // 7. Tóm tắt
  console.log("📊 TÓM TẮT:");
  console.log("=".repeat(80));
  console.log(`✅ Đã xóa thành công: ${report.deleted.length} users`);
  console.log(`❌ Lỗi: ${report.failed.length} users`);
  console.log(`📄 Báo cáo đã lưu: ${reportPath}`);
  console.log("=".repeat(80));
  console.log("");

  if (report.failed.length > 0) {
    console.log("⚠️  CÁC USERS KHÔNG XÓA ĐƯỢC:");
    for (const fail of report.failed) {
      console.log(`   - ${fail.username} (${fail.full_name}): ${fail.error}`);
    }
    console.log("");
  }

  console.log("✅ Hoàn tất.\n");
} catch (err) {
  console.error("\n❌ LỖI:", err.message);
  console.error(err);
  process.exit(1);
}
