import assert from "node:assert/strict";
import test from "node:test";

import {
  allocateUidPlan,
  buildRollbackRows,
  duplicateGroups,
  isBatchRequestsNotAllowed,
  normalizeUid,
  parseArgs,
  rankDuplicateUsers,
} from "./uid-duplicate-tools.mjs";

function emptyMetrics() {
  return {
    employment: new Map(),
    attendance: new Map(),
    advances: new Map(),
    salaryHolds: new Map(),
    checkAttendance: new Map(),
    checkSalary: new Map(),
  };
}

test("normalizeUid chuẩn hóa khoảng trắng và chữ thường", () => {
  assert.equal(normalizeUid("  hl000331 "), "HL000331");
  assert.equal(normalizeUid(null), "");
});

test("duplicateGroups phát hiện trùng sau chuẩn hóa và bỏ qua UID rỗng", () => {
  const groups = duplicateGroups([
    { id: "a", uid: "HL000001" },
    { id: "b", uid: " hl000001 " },
    { id: "c", uid: "" },
    { id: "d", uid: "HL000002" },
  ]);
  assert.deepEqual([...groups.keys()], ["HL000001"]);
  assert.deepEqual(
    groups.get("HL000001").map((user) => user.id),
    ["a", "b"],
  );
});

test("rankDuplicateUsers ưu tiên đang làm rồi dữ liệu liên quan", () => {
  const users = [
    { id: "older", created: "2024-01-01", phone: "1" },
    { id: "active", created: "2025-01-01" },
    { id: "history", created: "2023-01-01" },
  ];
  const metrics = emptyMetrics();
  metrics.employment.set("history", 5);
  const ranked = rankDuplicateUsers(users, metrics, new Set(["active"]));
  assert.deepEqual(
    ranked.map((user) => user.id),
    ["active", "history", "older"],
  );
});

test("rankDuplicateUsers dùng ngày tạo và id khi bằng điểm", () => {
  const ranked = rankDuplicateUsers(
    [
      { id: "b", created: "2024-01-01" },
      { id: "c", created: "2023-01-01" },
      { id: "a", created: "2024-01-01" },
    ],
    emptyMetrics(),
    new Set(),
  );
  assert.deepEqual(
    ranked.map((user) => user.id),
    ["c", "a", "b"],
  );
});

test("allocateUidPlan cấp tiếp từ max giữa bộ đếm và UID hiện có", () => {
  const result = allocateUidPlan({
    users: [{ uid: "HL000010" }, { uid: "hl000012" }, { uid: "NLD999999" }],
    count: 3,
    prefix: "hl",
    counterValue: 11,
  });
  assert.deepEqual(result, {
    uids: ["HL000013", "HL000014", "HL000015"],
    startValue: 13,
    endValue: 15,
  });
});

test("buildRollbackRows giữ UID nguyên bản để khôi phục", () => {
  assert.deepEqual(
    buildRollbackRows([
      {
        user_id: "u1",
        old_uid: "HL000001",
        original_uid: " hl000001 ",
        new_uid: "HL000100",
        username: "worker",
        full_name: "Nguyễn Văn A",
      },
    ]),
    [
      {
        user_id: "u1",
        restore_uid: " hl000001 ",
        applied_uid: "HL000100",
        username: "worker",
        full_name: "Nguyễn Văn A",
      },
    ],
  );
});

test("parseArgs hỗ trợ auto, apply, reference list và output dir", () => {
  assert.deepEqual(
    parseArgs(["--auto", "--apply", "--reference-list", "accounts.txt", "--output-dir=exports"]),
    {
      apply: true,
      auto: true,
      input: "",
      outputDir: "exports",
      referenceList: "accounts.txt",
    },
  );
});

test("isBatchRequestsNotAllowed nhận diện lỗi PocketBase không hỗ trợ batch", () => {
  assert.equal(isBatchRequestsNotAllowed(new Error("Batch requests are not allowed.")), true);
  assert.equal(isBatchRequestsNotAllowed(new Error("validation failed")), false);
});
