#!/usr/bin/env node
/**
 * So sánh chi tiết users và workers của công ty HL
 */

import fs from "node:fs";
import PocketBase from "pocketbase";

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

// Lấy company HL
const hlCompany = await pb
  .collection("companies")
  .getFirstListItem('code="HL"')
  .catch(() => null);

console.log(`🏢 Company: ${hlCompany.name} (ID: ${hlCompany.id})\n`);

// Lấy users
const users = await pb.collection("users").getFullList({
  filter: `tenant_company="${hlCompany.id}" && role="user"`,
  fields: "id,username,full_name,uid,cccd,employee_code",
  sort: "created",
});

console.log(`📊 Users role=user: ${users.length}`);

// Lấy workers - dùng getList vì getFullList có thể bị lỗi
let workers = [];
let page = 1;
let hasMore = true;

while (hasMore) {
  const result = await pb.collection("workers").getList(page, 100, {
    filter: `tenant_company="${hlCompany.id}"`,
    sort: "created",
  });
  workers.push(...result.items);
  hasMore = result.page < result.totalPages;
  page++;
}

console.log(`📊 Workers: ${workers.length}\n`);

// Tạo map
const workerByAuthUser = new Map(workers.filter((w) => w.auth_user).map((w) => [w.auth_user, w]));
const workerById = new Map(workers.map((w) => [w.id, w]));
const workerByUid = new Map(workers.filter((w) => w.uid).map((w) => [w.uid, w]));

console.log("🔗 Phân tích mapping:\n");

let usersWithWorkerViaAuth = 0;
let usersWithWorkerViaId = 0;
let usersWithWorkerViaUid = 0;
let usersWithoutWorker = [];

for (const user of users) {
  const byAuth = workerByAuthUser.get(user.id);
  const byId = workerById.get(user.id);
  const byUid = user.uid ? workerByUid.get(user.uid) : null;

  let found = null;
  let method = "";

  if (byAuth) {
    found = byAuth;
    method = "auth_user";
    usersWithWorkerViaAuth++;
  } else if (byId) {
    found = byId;
    method = "same ID";
    usersWithWorkerViaId++;
  } else if (byUid) {
    found = byUid;
    method = "UID";
    usersWithWorkerViaUid++;
  }

  if (found) {
    console.log(
      `✅ ${user.username.padEnd(30)} → ${found.full_name.padEnd(20)} (${method})`,
    );
  } else {
    usersWithoutWorker.push(user);
    console.log(`❌ ${user.username.padEnd(30)} → KHÔNG CÓ WORKER`);
  }
}

console.log("\n" + "=".repeat(80));
console.log("📝 TÓM TẮT:");
console.log("=".repeat(80));
console.log(`✅ Users có worker qua auth_user: ${usersWithWorkerViaAuth}`);
console.log(`✅ Users có worker qua same ID: ${usersWithWorkerViaId}`);
console.log(`✅ Users có worker qua UID: ${usersWithWorkerViaUid}`);
console.log(`❌ Users KHÔNG có worker: ${usersWithoutWorker.length}\n`);

if (usersWithoutWorker.length > 0) {
  console.log("⚠️  DANH SÁCH USERS KHÔNG CÓ WORKER:");
  for (const user of usersWithoutWorker) {
    console.log(
      `   - ${user.username} (${user.full_name}) - UID: ${user.uid}, CCCD: ${user.cccd || "N/A"}`,
    );
  }
  console.log("\n❌ CHƯA AN TOÀN để xóa - cần tạo workers cho các users này trước\n");
} else {
  console.log("✅ TẤT CẢ users đều có worker tương ứng - AN TOÀN để xóa\n");
}

// Kiểm tra workers không có auth_user
const workersWithoutAuth = workers.filter((w) => !w.auth_user);
console.log(
  `💡 Số workers KHÔNG có auth_user (sẽ không bị ảnh hưởng khi xóa users): ${workersWithoutAuth.length}`,
);

// Kiểm tra relations
console.log("\n🔗 Kiểm tra các relations quan trọng:");

// staff_action_logs
try {
  const logs = await pb.collection("staff_action_logs").getList(1, 1, {
    filter: users.map((u) => `actor="${u.id}"`).join(" || "),
  });
  if (logs.totalItems > 0) {
    console.log(`   ⚠️  staff_action_logs.actor: ${logs.totalItems} bản ghi`);
    console.log("      → Không cần migrate, chỉ để lưu lịch sử");
  }
} catch (err) {
  console.log(`   ℹ️  staff_action_logs: Không kiểm tra được`);
}

// employment_histories
try {
  const empHist = await pb.collection("employment_histories").getList(1, 1, {
    filter: `tenant_company="${hlCompany.id}" && (${users.map((u) => `user="${u.id}"`).join(" || ")})`,
  });
  if (empHist.totalItems > 0) {
    console.log(`   ⚠️  employment_histories.user: ${empHist.totalItems} bản ghi`);
    console.log("      → CẦN kiểm tra xem có trỏ đến workers không");
  }
} catch (err) {
  console.log(`   ℹ️  employment_histories: Không kiểm tra được - ${err.message}`);
}
