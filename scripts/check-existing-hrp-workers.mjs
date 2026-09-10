#!/usr/bin/env node
/**
 * Script kiểm tra số lượng workers HRP đã có trong database
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

async function main() {
  try {
    console.log("🔌 Đang kết nối PocketBase...");
    await pb
      .collection("_superusers")
      .authWithPassword(email, password)
      .catch(() => pb.admins.authWithPassword(email, password));
    console.log("✅ Đã kết nối superadmin\n");

    // Tìm tenant HRP
    const companies = await pb
      .collection("companies")
      .getFullList({ filter: 'code="HRP"' });

    if (companies.length === 0) {
      console.error('❌ Không tìm thấy công ty có code="HRP"');
      process.exit(1);
    }

    const tenant = companies[0];
    console.log(`✅ Tenant: ${tenant.name} (${tenant.id})\n`);

    // Thử query đơn giản trước
    console.log("🔍 Thử query đơn giản...");
    try {
      const test1 = await pb.collection("workers").getList(1, 10, {
        filter: `tenant_company="${tenant.id}"`,
        fields: "uid,full_name",
      });
      console.log(`✅ Query cơ bản: ${test1.items.length} workers\n`);

      // Hiển thị 5 workers đầu để xem format UID
      console.log("5 workers mẫu:");
      test1.items.slice(0, 5).forEach((w, i) => {
        console.log(`  ${i + 1}. ${w.uid} - ${w.full_name}`);
      });
      console.log();
    } catch (err) {
      console.error("❌ Query cơ bản thất bại:", err.message);
    }

    // Đếm workers có prefix HRP - thử nhiều cách filter
    console.log("🔍 Thử filter với HRP prefix...\n");

    let workers = [];

    // Cách 1: Lấy tất cả rồi filter trong JS
    console.log("Cách 1: Lấy tất cả workers và filter trong JS");
    try {
      const allWorkers = await pb.collection("workers").getFullList({
        filter: `tenant_company="${tenant.id}"`,
        fields: "uid,full_name,created",
        sort: "-created",
      });
      workers = allWorkers.filter(w => w.uid && w.uid.startsWith("HRP"));
      console.log(`✅ Tìm được ${workers.length} workers có UID bắt đầu bằng HRP\n`);
    } catch (err) {
      console.error("❌ Thất bại:", err.message);

      // Cách 2: Thử query với LIKE
      console.log("\nCách 2: Thử filter với LIKE");
      try {
        workers = await pb.collection("workers").getFullList({
          filter: `tenant_company="${tenant.id}" && uid ~ "HRP"`,
          fields: "uid,full_name,created",
          sort: "-created",
        });
        console.log(`✅ Tìm được ${workers.length} workers\n`);
      } catch (err2) {
        console.error("❌ Cách 2 cũng thất bại:", err2.message);
      }
    }

    console.log(`📊 Đã có ${workers.length} NLĐ với UID bắt đầu bằng HRP\n`);

    // Hiển thị 20 NLĐ mới nhất
    console.log("20 NLĐ mới nhất:");
    workers.slice(0, 20).forEach((w, i) => {
      console.log(
        `  ${i + 1}. ${w.uid} - ${w.full_name} (${new Date(w.created).toLocaleString("vi-VN")})`
      );
    });

    if (workers.length > 20) {
      console.log(`  ... và ${workers.length - 20} NLĐ khác`);
    }
  } catch (err) {
    console.error("❌ Lỗi:", err.message);
    console.error("Chi tiết lỗi:", err);
    if (err.response) {
      console.error("Response:", err.response);
    }
    if (err.stack) {
      console.error("Stack:", err.stack);
    }
    process.exit(1);
  }
}

main();
