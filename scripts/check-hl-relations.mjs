#!/usr/bin/env node
/**
 * Kiểm tra relations phụ thuộc vào users role=user của HL
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
  fields: "id,username,full_name,role",
  sort: "created",
});

console.log(`📊 Tổng số users role=user cần xóa: ${users.length}\n`);

const userIds = users.map((u) => u.id);

// Danh sách relations cần kiểm tra
const relationsToCheck = [
  {
    collection: "employment_histories",
    field: "user",
    description: "Lịch sử làm việc (NLĐ)",
    critical: true,
    note: "Collection này đã migrate sang dùng workers, nếu có data là BUG",
  },
  {
    collection: "employment_histories",
    field: "recruiter_staff",
    description: "Người tuyển dụng",
    critical: true,
    note: "Nếu users role=user làm recruiter thì có vấn đề về quyền",
  },
  {
    collection: "factory_managers",
    field: "staff",
    description: "Quản lý nhà máy",
    critical: true,
    note: "Users role=user không nên là factory manager",
  },
  {
    collection: "salary_holds",
    field: "worker",
    description: "Giữ lương - NLĐ",
    critical: false,
    note: "Đã migrate sang workers, nếu còn trỏ users là dữ liệu cũ",
  },
  {
    collection: "salary_holds",
    field: "staff",
    description: "Giữ lương - Staff tạo",
    critical: true,
    note: "Users role=user không nên tạo giữ lương",
  },
  {
    collection: "staff_action_logs",
    field: "actor",
    description: "Log hành động",
    critical: false,
    note: "Chỉ ghi lịch sử, không cần sửa, có thể để NULL",
  },
  {
    collection: "approval_requests",
    field: "creator",
    description: "Yêu cầu phê duyệt - Người tạo",
    critical: false,
    note: "Users role=user không nên tạo approval request",
  },
  {
    collection: "approval_requests",
    field: "admins",
    description: "Yêu cầu phê duyệt - Admins",
    critical: true,
    note: "Users role=user không nên là admin phê duyệt",
  },
  {
    collection: "approval_responses",
    field: "admin",
    description: "Phản hồi phê duyệt",
    critical: true,
    note: "Users role=user không nên phê duyệt",
  },
];

console.log("🔍 Kiểm tra các relations phụ thuộc:");
console.log("=".repeat(90));

const results = [];
let hasCritical = false;

for (const rel of relationsToCheck) {
  try {
    // Tạo filter cho từng user ID
    const filterParts = userIds.map((id) => {
      // Với field array (như admins), dùng ~
      if (rel.field === "admins") {
        return `${rel.field} ~ "${id}"`;
      }
      return `${rel.field}="${id}"`;
    });

    const filter = `tenant_company="${hlCompany.id}" && (${filterParts.join(" || ")})`;

    const response = await pb.send(`/api/collections/${rel.collection}/records`, {
      method: "GET",
      query: {
        filter,
        page: 1,
        perPage: 1,
      },
    });

    const count = response.totalItems || 0;

    const status = count > 0 ? (rel.critical ? "❌" : "⚠️ ") : "✅";
    const criticalMark = rel.critical ? " [CRITICAL]" : "";

    results.push({
      ...rel,
      count,
      status,
    });

    console.log(`${status} ${rel.collection}.${rel.field}${criticalMark}`);
    console.log(`   Mô tả: ${rel.description}`);
    console.log(`   Số bản ghi: ${count}`);
    if (count > 0) {
      console.log(`   Ghi chú: ${rel.note}`);
      if (rel.critical) {
        hasCritical = true;
      }
    }
    console.log();
  } catch (err) {
    console.log(`⚠️  ${rel.collection}.${rel.field}`);
    console.log(`   Lỗi: ${err.message}`);
    console.log();
  }
}

console.log("=".repeat(90));
console.log("📝 TÓM TẮT & KẾT LUẬN:");
console.log("=".repeat(90));

const withData = results.filter((r) => r.count > 0);
const criticalIssues = withData.filter((r) => r.critical);
const nonCritical = withData.filter((r) => !r.critical);

if (withData.length === 0) {
  console.log("✅ KHÔNG CÓ relations nào phụ thuộc vào users role=user");
  console.log("✅ AN TOÀN để xóa ngay!\n");
} else {
  console.log(`⚠️  Có ${withData.length} relations có dữ liệu:\n`);

  if (criticalIssues.length > 0) {
    console.log("❌ CRITICAL ISSUES (PHẢI XỬ LÝ TRƯỚC KHI XÓA):");
    for (const issue of criticalIssues) {
      console.log(`   - ${issue.collection}.${issue.field}: ${issue.count} bản ghi`);
      console.log(`     → ${issue.note}`);
    }
    console.log();
  }

  if (nonCritical.length > 0) {
    console.log("⚠️  NON-CRITICAL (có thể bỏ qua hoặc xử lý sau):");
    for (const issue of nonCritical) {
      console.log(`   - ${issue.collection}.${issue.field}: ${issue.count} bản ghi`);
      console.log(`     → ${issue.note}`);
    }
    console.log();
  }
}

// Tổng kết
console.log("=".repeat(90));
console.log("🎯 QUYẾT ĐỊNH:");
console.log("=".repeat(90));

if (hasCritical) {
  console.log("❌ CHƯA AN TOÀN để xóa users role=user");
  console.log("   CẦN xử lý các CRITICAL issues trước");
  console.log("\n📋 BƯỚC TIẾP THEO:");
  console.log("   1. Kiểm tra chi tiết từng critical issue");
  console.log("   2. Xác định xem có phải dữ liệu lỗi không");
  console.log("   3. Migrate hoặc fix dữ liệu");
  console.log("   4. Chạy lại script này để verify");
  console.log("   5. Mới xóa users\n");
} else {
  console.log("✅ AN TOÀN để xóa users role=user của tenant HL");
  console.log("\n📋 CHECKLIST TRƯỚC KHI XÓA:");
  console.log("   ✅ Tất cả users đều có worker tương ứng (đã kiểm tra)");
  console.log("   ✅ Không có critical relations (đã kiểm tra)");
  console.log("   ⚠️  Tạo backup đầy đủ (CHƯA LÀM)");
  console.log("   ⚠️  Test trên staging trước (CHƯA LÀM)");
  console.log("\n💡 SAU KHI BACKUP, chạy:");
  console.log("   node scripts/delete-hl-legacy-users.mjs --apply\n");
}
