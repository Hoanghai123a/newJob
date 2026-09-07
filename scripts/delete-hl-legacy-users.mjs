#!/usr/bin/env node
/**
 * Xóa users role=user của công ty Hoàng Long DJC (mã HL)
 *
 * ⚠️  CHỈ CHẠY SAU KHI:
 * 1. Đã chạy check-hl-relations.mjs và xác nhận AN TOÀN
 * 2. Đã tạo backup đầy đủ
 * 3. Đã test trên staging (nếu có)
 *
 * Cách dùng:
 *   node scripts/delete-hl-legacy-users.mjs          # Dry-run (xem sẽ xóa gì)
 *   node scripts/delete-hl-legacy-users.mjs --apply  # Thực tế xóa
 */

import fs from "node:fs";
import PocketBase from "pocketbase";

const APPLY = process.argv.includes("--apply");

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

const pb = new PocketBase(url);
pb.autoCancellation(false);

await pb
  .collection("_superusers")
  .authWithPassword(email, password)
  .catch(() => pb.admins.authWithPassword(email, password));

console.log("🗑️  XÓA USERS ROLE=USER CỦA CÔNG TY HOÀNG LONG DJC (HL)");
console.log("=".repeat(80));
console.log(`Mode: ${APPLY ? "🔴 APPLY (thực tế xóa)" : "🟡 DRY-RUN (chỉ xem)"}`);
console.log("=".repeat(80));
console.log();

// 1. Lấy company HL
console.log("1️⃣ Lấy thông tin công ty...");
const hlCompany = await pb
  .collection("companies")
  .getFirstListItem('code="HL"')
  .catch(() => null);

if (!hlCompany) {
  throw new Error("Không tìm thấy công ty với mã HL");
}

console.log(`   ✅ ${hlCompany.name} (ID: ${hlCompany.id})\n`);

// 2. Lấy danh sách users cần xóa
console.log("2️⃣ Lấy danh sách users role=user...");
const users = await pb.collection("users").getFullList({
  filter: `tenant_company="${hlCompany.id}" && role="user"`,
  fields: "id,username,full_name,uid,cccd,created",
  sort: "created",
});

console.log(`   ✅ Tìm thấy ${users.length} users cần xóa\n`);

if (users.length === 0) {
  console.log("✅ Không có users nào cần xóa. Kết thúc.\n");
  process.exit(0);
}

// 3. Hiển thị danh sách
console.log("3️⃣ Danh sách users sẽ bị xóa:");
console.log("-".repeat(80));
for (let i = 0; i < users.length; i++) {
  const user = users[i];
  console.log(`${String(i + 1).padStart(3)}. ${user.username.padEnd(35)} ${user.full_name}`);
  console.log(`     ID: ${user.id} | UID: ${user.uid || "N/A"} | Created: ${user.created.slice(0, 10)}`);
}
console.log("-".repeat(80));
console.log();

// 4. Verify workers tồn tại
console.log("4️⃣ Verify workers tồn tại cho tất cả users...");
const response = await pb.send("/api/collections/workers/records", {
  method: "GET",
  query: {
    filter: `tenant_company="${hlCompany.id}"`,
    perPage: 500,
  },
});
const workers = response.items || [];
const workerById = new Map(workers.map((w) => [w.id, w]));

let allHaveWorkers = true;
for (const user of users) {
  const worker = workerById.get(user.id);
  if (!worker) {
    console.log(`   ❌ User ${user.username} KHÔNG có worker tương ứng!`);
    allHaveWorkers = false;
  }
}

if (!allHaveWorkers) {
  console.log("\n❌ CÓ USERS KHÔNG CÓ WORKER - DỪNG XÓA!\n");
  throw new Error("Safety check failed: Có users không có worker");
}

console.log(`   ✅ Tất cả ${users.length} users đều có worker tương ứng\n`);

// 5. Xác nhận trước khi xóa (chỉ khi APPLY)
if (APPLY) {
  console.log("⚠️  CẢNH BÁO:");
  console.log(`   - Sắp xóa ${users.length} users role=user của tenant HL`);
  console.log("   - Hành động này KHÔNG THỂ HOÀN TÁC");
  console.log("   - Workers sẽ được giữ lại (auth_user → NULL)");
  console.log();

  // Tạo timestamp cho log
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logFile = `logs/delete-hl-users-${timestamp}.json`;

  // Tạo thư mục logs nếu chưa có
  if (!fs.existsSync("logs")) {
    fs.mkdirSync("logs", { recursive: true });
  }

  console.log("5️⃣ Bắt đầu xóa users...");
  console.log("-".repeat(80));

  const report = {
    timestamp,
    company: { id: hlCompany.id, name: hlCompany.name, code: "HL" },
    totalUsers: users.length,
    deleted: [],
    failed: [],
  };

  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    try {
      await pb.collection("users").delete(user.id);
      console.log(
        `✅ [${String(i + 1).padStart(2)}/${users.length}] Đã xóa: ${user.username} (${user.full_name})`,
      );
      report.deleted.push({
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        uid: user.uid,
      });
    } catch (err) {
      console.log(`❌ [${String(i + 1).padStart(2)}/${users.length}] Lỗi xóa ${user.username}: ${err.message}`);
      report.failed.push({
        id: user.id,
        username: user.username,
        error: err.message,
      });
    }
  }

  console.log("-".repeat(80));

  // Ghi log
  fs.writeFileSync(logFile, JSON.stringify(report, null, 2));
  console.log(`\n📄 Log đã lưu: ${logFile}\n`);

  // Tổng kết
  console.log("=".repeat(80));
  console.log("📊 KẾT QUẢ:");
  console.log("=".repeat(80));
  console.log(`✅ Đã xóa thành công: ${report.deleted.length}/${users.length} users`);
  if (report.failed.length > 0) {
    console.log(`❌ Lỗi: ${report.failed.length} users`);
    console.log("\nChi tiết lỗi:");
    for (const f of report.failed) {
      console.log(`   - ${f.username}: ${f.error}`);
    }
  }
  console.log();

  if (report.deleted.length === users.length) {
    console.log("✅ HOÀN TẤT - Đã xóa tất cả users role=user của tenant HL");
  } else {
    console.log("⚠️  HOÀN TẤT KHÔNG TRỌN VẸN - Có users không xóa được");
  }
  console.log();
} else {
  console.log("5️⃣ DRY-RUN hoàn tất");
  console.log("   → Để thực tế xóa, chạy lại với: --apply\n");
}

// 6. Gợi ý bước tiếp theo
if (APPLY && report.deleted.length > 0) {
  console.log("📋 BƯỚC TIẾP THEO:");
  console.log("   1. Verify workers vẫn tồn tại:");
  console.log("      node scripts/debug-hl-workers-api.mjs");
  console.log("   2. Test đăng nhập với workers (nếu cần)");
  console.log("   3. Kiểm tra các chức năng liên quan đến workers");
  console.log();
}
