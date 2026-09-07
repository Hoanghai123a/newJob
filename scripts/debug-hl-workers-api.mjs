#!/usr/bin/env node
/**
 * Debug workers collection bằng API trực tiếp
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
console.log("1️⃣ Lấy danh sách users role=user...");
const users = await pb.collection("users").getFullList({
  filter: `tenant_company="${hlCompany.id}" && role="user"`,
  fields: "id,username,full_name,uid,cccd,employee_code",
  sort: "created",
});
console.log(`   ✅ Có ${users.length} users\n`);

// Lấy workers - thử nhiều cách
console.log("2️⃣ Lấy danh sách workers...");

let workers = [];

// Cách 1: Dùng send trực tiếp
try {
  console.log("   Thử cách 1: pb.send() trực tiếp...");
  const response = await pb.send("/api/collections/workers/records", {
    method: "GET",
    query: {
      filter: `tenant_company="${hlCompany.id}"`,
      perPage: 500,
    },
  });
  workers = response.items || [];
  console.log(`   ✅ Cách 1 thành công: ${workers.length} workers\n`);
} catch (err) {
  console.log(`   ❌ Cách 1 thất bại: ${err.message}`);

  // Cách 2: Không filter
  try {
    console.log("   Thử cách 2: Lấy tất cả workers không filter...");
    const response = await pb.send("/api/collections/workers/records", {
      method: "GET",
      query: { perPage: 500 },
    });
    const allWorkers = response.items || [];
    workers = allWorkers.filter((w) => w.tenant_company === hlCompany.id);
    console.log(
      `   ✅ Cách 2 thành công: ${allWorkers.length} total, ${workers.length} của HL\n`,
    );
  } catch (err2) {
    console.log(`   ❌ Cách 2 thất bại: ${err2.message}`);

    // Cách 3: Thử lấy từng user ID
    console.log("   Thử cách 3: Lấy workers bằng ID từ users...");
    for (const user of users.slice(0, 5)) {
      try {
        const worker = await pb.collection("workers").getOne(user.id).catch(() => null);
        if (worker && worker.tenant_company === hlCompany.id) {
          workers.push(worker);
          console.log(`      ✅ ${user.username} → worker found`);
        } else {
          console.log(`      ⚠️  ${user.username} → no worker`);
        }
      } catch (err3) {
        console.log(`      ❌ ${user.username} → error: ${err3.message}`);
      }
    }
    console.log(`   Cách 3: Tìm được ${workers.length} workers từ ${users.slice(0, 5).length} users đầu\n`);
  }
}

if (workers.length === 0) {
  console.log("❌ KHÔNG THỂ LẤY WORKERS - Dừng kiểm tra\n");
  process.exit(1);
}

// Phân tích mapping
console.log("3️⃣ Phân tích mapping users ↔ workers:");
console.log("=".repeat(90));

const workerByAuthUser = new Map(workers.filter((w) => w.auth_user).map((w) => [w.auth_user, w]));
const workerById = new Map(workers.map((w) => [w.id, w]));
const workerByUid = new Map(workers.filter((w) => w.uid).map((w) => [w.uid, w]));

console.log(`   Workers có auth_user: ${workerByAuthUser.size}`);
console.log(`   Workers có UID: ${workerByUid.size}`);
console.log();

const results = {
  viaAuth: 0,
  viaId: 0,
  viaUid: 0,
  notFound: [],
};

for (const user of users) {
  const byAuth = workerByAuthUser.get(user.id);
  const byId = workerById.get(user.id);
  const byUid = user.uid ? workerByUid.get(user.uid) : null;

  let found = null;
  let method = "";

  if (byAuth) {
    found = byAuth;
    method = "auth_user";
    results.viaAuth++;
  } else if (byId) {
    found = byId;
    method = "same_id";
    results.viaId++;
  } else if (byUid) {
    found = byUid;
    method = "uid_match";
    results.viaUid++;
  }

  const status = found ? "✅" : "❌";
  const workerName = found ? found.full_name : "NO_WORKER";
  const methodStr = method ? `[${method}]` : "";

  console.log(
    `${status} ${user.username.padEnd(35)} ${user.uid?.padEnd(10) || "".padEnd(10)} → ${workerName.padEnd(25)} ${methodStr}`,
  );

  if (!found) {
    results.notFound.push(user);
  }
}

console.log("\n" + "=".repeat(90));
console.log("📊 TÓM TẮT MAPPING:");
console.log("=".repeat(90));
console.log(`✅ Có worker qua auth_user:  ${results.viaAuth}`);
console.log(`✅ Có worker qua same ID:    ${results.viaId}`);
console.log(`✅ Có worker qua UID match:  ${results.viaUid}`);
console.log(`❌ KHÔNG có worker:          ${results.notFound.length}`);
console.log();

if (results.notFound.length > 0) {
  console.log("⚠️  CHI TIẾT USERS KHÔNG CÓ WORKER:");
  for (const user of results.notFound) {
    console.log(`   - ID: ${user.id}`);
    console.log(`     Username: ${user.username}`);
    console.log(`     Full name: ${user.full_name}`);
    console.log(`     UID: ${user.uid || "N/A"}`);
    console.log(`     CCCD: ${user.cccd || "N/A"}`);
    console.log();
  }

  console.log("🔧 CẦN TẠO WORKERS CHO CÁC USERS NÀY TRƯỚC KHI XÓA!\n");
} else {
  console.log("✅ TẤT CẢ USERS ĐỀU CÓ WORKER TƯƠNG ỨNG\n");
}

// Kiểm tra workers có auth_user NULL
const workersNoAuth = workers.filter((w) => !w.auth_user);
console.log(
  `💡 Workers không có auth_user (sẽ không bị ảnh hưởng): ${workersNoAuth.length}/${workers.length}`,
);
