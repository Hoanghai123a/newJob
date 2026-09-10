#!/usr/bin/env node

/**
 * Script để tính và cập nhật thâm niên tích lũy cho tất cả lịch sử đi làm hiện có.
 *
 * Cách chạy:
 *   node scripts/backfill-accumulated-seniority.mjs --code=<COMPANY_CODE>
 *
 * Ví dụ:
 *   node scripts/backfill-accumulated-seniority.mjs --code=HL
 */

import PocketBase from "pocketbase";

const PB_URL = process.env.VITE_POCKETBASE_URL || "http://127.0.0.1:8090";
const ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD;

/**
 * Tính số ngày làm việc của một lịch sử đi làm.
 */
function calculateWorkingDays(history) {
  if (!history.join_date) return 0;

  const joinDate = new Date(history.join_date);
  const leaveDate = history.leave_date ? new Date(history.leave_date) : new Date();

  if (isNaN(joinDate.getTime()) || isNaN(leaveDate.getTime())) return 0;
  if (leaveDate < joinDate) return 0;

  const diffTime = leaveDate.getTime() - joinDate.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  return diffDays;
}

/**
 * Tính thâm niên tích lũy cho một lịch sử.
 */
function calculateAccumulatedSeniority(workerId, newJoinDate, allHistories) {
  const newJoin = new Date(newJoinDate);
  if (isNaN(newJoin.getTime())) return 0;

  // Lọc các lịch sử trước ngày vào mới
  const previousHistories = allHistories.filter(h => {
    if (h.worker !== workerId) return false;
    if (!h.join_date) return false;
    const hJoin = new Date(h.join_date);
    if (isNaN(hJoin.getTime())) return false;
    return hJoin < newJoin;
  });

  // Tính tổng số ngày
  let totalDays = 0;
  for (const history of previousHistories) {
    totalDays += calculateWorkingDays(history);
  }

  return totalDays;
}

async function main() {
  const args = process.argv.slice(2);
  const codeArg = args.find((arg) => arg.startsWith("--code="));

  if (!codeArg) {
    console.error("❌ Thiếu tham số --code=<COMPANY_CODE>");
    console.error("   Ví dụ: node scripts/backfill-accumulated-seniority.mjs --code=HL");
    process.exit(1);
  }

  const companyCode = codeArg.split("=")[1];
  if (!companyCode) {
    console.error("❌ Mã công ty không được để trống");
    process.exit(1);
  }

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.error("❌ Thiếu biến môi trường PB_ADMIN_EMAIL hoặc PB_ADMIN_PASSWORD");
    process.exit(1);
  }

  const pb = new PocketBase(PB_URL);

  try {
    console.log(`🔐 Đăng nhập PocketBase tại ${PB_URL}...`);
    await pb.admins.authWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD);
    console.log("✅ Đăng nhập thành công\n");

    // Tìm company
    console.log(`🔍 Tìm công ty với mã: ${companyCode}...`);
    const companies = await pb.collection("companies").getFullList({
      filter: `code = "${companyCode}"`,
    });

    if (companies.length === 0) {
      console.error(`❌ Không tìm thấy công ty với mã: ${companyCode}`);
      process.exit(1);
    }

    const company = companies[0];
    console.log(`✅ Tìm thấy công ty: ${company.name} (${company.id})\n`);

    // Lấy tất cả workers của công ty
    console.log("📋 Lấy danh sách workers...");
    const workers = await pb.collection("workers").getFullList({
      filter: `tenant_company = "${company.id}"`,
      fields: "id,full_name,uid",
    });
    console.log(`✅ Tìm thấy ${workers.length} workers\n`);

    // Lấy tất cả employment histories của công ty
    console.log("📋 Lấy tất cả lịch sử đi làm...");
    const allHistories = await pb.collection("employment_histories").getFullList({
      filter: `tenant_company = "${company.id}"`,
      sort: "join_date,created",
      fields: "id,worker,join_date,leave_date,accumulated_seniority_days",
    });
    console.log(`✅ Tìm thấy ${allHistories.length} lịch sử đi làm\n`);

    // Nhóm histories theo worker
    const historiesByWorker = new Map();
    for (const history of allHistories) {
      if (!historiesByWorker.has(history.worker)) {
        historiesByWorker.set(history.worker, []);
      }
      historiesByWorker.get(history.worker).push(history);
    }

    console.log("🔄 Bắt đầu tính toán và cập nhật...\n");

    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (const [workerId, histories] of historiesByWorker.entries()) {
      const worker = workers.find(w => w.id === workerId);
      const workerName = worker ? `${worker.full_name} (${worker.uid || workerId})` : workerId;

      console.log(`👤 Xử lý: ${workerName} - ${histories.length} lịch sử`);

      for (let i = 0; i < histories.length; i++) {
        const history = histories[i];

        // Tính thâm niên tích lũy
        const accumulatedDays = calculateAccumulatedSeniority(
          workerId,
          history.join_date,
          histories
        );

        // Kiểm tra xem có cần cập nhật không
        if (history.accumulated_seniority_days === accumulatedDays) {
          skipped++;
          continue;
        }

        try {
          await pb.collection("employment_histories").update(history.id, {
            accumulated_seniority_days: accumulatedDays,
          });

          console.log(`   ✓ Lịch sử ${i + 1}: ${accumulatedDays} ngày (ngày vào: ${history.join_date})`);
          updated++;
        } catch (error) {
          console.error(`   ✗ Lỗi cập nhật lịch sử ${history.id}: ${error.message}`);
          errors++;
        }
      }

      console.log("");
    }

    console.log("=" .repeat(60));
    console.log("📊 Kết quả:");
    console.log(`   ✅ Đã cập nhật: ${updated} lịch sử`);
    console.log(`   ⏭️  Bỏ qua: ${skipped} lịch sử (đã đúng)`);
    console.log(`   ❌ Lỗi: ${errors} lịch sử`);
    console.log("=" .repeat(60));

  } catch (error) {
    console.error("❌ Lỗi:", error);
    process.exit(1);
  }
}

main();
