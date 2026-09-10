#!/usr/bin/env node

/**
 * Script kiểm tra dữ liệu thâm niên tích lũy của một worker cụ thể
 */

import PocketBase from "pocketbase";

const PB_URL = process.env.VITE_POCKETBASE_URL || "http://127.0.0.1:8090";
const ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD;

async function main() {
  const workerUid = process.argv[2] || "HL000240";

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.error("❌ Thiếu biến môi trường PB_ADMIN_EMAIL hoặc PB_ADMIN_PASSWORD");
    process.exit(1);
  }

  const pb = new PocketBase(PB_URL);

  try {
    await pb.admins.authWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD);

    console.log(`🔍 Tìm worker: ${workerUid}`);
    const workers = await pb.collection("workers").getFullList({
      filter: `uid = "${workerUid}"`,
      fields: "id,uid,full_name",
    });

    if (workers.length === 0) {
      console.error(`❌ Không tìm thấy worker: ${workerUid}`);
      process.exit(1);
    }

    const worker = workers[0];
    console.log(`✅ Tìm thấy: ${worker.full_name} (${worker.id})\n`);

    console.log("📋 Lấy tất cả lịch sử...");
    const histories = await pb.collection("employment_histories").getFullList({
      filter: `worker = "${worker.id}"`,
      sort: "join_date,created",
      fields: "id,uid,employee_code,worker,join_date,leave_date,accumulated_seniority_days",
    });

    console.log(`✅ Tìm thấy ${histories.length} lịch sử:\n`);

    histories.forEach((h, i) => {
      console.log(`${i + 1}. Mã lịch sử: ${h.uid}`);
      console.log(`   Mã NV: ${h.employee_code}`);
      console.log(`   Ngày vào: ${h.join_date}`);
      console.log(`   Ngày nghỉ: ${h.leave_date || "Đang làm"}`);
      console.log(`   accumulated_seniority_days: ${h.accumulated_seniority_days ?? "null"}`);

      // Tính số ngày của lịch sử này
      const joinDate = new Date(h.join_date);
      const leaveDate = h.leave_date ? new Date(h.leave_date) : new Date();
      const days = Math.floor((leaveDate - joinDate) / (1000 * 60 * 60 * 24));
      console.log(`   Số ngày làm việc của lịch sử này: ${days} ngày`);
      console.log("");
    });

  } catch (error) {
    console.error("❌ Lỗi:", error);
    process.exit(1);
  }
}

main();
