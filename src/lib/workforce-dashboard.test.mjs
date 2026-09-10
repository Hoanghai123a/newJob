import assert from "node:assert/strict";
import test from "node:test";

const {
  aggregateWorkforceDays,
  enumerateWorkforceDates,
  findMissingWorkforceRanges,
  shiftWorkforceDate,
  validateWorkforceRange,
} = await import("./workforce-dashboard.ts");

test("chia đúng các khoảng ngày còn thiếu", () => {
  const dates = enumerateWorkforceDates("2026-08-01", "2026-08-07");
  assert.deepEqual(
    findMissingWorkforceRanges(dates, new Set(["2026-08-01", "2026-08-02", "2026-08-05"])),
    [
      { from: "2026-08-03", to: "2026-08-04" },
      { from: "2026-08-06", to: "2026-08-07" },
    ],
  );
});

test("giới hạn khoảng xem 180 ngày", () => {
  assert.equal(validateWorkforceRange("2026-02-16", "2026-08-14"), "");
  assert.match(validateWorkforceRange("2026-02-15", "2026-08-14"), /180 ngày/);
});

test("tính đúng hôm qua theo ngày địa phương", () => {
  assert.equal(shiftWorkforceDate("2026-08-14", -1), "2026-08-13");
});

test("tổng hợp tuyển, nghỉ, đang làm và tuyển lần đầu", () => {
  const histories = [
    {
      id: "h1",
      user: "u1",
      factory: "f1",
      recruiter_staff: "s1",
      join_date: "2026-08-01",
      leave_date: "2026-08-05",
    },
    { id: "h2", user: "u1", factory: "f2", recruiter_partner: "p1", join_date: "2026-08-07" },
    { id: "h3", user: "u2", factory: "f1", recruiter_staff: "s1", join_date: "2026-08-03" },
  ];
  const days = aggregateWorkforceDays({
    histories,
    from: "2026-08-03",
    to: "2026-08-07",
    scope: "all",
    firstHistoryIds: new Set(["h1", "h3"]),
  });
  assert.deepEqual(
    days.map((day) => [day.date, day.joined, day.left, day.working, day.uniqueJoined]),
    [
      ["2026-08-03", 1, 0, 2, 1],
      ["2026-08-04", 0, 0, 2, 0],
      ["2026-08-05", 0, 1, 1, 0],
      ["2026-08-06", 0, 0, 1, 0],
      ["2026-08-07", 1, 0, 2, 0],
    ],
  );
  assert.deepEqual(days.find((day) => day.date === "2026-08-03").recruitedWorkers, [
    {
      id: "h3",
      employeeCode: "—",
      workerName: "—",
      factoryId: "f1",
      factoryName: "—",
      mainHouseName: "—",
      recruiterName: "—",
      recruiterId: "s1",
      recruiterSource: "internal",
      joinDate: "2026-08-03",
    },
  ]);
});

test("tính tuyển mới khi join_date có giờ trong ngày kết thúc", () => {
  const histories = [
    { id: "h1", user: "u1", recruiter_staff: "s1", join_date: "2026-08-14T08:30:00.000Z" },
    { id: "h2", user: "u2", recruiter_staff: "s1", join_date: "2026-08-15T23:59:59.000Z" },
    { id: "h3", user: "u3", recruiter_staff: "s1", join_date: "2026-08-16T00:00:00.000Z" },
  ];
  const days = aggregateWorkforceDays({
    histories,
    from: "2026-08-14",
    to: "2026-08-15",
    scope: "all",
  });
  assert.deepEqual(
    days.map((day) => day.joined),
    [1, 1],
  );
});

test("lọc nguồn tuyển trước khi tính số đang làm", () => {
  const histories = [
    { id: "h1", user: "u1", factory: "f1", recruiter_staff: "s1", join_date: "2026-08-01" },
    { id: "h2", user: "u2", factory: "f1", recruiter_partner: "p1", join_date: "2026-08-01" },
  ];
  const [day] = aggregateWorkforceDays({
    histories,
    from: "2026-08-02",
    to: "2026-08-02",
    scope: "partner",
  });
  assert.equal(day.working, 1);
  assert.equal(day.recruiters[0].source, "partner");
});
