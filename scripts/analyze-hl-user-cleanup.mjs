#!/usr/bin/env node
/**
 * Phân tích việc xóa users role=user của công ty Hoàng Long DJC (mã HL)
 *
 * Kiểm tra:
 * 1. Số lượng users role=user trong tenant HL
 * 2. Số lượng workers trong tenant HL
 * 3. Mapping giữa users và workers
 * 4. Relations từ users sang các collection khác
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

console.log("🔍 Đang phân tích dữ liệu công ty Hoàng Long DJC (mã HL)...\n");

// 1. Tìm company HL
const hlCompany = await pb
  .collection("companies")
  .getFirstListItem('code="HL"')
  .catch(() => null);

if (!hlCompany) {
  throw new Error("Không tìm thấy công ty với mã HL");
}

console.log(`✅ Tìm thấy công ty: ${hlCompany.name} (ID: ${hlCompany.id})\n`);

// 2. Đếm users role=user của tenant HL
const hlUsers = await pb.collection("users").getFullList({
  filter: `tenant_company="${hlCompany.id}" && role="user"`,
  fields: "id,username,full_name,phone,uid,cccd,status,employee_code",
  sort: "created",
});

console.log(`📊 Số lượng users role=user trong tenant HL: ${hlUsers.length}`);

// 3. Đếm workers của tenant HL
let hlWorkers = [];
try {
  hlWorkers = await pb.collection("workers").getFullList({
    filter: `tenant_company="${hlCompany.id}"`,
    fields: "id,auth_user,full_name,phone,uid,cccd,status,employee_code,source_user_id",
    sort: "created",
  });
  console.log(`📊 Số lượng workers trong tenant HL: ${hlWorkers.length}\n`);
} catch (err) {
  console.log(`⚠️  Lỗi khi lấy workers: ${err.message}`);
  console.log("   Có thể collection workers chưa tồn tại hoặc chưa có field source_user_id\n");

  // Thử lại không dùng source_user_id
  try {
    hlWorkers = await pb.collection("workers").getFullList({
      filter: `tenant_company="${hlCompany.id}"`,
      fields: "id,auth_user,full_name,phone,uid,cccd,status,employee_code",
      sort: "created",
    });
    console.log(`📊 Số lượng workers trong tenant HL: ${hlWorkers.length}\n`);
  } catch (err2) {
    console.log(`❌ Không thể lấy workers: ${err2.message}\n`);
  }
}

// 4. Kiểm tra mapping giữa users và workers
const userIds = new Set(hlUsers.map((u) => u.id));
const workerByAuthUser = new Map(
  hlWorkers.filter((w) => w.auth_user).map((w) => [w.auth_user, w]),
);
const workerBySourceUser = new Map(
  hlWorkers.filter((w) => w.source_user_id).map((w) => [w.source_user_id, w]),
);
const workerById = new Map(hlWorkers.map((w) => [w.id, w]));

let usersWithWorker = 0;
let usersWithoutWorker = [];

for (const user of hlUsers) {
  const workerViaAuth = workerByAuthUser.get(user.id);
  const workerViaSource = workerBySourceUser.get(user.id);
  const workerViaId = workerById.get(user.id); // Kiểm tra cả trường hợp ID trùng khớp

  if (workerViaAuth || workerViaSource || workerViaId) {
    usersWithWorker++;
  } else {
    usersWithoutWorker.push({
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      uid: user.uid,
      cccd: user.cccd,
    });
  }
}

console.log(`✅ Users có worker tương ứng: ${usersWithWorker}`);
console.log(`⚠️  Users KHÔNG có worker tương ứng: ${usersWithoutWorker.length}`);

if (usersWithoutWorker.length > 0) {
  console.log("\n📋 Danh sách users KHÔNG có worker:");
  for (const user of usersWithoutWorker.slice(0, 10)) {
    console.log(`  - ${user.username} (${user.full_name}) - UID: ${user.uid}, CCCD: ${user.cccd}`);
  }
  if (usersWithoutWorker.length > 10) {
    console.log(`  ... và ${usersWithoutWorker.length - 10} users khác`);
  }
}

// 5. Kiểm tra các relations từ users
console.log("\n🔗 Kiểm tra các relations từ users sang collections khác:");

// Collections có relation đến users
const relationsToCheck = [
  { collection: "factory_managers", field: "staff" },
  { collection: "employment_histories", field: "recruiter_staff" },
  { collection: "salary_holds", field: "worker" },
  { collection: "salary_holds", field: "staff" },
  { collection: "salary_holds", field: "approved_by" },
  { collection: "salary_holds", field: "rejected_by" },
  { collection: "salary_holds", field: "disbursed_by" },
  { collection: "staff_action_logs", field: "actor" },
  { collection: "approval_requests", field: "creator" },
  { collection: "approval_requests", field: "admins" },
  { collection: "approval_responses", field: "admin" },
];

const affectedRecords = {};

for (const rel of relationsToCheck) {
  try {
    const userIdList = hlUsers.map((u) => u.id);
    const filter = userIdList.map((id) => `${rel.field}="${id}"`).join(" || ");

    if (!filter) continue;

    const records = await pb.collection(rel.collection).getFullList({
      filter: `tenant_company="${hlCompany.id}" && (${filter})`,
      fields: `id,${rel.field}`,
    });

    if (records.length > 0) {
      affectedRecords[`${rel.collection}.${rel.field}`] = records.length;
    }
  } catch (err) {
    console.log(`  ⚠️  Không thể kiểm tra ${rel.collection}.${rel.field}: ${err.message}`);
  }
}

if (Object.keys(affectedRecords).length > 0) {
  console.log("\n⚠️  CÓ dữ liệu phụ thuộc vào users role=user:");
  for (const [key, count] of Object.entries(affectedRecords)) {
    console.log(`  - ${key}: ${count} bản ghi`);
  }
} else {
  console.log("\n✅ Không có dữ liệu phụ thuộc vào users role=user");
}

// 6. Tổng kết
console.log("\n" + "=".repeat(70));
console.log("📝 KẾT LUẬN:");
console.log("=".repeat(70));

if (usersWithoutWorker.length > 0) {
  console.log(`❌ CÓ ${usersWithoutWorker.length} users KHÔNG có worker tương ứng`);
  console.log("   ➜ Cần điều tra trước khi xóa");
}

if (Object.keys(affectedRecords).length > 0) {
  console.log(`❌ CÓ dữ liệu phụ thuộc vào users role=user`);
  console.log("   ➜ Cần migrate relations sang workers trước khi xóa");
}

if (usersWithoutWorker.length === 0 && Object.keys(affectedRecords).length === 0) {
  console.log("✅ AN TOÀN để xóa users role=user của tenant HL");
  console.log(`   ➜ Tất cả ${hlUsers.length} users đều có worker tương ứng`);
  console.log("   ➜ Không có relations phụ thuộc");
}

console.log("\n💡 LƯU Ý:");
console.log("   - Workers sử dụng auth_user hoặc source_user_id để liên kết với users");
console.log("   - Sau khi xóa users, auth_user sẽ NULL nhưng workers vẫn tồn tại");
console.log("   - Cần kiểm tra logic đăng nhập có dựa vào auth_user không");
