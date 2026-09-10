#!/usr/bin/env node
/**
 * Thêm lại field `company` (text) vào collection advances và backfill giá trị
 *
 * Migration multitenancy đã nhầm xoá field này (tưởng là tenant pointer cũ,
 * thực tế là tên nhà máy). Script này:
 * 1. Thêm lại field `company` (text, optional)
 * 2. Backfill từ employment_histories.factory.name (theo thời điểm đơn tạo)
 * 3. Restore giá trị cũ từ backup sqlite (nếu có --restore-from-backup)
 *
 * Chạy: node scripts/restore-advances-company.mjs [--apply] [--restore-from-backup=PATH]
 * Mặc định: dry-run (chỉ báo cáo, không sửa)
 *
 * VD:
 *   node scripts/restore-advances-company.mjs
 *   node scripts/restore-advances-company.mjs --apply
 *   node scripts/restore-advances-company.mjs --apply --restore-from-backup=backups/pocketbase-before-hoang-long-20260821-124242/data.db
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
        return [line.slice(0, i), line.slice(i + 1).replace(/^['"]|['"]$/g, "")];
      }),
  );
}

const env = loadEnv();
const PB_URL = process.env.PB_URL || process.env.VITE_PB_URL || env.PB_URL || env.VITE_PB_URL;
const PB_EMAIL = process.env.PB_ADMIN_EMAIL || env.PB_ADMIN_EMAIL;
const PB_PASSWORD = process.env.PB_ADMIN_PASSWORD || env.PB_ADMIN_PASSWORD;

const APPLY = process.argv.includes("--apply");
const backupArg = process.argv.find((a) => a.startsWith("--restore-from-backup="));
const BACKUP_PATH = backupArg ? backupArg.split("=")[1] : null;

if (!PB_URL || !PB_EMAIL || !PB_PASSWORD) {
  console.error("❌ Thiếu cấu hình PocketBase (PB_URL, PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD)");
  process.exit(1);
}

const pb = new PocketBase(PB_URL);
pb.autoCancellation(false);

console.log(`🔌 Kết nối ${PB_URL}...`);
await pb
  .collection("_superusers")
  .authWithPassword(PB_EMAIL, PB_PASSWORD)
  .catch(() => pb.admins.authWithPassword(PB_EMAIL, PB_PASSWORD));
console.log("✅ Đã kết nối\n");

// === STEP 1: Thêm field company vào schema ===
console.log("📋 BƯỚC 1: Kiểm tra schema collection advances");
const col = await pb.collections.getOne("advances");
const hasCompany = (col.fields || []).some((f) => f.name === "company");

if (hasCompany) {
  console.log("✅ Field `company` đã tồn tại trong schema.");
} else {
  console.log("➕ Cần thêm field `company` (text, optional)");
  if (APPLY) {
    await pb.collections.update(col.id, {
      fields: [
        ...(col.fields || []),
        {
          name: "company",
          type: "text",
          required: false,
          presentable: false,
          system: false,
        },
      ],
    });
    console.log("✅ Đã thêm field `company` vào collection advances.");
  } else {
    console.log("   (dry-run: bỏ qua)");
  }
}

// === STEP 2: Load dữ liệu cũ từ backup sqlite ===
let oldValues = new Map();
if (BACKUP_PATH) {
  console.log(`\n📦 BƯỚC 2: Đọc giá trị cũ từ ${BACKUP_PATH}`);
  if (!fs.existsSync(BACKUP_PATH)) {
    console.error(`❌ Không tìm thấy file backup: ${BACKUP_PATH}`);
    process.exit(1);
  }
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(BACKUP_PATH, { readOnly: true });
    const rows = db.prepare("select id, company from advances where company!=''").all();
    db.close();
    for (const r of rows) oldValues.set(r.id, r.company);
    console.log(`✅ Đọc được ${oldValues.size} đơn có company từ backup.`);
  } catch (e) {
    console.error(`❌ Lỗi đọc backup sqlite: ${e.message}`);
    process.exit(1);
  }
} else {
  console.log("\n📦 BƯỚC 2: Bỏ qua (không dùng --restore-from-backup)");
}

// === STEP 3: Backfill từ employment_histories ===
console.log("\n🔄 BƯỚC 3: Backfill từ employment_histories.factory.name");
const advances = await pb.collection("advances").getFullList({
  fields: "id,worker,employee_code,created",
  sort: "created",
});
console.log(`📊 Tổng ${advances.length} đơn ứng.`);

const ehs = await pb.collection("employment_histories").getFullList({
  fields: "id,worker,factory,join_date,leave_date,expand",
  expand: "factory",
  sort: "-join_date",
});
const byWorker = new Map();
for (const eh of ehs) {
  if (!byWorker.has(eh.worker)) byWorker.set(eh.worker, []);
  byWorker.get(eh.worker).push(eh);
}

const dayOf = (value) => String(value || "").slice(0, 10);

const updates = [];
for (const adv of advances) {
  let source = null;
  let value = null;

  // Ưu tiên giá trị từ backup
  if (oldValues.has(adv.id)) {
    source = "backup";
    value = oldValues.get(adv.id);
  } else {
    // Dò employment_histories tại thời điểm tạo đơn
    const list = byWorker.get(adv.worker);
    if (list && list.length) {
      const createdDate = dayOf(adv.created);
      const current = list.filter(
        (e) =>
          (!e.leave_date || dayOf(e.leave_date) >= createdDate) &&
          dayOf(e.join_date) <= createdDate,
      );
      if (current.length > 0) {
        const factory = current[0].expand?.factory;
        if (factory && factory.name) {
          source = "employment_histories";
          value = factory.name;
        }
      }
    }
  }

  if (value) {
    updates.push({ id: adv.id, employee_code: adv.employee_code, source, value });
  }
}

console.log(`\n📈 Kết quả:`);
console.log(`   Từ backup:              ${updates.filter((u) => u.source === "backup").length}`);
console.log(`   Từ employment_histories: ${updates.filter((u) => u.source === "employment_histories").length}`);
console.log(`   Không tìm được:          ${advances.length - updates.length}`);

if (updates.length === 0) {
  console.log("\n✅ Không có gì để backfill.");
  process.exit(0);
}

// === STEP 4: Apply updates ===
if (APPLY) {
  console.log(`\n💾 BƯỚC 4: Áp dụng ${updates.length} cập nhật...`);
  let success = 0;
  let failed = 0;
  for (const u of updates) {
    try {
      await pb.collection("advances").update(u.id, { company: u.value });
      success++;
      if (success % 10 === 0) console.log(`   ${success}/${updates.length}...`);
    } catch (e) {
      console.error(`   ❌ ${u.employee_code} (${u.id}): ${e.message}`);
      failed++;
    }
  }
  console.log(`\n✅ Hoàn tất: ${success} thành công, ${failed} lỗi.`);
} else {
  console.log(`\n⚠️  Dry-run: không áp dụng ${updates.length} cập nhật.`);
  console.log("   Chạy lại với --apply để thực thi.");
}
