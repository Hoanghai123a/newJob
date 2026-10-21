#!/usr/bin/env node
/**
 * Xóa toàn bộ tài khoản có role = user trong một công ty
 *
 * Usage:
 *   node scripts/delete-users-by-role.mjs --code=HL
 *   node scripts/delete-users-by-role.mjs --code=DV --yes
 *   node scripts/delete-users-by-role.mjs --all
 *
 * Options:
 *   --code=XX    : Mã công ty (chọn --code hoặc --all)
 *   --all        : Xóa role=user toàn collection và tự xác nhận
 *   --yes        : Tự động confirm, không hỏi
 */

import fs from "node:fs";
import readline from "node:readline";

// ============================================================================
// Parse arguments
// ============================================================================

const args = process.argv.slice(2);
const BATCH_SIZE = 100;
const companyCode = args
  .find((arg) => arg.startsWith("--code="))
  ?.split("=")[1]
  ?.toUpperCase();
const deleteAll = args.includes("--all");
const autoYes = args.includes("--yes") || deleteAll;

if ((!companyCode && !deleteAll) || (companyCode && deleteAll)) {
  console.error("❌ Lỗi: Chọn đúng một trong --code=XX hoặc --all.");
  console.log("\nUsage:");
  console.log("  node scripts/delete-users-by-role.mjs --code=HL");
  console.log("  node scripts/delete-users-by-role.mjs --code=DV --yes");
  console.log("  node scripts/delete-users-by-role.mjs --all");
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

let authToken = "";

async function request(path, { method = "GET", query = {}, body } = {}) {
  const endpoint = new URL(`/api${path}`, url.endsWith("/") ? url : `${url}/`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") endpoint.searchParams.set(key, String(value));
  }

  const response = await fetch(endpoint, {
    method,
    headers: {
      ...(authToken ? { Authorization: authToken } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text };
  }
  if (!response.ok) throw new Error(data?.message || `PocketBase HTTP ${response.status}`);
  return data;
}

async function authenticate() {
  const payload = { identity: email, password };
  try {
    const result = await request("/collections/_superusers/auth-with-password", {
      method: "POST",
      body: payload,
    });
    authToken = result.token;
  } catch {
    const result = await request("/admins/auth-with-password", {
      method: "POST",
      body: payload,
    });
    authToken = result.token;
  }
}

async function getFullList(collection, query = {}) {
  const items = [];
  for (let page = 1; ; page++) {
    const result = await request(`/collections/${encodeURIComponent(collection)}/records`, {
      query: { ...query, page, perPage: BATCH_SIZE },
    });
    items.push(...(result.items || []));
    console.log(`   Đã quét ${items.length}/${result.totalItems || items.length} record...`);
    if (page >= (result.totalPages || 1)) return items;
  }
}

async function getFirstRecord(collection, query = {}) {
  const result = await request(`/collections/${encodeURIComponent(collection)}/records`, {
    query: { ...query, page: 1, perPage: 1 },
  });
  return result.items?.[0] || null;
}

async function deleteRecord(collection, id) {
  await request(
    `/collections/${encodeURIComponent(collection)}/records/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}

await authenticate();

console.log(`🔗 Đã kết nối: ${url}\n`);

// ============================================================================
// Main
// ============================================================================

const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);

try {
  let company = null;
  if (!deleteAll) {
    // 1. Lấy company
    console.log(`1️⃣ Lấy thông tin công ty ${companyCode}...`);
    company = await getFirstRecord("companies", { filter: `code="${companyCode}"` }).catch(
      () => null,
    );

    if (!company) {
      throw new Error(`Không tìm thấy công ty với mã ${companyCode}`);
    }

    console.log(`   ✅ ${company.name} (ID: ${company.id})\n`);
  } else {
    console.log("1️⃣ Xóa trong toàn bộ collection users (mọi công ty)...\n");
  }

  // 2. Lấy danh sách users cần xóa
  console.log("2️⃣ Lấy danh sách users có role=user...");
  const users = await getFullList("users", {
    filter: deleteAll ? 'role="user"' : `tenant_company="${company.id}" && role="user"`,
    fields: "id,username,full_name,uid,cccd,created",
    sort: "created",
  });

  console.log(`   ✅ Tìm thấy ${users.length} users\n`);

  if (users.length === 0) {
    console.log("✅ Không có users nào cần xóa. Thoát.\n");
    process.exit(0);
  }

  console.log(`3️⃣ Sẽ xóa ${users.length} users theo từng lô tối đa ${BATCH_SIZE} record.\n`);

  // 4. Confirm
  if (!autoYes) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = await new Promise((resolve) => {
      rl.question(
        `⚠️  BẠN ĐỒNG Ý XÓA ${users.length} USERS ${deleteAll ? "TRONG TOÀN BỘ COLLECTION" : `Ở CÔNG TY ${company.name}`}? (yes/no): `,
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
    scope: deleteAll ? "all" : "company",
    company: company ? { id: company.id, name: company.name, code: companyCode } : null,
    totalUsers: users.length,
    deleted: [],
    failed: [],
  };

  const batchCount = Math.ceil(users.length / BATCH_SIZE);
  for (let offset = 0; offset < users.length; offset += BATCH_SIZE) {
    const batch = users.slice(offset, offset + BATCH_SIZE);
    const currentBatch = Math.floor(offset / BATCH_SIZE) + 1;
    console.log(`Đang xử lý lô ${currentBatch}/${batchCount} (${batch.length} users)...`);

    for (const user of batch) {
      try {
        await deleteRecord("users", user.id);
        report.deleted.push({
          id: user.id,
          username: user.username,
          full_name: user.full_name,
          uid: user.uid,
          cccd: user.cccd,
          created: user.created,
        });
      } catch (err) {
        console.error(`❌ Lỗi khi xóa ${user.username}: ${err.message}`);
        report.failed.push({
          id: user.id,
          username: user.username,
          full_name: user.full_name,
          error: err.message,
        });
      }
    }

    console.log(
      `✅ Hoàn tất lô ${currentBatch}/${batchCount}: ${batch.length} đã xử lý, ${report.deleted.length} xóa thành công, ${report.failed.length} lỗi.`,
    );
  }

  console.log("-".repeat(80));
  console.log("");

  // 6. Lưu report
  const reportDir = "scripts/reports";
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  const reportPath = `${reportDir}/delete-users-${deleteAll ? "all" : companyCode}-${timestamp}.json`;
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
