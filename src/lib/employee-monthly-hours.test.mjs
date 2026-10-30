import assert from "node:assert/strict";
import test from "node:test";

const {
  buildEmployeeHoursRanking,
  buildEmployeeSeniorityRanking,
  latestHistoryByWorker,
  parseEmployeeMonthlyHoursImport,
} = await import("./employee-monthly-hours.ts");

test("đọc file Excel giờ theo UID lịch sử và nhận tháng dạng ngày Excel", () => {
  const result = parseEmployeeMonthlyHoursImport([
    {
      "UID lịch sử": "LS001",
      "Mã NV": "NV01",
      "Họ tên": "Nguyễn An",
      "Tên nhà máy": "Nhà máy A",
      Tháng: new Date(2026, 0, 1),
      "Số giờ HC": 176,
      "Số giờ TC": 12.5,
    },
  ]);

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.rows, [
    {
      rowNumber: 2,
      historyUid: "LS001",
      employeeCode: "NV01",
      workerName: "Nguyễn An",
      factoryName: "Nhà máy A",
      month: "2026-01",
      regularHours: 176,
      overtimeHours: 12.5,
    },
  ]);
});

test("báo cột thiếu, giờ âm hoặc khóa UID + tháng trùng", () => {
  const result = parseEmployeeMonthlyHoursImport([
    {
      "UID lịch sử": "LS001",
      "Mã NV": "NV01",
      "Họ tên": "Nguyễn An",
      "Tên nhà máy": "Nhà máy A",
      Tháng: "01/2026",
      "Số giờ HC": -1,
      "Số giờ TC": 12,
    },
    {
      "UID lịch sử": "LS001",
      "Mã NV": "NV01",
      "Họ tên": "Nguyễn An",
      "Tên nhà máy": "Nhà máy A",
      Tháng: "2026-01",
      "Số giờ HC": 1,
      "Số giờ TC": 12,
    },
  ]);

  assert.equal(result.rows.length, 0);
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0].reason, /Số giờ HC hợp lệ/);
  assert.match(result.errors[1].reason, /trùng trong file/);
  assert.match(
    parseEmployeeMonthlyHoursImport([{ "UID lịch sử": "LS001" }]).errors[0].reason,
    /Thiếu cột/,
  );
});

test("cho phép bỏ trống hoặc không có cột Mã NV khi import", () => {
  const blankCode = parseEmployeeMonthlyHoursImport([
    {
      "UID lịch sử": "LS001",
      "Mã NV": "",
      "Họ tên": "Nguyễn An",
      "Tên nhà máy": "Nhà máy A",
      Tháng: "2026-01",
      "Số giờ HC": 176,
      "Số giờ TC": 12,
    },
  ]);
  const withoutCodeColumn = parseEmployeeMonthlyHoursImport([
    {
      "UID lịch sử": "LS002",
      "Họ tên": "Trần Bình",
      "Tên nhà máy": "Nhà máy B",
      Tháng: "2026-01",
      "Số giờ HC": 160,
      "Số giờ TC": 8,
    },
  ]);

  assert.deepEqual(blankCode.errors, []);
  assert.equal(blankCode.rows[0].employeeCode, "");
  assert.deepEqual(withoutCodeColumn.errors, []);
  assert.equal(withoutCodeColumn.rows[0].employeeCode, "");
});

test("trạng thái NLĐ lấy từ lịch sử mới nhất theo ngày vào và thời điểm tạo", () => {
  const histories = [
    { id: "old", uid: "LS001", worker: "w1", factory: "f1", join_date: "2025-01-01", leave_date: "2025-03-01" },
    { id: "new", uid: "LS002", worker: "w1", factory: "f2", join_date: "2026-01-01", created: "2026-01-01 10:00:00" },
  ];

  assert.equal(latestHistoryByWorker(histories).get("w1").id, "new");
  const rows = buildEmployeeHoursRanking(
    [
      { id: "r1", employment_history: "old", month: "2025-02", regular_hours: 100, overtime_hours: 20 },
      { id: "r2", employment_history: "new", month: "2026-01", regular_hours: 120, overtime_hours: 10 },
    ],
    histories,
    { monthFrom: "2025-01", monthTo: "2026-01", status: "working", metric: "hc" },
  );

  assert.deepEqual(rows.map((row) => row.historyUid), ["LS002", "LS001"]);
  assert.ok(rows.every((row) => row.status === "working"));
  assert.equal(rows[0].rank, 1);
});

test("xếp hạng theo HC, TC hoặc tổng giờ và lọc khoảng tháng bao gồm hai đầu", () => {
  const histories = [
    { id: "h1", uid: "LS001", worker: "w1", factory: "f1", factory_name: "A", employee_code: "NV01", worker_name_snapshot: "An", join_date: "2025-01-01" },
    { id: "h2", uid: "LS002", worker: "w2", factory: "f1", factory_name: "A", employee_code: "NV02", worker_name_snapshot: "Bình", join_date: "2025-01-01" },
  ];
  const records = [
    { id: "1", employment_history: "h1", month: "2026-01", regular_hours: 160, overtime_hours: 2 },
    { id: "2", employment_history: "h1", month: "2026-02", regular_hours: 10, overtime_hours: 20 },
    { id: "3", employment_history: "h2", month: "2026-02", regular_hours: 100, overtime_hours: 30 },
    { id: "4", employment_history: "h2", month: "2026-03", regular_hours: 500, overtime_hours: 500 },
  ];

  const hc = buildEmployeeHoursRanking(records, histories, {
    monthFrom: "2026-01", monthTo: "2026-02", metric: "hc",
  });
  const tc = buildEmployeeHoursRanking(records, histories, {
    monthFrom: "2026-01", monthTo: "2026-02", metric: "tc",
  });
  const both = buildEmployeeHoursRanking(records, histories, {
    monthFrom: "2026-01", monthTo: "2026-02", metric: "both",
  });

  assert.deepEqual(hc.map((row) => row.historyUid), ["LS001", "LS002"]);
  assert.deepEqual(tc.map((row) => row.historyUid), ["LS002", "LS001"]);
  assert.deepEqual(both.map((row) => row.historyUid), ["LS001", "LS002"]);
  assert.equal(both[0].regularHours, 170);
  assert.equal(both[0].overtimeHours, 22);
});

test("xếp hạng thâm niên chỉ lấy lịch sử mới nhất đang làm và lọc nhà máy/ngày vào", () => {
  const histories = [
    { id: "h1", uid: "LS001", worker: "w1", factory: "f1", factory_name: "A", employee_code: "NV01", worker_name_snapshot: "An", join_date: "2025-01-01", leave_date: "2025-06-01" },
    { id: "h2", uid: "LS002", worker: "w1", factory: "f2", factory_name: "B", employee_code: "NV01", worker_name_snapshot: "An", join_date: "2026-01-01", accumulated_seniority_days: 120 },
    { id: "h3", uid: "LS003", worker: "w2", factory: "f1", factory_name: "A", employee_code: "NV02", worker_name_snapshot: "Bình", join_date: "2025-01-01", leave_date: "2025-02-01" },
  ];
  const rows = buildEmployeeSeniorityRanking(
    histories,
    { factoryId: "f2", joinDateFrom: "2026-01-01", joinDateTo: "2026-01-31" },
    new Date(2026, 1, 1),
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].historyUid, "LS002");
  assert.equal(rows[0].seniorityDays, 151);
});
