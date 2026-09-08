#!/usr/bin/env node
/**
 * Backfill advances.company by matching advances.employee_code.
 *
 * Dry-run (default): node scripts/backfill-advances-company-by-code.mjs --file=/update-ung.xlsx
 * Apply:            node scripts/backfill-advances-company-by-code.mjs --file=/update-ung.xlsx --apply
 * Optional tenant:  node scripts/backfill-advances-company-by-code.mjs --tenant=<companyId>
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PocketBase from "pocketbase";
import XLSX from "xlsx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");
const tenantArg = process.argv.find((value) => value.startsWith("--tenant="));
const TENANT_ID = tenantArg ? tenantArg.slice("--tenant=".length).trim() : "";
const fileArg = process.argv.find((value) => value.startsWith("--file="));
const sourceArg = fileArg ? fileArg.slice("--file=".length).trim() : "";
const SOURCE_FILE = sourceArg
  ? sourceArg.startsWith("/")
    ? path.join(__dirname, "..", "public", sourceArg.replace(/^\/+/, ""))
    : path.resolve(sourceArg)
  : path.join(__dirname, "..", "public", "update-ung.xlsx");

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
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1).replace(/^['"]|['"]$/g, "")];
      }),
  );
}

const env = loadEnv();
const PB_URL = process.env.PB_URL || process.env.VITE_PB_URL || env.PB_URL || env.VITE_PB_URL;
const PB_EMAIL = process.env.PB_ADMIN_EMAIL || env.PB_ADMIN_EMAIL;
const PB_PASSWORD = process.env.PB_ADMIN_PASSWORD || env.PB_ADMIN_PASSWORD;

if (!PB_URL || !PB_EMAIL || !PB_PASSWORD) {
  console.error("Thiếu cấu hình PB_URL/VITE_PB_URL hoặc PB_ADMIN_EMAIL/PB_ADMIN_PASSWORD.");
  process.exit(1);
}

const pb = new PocketBase(PB_URL);
pb.autoCancellation(false);
await pb
  .collection("_superusers")
  .authWithPassword(PB_EMAIL, PB_PASSWORD)
  .catch(() => pb.admins.authWithPassword(PB_EMAIL, PB_PASSWORD));

const normalizeCode = (value) =>
  String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim();
if (!fs.existsSync(SOURCE_FILE)) {
  console.error(`Không tìm thấy file Excel: ${SOURCE_FILE}`);
  console.error("Đặt file tại public/update-ung.xlsx hoặc chạy với --file=<đường-dẫn-file.xlsx>.");
  process.exit(1);
}

const workbook = XLSX.readFile(SOURCE_FILE, { cellDates: false, raw: true });
const firstSheetName = workbook.SheetNames[0];
if (!firstSheetName) {
  console.error("File Excel không có worksheet nào.");
  process.exit(1);
}

const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], {
  header: 1,
  defval: "",
  raw: true,
});
const companyByCode = new Map();
const conflictingCodes = new Set();
for (const row of rows) {
  const code = normalizeCode(row?.[0]);
  const company = String(row?.[1] ?? "").trim();
  if (
    !code ||
    !company ||
    code.toUpperCase() === "MÃ NHÂN VIÊN" ||
    code.toUpperCase() === "MA NHAN VIEN"
  ) {
    continue;
  }
  const previous = companyByCode.get(code);
  if (previous && previous !== company) conflictingCodes.add(code);
  companyByCode.set(code, company);
}
if (conflictingCodes.size) {
  console.error(
    "File Excel có mã nhân viên trùng nhưng tên nhà máy khác nhau:",
    [...conflictingCodes].sort(),
  );
  process.exit(1);
}

const filters = ['employee_code != ""'];
if (TENANT_ID) filters.push(`tenant_company = \"${TENANT_ID.replaceAll('"', '\\"')}\"`);

const advances = await pb.collection("advances").getFullList({
  filter: filters.join(" && "),
  fields: "id,employee_code,company,tenant_company",
  sort: "employee_code",
});

const updates = [];
const unmatched = new Map();
const byCompany = new Map();
for (const advance of advances) {
  const code = normalizeCode(advance.employee_code);
  const company = companyByCode.get(code) || "";
  if (!company) {
    unmatched.set(code, (unmatched.get(code) || 0) + 1);
    continue;
  }
  byCompany.set(company, (byCompany.get(company) || 0) + 1);
  if (String(advance.company || "").trim() !== company) {
    updates.push({ id: advance.id, code, before: advance.company || "", value: company });
  }
}

console.log(`PocketBase: ${PB_URL}`);
console.log(`Nguồn Excel: ${SOURCE_FILE} (${firstSheetName}, ${companyByCode.size} mã nhân viên).`);
console.log(`Đã đọc ${advances.length} advances${TENANT_ID ? ` của tenant ${TENANT_ID}` : ""}.`);
console.log(`Sẽ cập nhật ${updates.length} bản ghi.`);
console.log("Phân bổ mã khớp:", Object.fromEntries(byCompany));
if (unmatched.size) {
  console.log("Mã không nhận diện (bỏ qua):", Object.fromEntries([...unmatched.entries()].sort()));
}

if (!APPLY) {
  console.log("Dry-run: chưa ghi dữ liệu. Chạy lại với --apply để cập nhật.");
  pb.authStore.clear();
  process.exitCode = 0;
  await new Promise((resolve) => setTimeout(resolve, 300));
} else {
  let success = 0;
  let failed = 0;
  for (const update of updates) {
    try {
      await pb.collection("advances").update(update.id, { company: update.value });
      success++;
    } catch (error) {
      failed++;
      console.error(
        `Lỗi ${update.code} (${update.id}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  console.log(`Hoàn tất: ${success} thành công, ${failed} lỗi.`);
}
