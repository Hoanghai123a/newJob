#!/usr/bin/env node
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

const pb = new PocketBase(url);
pb.autoCancellation(false);

console.log("Kết nối PocketBase...");
await pb
  .collection("_superusers")
  .authWithPassword(email, password)
  .catch(() => pb.admins.authWithPassword(email, password));

const companies = await pb.collection("companies").getFullList({ filter: 'code="HRP"' });
const tenantId = companies[0].id;

console.log("Tenant ID:", tenantId);

// Thử tạo 1 worker test
const testWorker = {
  id: "test_worker_123456789",
  uid: "HRP999999",
  full_name: "Test Worker",
  phone: "0123456789",
  cccd: "001234567890",
  cccd_issue_date: "",
  gender: "Nam",
  date_of_birth: "1990-01-01",
  address: "Hà Nội",
  bank_name: "",
  bank_account_number: "",
  bank_account_name: "",
  company: "Test Company",
  employee_code: "TEST001",
  status: "active",
  tenant_company: tenantId,
};

console.log("\nThử tạo worker:", JSON.stringify(testWorker, null, 2));

try {
  const result = await pb.collection("workers").create(testWorker);
  console.log("\n✅ Thành công!");
  console.log("Worker ID:", result.id);

  // Xóa worker test
  await pb.collection("workers").delete(result.id);
  console.log("Đã xóa worker test");
} catch (error) {
  console.error("\n❌ Lỗi:");
  console.error("Message:", error.message);
  console.error("Response:", JSON.stringify(error.response, null, 2));
}

pb.authStore.clear();
