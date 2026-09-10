#!/usr/bin/env node
/**
 * Kiểm tra đơn giản workers của công ty HL
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

console.log(`Company HL: ${hlCompany?.name} (${hlCompany?.id})\n`);

// Lấy tất cả collections
console.log("📋 Kiểm tra collections có sẵn:");
try {
  const collections = await pb.collections.getFullList();
  const workerCollections = collections.filter(
    (c) => c.name.toLowerCase().includes("worker") || c.name.toLowerCase().includes("staff"),
  );

  if (workerCollections.length > 0) {
    console.log("\nCác collection liên quan đến worker/staff:");
    for (const col of workerCollections) {
      console.log(`  - ${col.name} (${col.id})`);
    }
  }

  // Thử lấy workers
  console.log("\n🔍 Thử truy cập các collection:");
  for (const col of workerCollections) {
    try {
      const count = await pb.collection(col.name).getList(1, 1, {
        filter: `tenant_company="${hlCompany.id}"`,
      });
      console.log(`  ✅ ${col.name}: ${count.totalItems} bản ghi`);
    } catch (err) {
      console.log(`  ❌ ${col.name}: Lỗi truy cập - ${err.message}`);
    }
  }
} catch (err) {
  console.log(`❌ Lỗi khi lấy collections: ${err.message}`);
}

// Kiểm tra users
console.log("\n📊 Users role=user của tenant HL:");
try {
  const users = await pb.collection("users").getList(1, 50, {
    filter: `tenant_company="${hlCompany.id}" && role="user"`,
    fields: "id,username,full_name,uid",
  });

  console.log(`Tổng: ${users.totalItems} users`);
  if (users.items.length > 0) {
    console.log("\nMẫu 5 users đầu tiên:");
    for (const user of users.items.slice(0, 5)) {
      console.log(`  - ${user.username} (${user.full_name}) - UID: ${user.uid}`);
    }
  }
} catch (err) {
  console.log(`❌ Lỗi khi lấy users: ${err.message}`);
}
