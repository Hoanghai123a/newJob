import assert from "node:assert/strict";
import test from "node:test";

const { ADVANCE_EXPORT_COLUMNS, buildAdvanceExportFilename, buildAdvanceExportRows } =
  await import("./advance-export.ts");

const sourceRow = {
  company: "Nhà máy A",
  employee_code: "NV001",
  full_name: "Nguyễn Văn A",
  amount: 1500000,
  join_date: "2026-09-01",
  payout_method: "cash",
  bank_name: "VCB",
  bank_account_number: "0123456789",
  bank_account_name: "NGUYEN VAN A",
  phone: "0900000000",
  requester_name: "Trần Thị B",
  original_amount: 2000000,
  reason: "Khó khăn đột xuất",
  status: "accepted",
  disbursed: true,
  recovery_status: "recovered",
  admin_note: "Đã kiểm tra",
  recruiter_note: "Đã xác nhận",
  recovery_note: "Đã thu đủ",
  created: "2026-09-02T08:30:00+07:00",
  resolved_at: "2026-09-03T09:00:00+07:00",
  disbursed_at: "2026-09-04T10:00:00+07:00",
  recovered_at: "2026-09-05T11:00:00+07:00",
};

test("xuất ứng lương giữ đúng 24 cột theo thứ tự yêu cầu", () => {
  const [row] = buildAdvanceExportRows([sourceRow]);

  assert.deepEqual(Object.keys(row), ADVANCE_EXPORT_COLUMNS);
  assert.equal("Mã nhân viên người báo" in row, false);
  assert.equal("Nhà máy người báo" in row, false);
  assert.equal("Số điện thoại người báo" in row, false);
});

test("ánh xạ đúng dữ liệu ứng lương và nhãn tiếng Việt", () => {
  const [row] = buildAdvanceExportRows([sourceRow]);

  assert.equal(row["Nhà máy"], "Nhà máy A");
  assert.equal(row["Mã nhân viên"], "NV001");
  assert.equal(row["Số tiền"], 1500000);
  assert.equal(row["Ngày vào làm"], "01/09/2026");
  assert.equal(row["Hình thức nhận tiền"], "Tiền mặt");
  assert.equal(row["Ngân hàng"], "VCB");
  assert.equal(row["Người báo ứng"], "Trần Thị B");
  assert.equal(row["Số tiền ban đầu"], 2000000);
  assert.equal(row["Trạng thái"], "Đã tiếp nhận");
  assert.equal(row["Đã giải ngân"], "Có");
  assert.equal(row["Thu hồi"], "Đã thu hồi");
  assert.equal(row["Ngày gửi"], "02/09/2026");
  assert.equal(row["Ngày thu hồi"], "05/09/2026");
});

test("tên file có mã tenant và timestamp cục bộ", () => {
  const date = new Date(2026, 8, 8, 15, 4, 6);
  assert.equal(buildAdvanceExportFilename("hrp", date), "ung_luong_HRP_20260908_150406.xlsx");
  assert.equal(
    buildAdvanceExportFilename("Công ty A", date),
    "ung_luong_C_NG_TY_A_20260908_150406.xlsx",
  );
});
