import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAudit,
  isValidCccd,
  normalizeCccd,
  resolveHistoryCccd,
  versionKey,
} from "./migrate-user-cccd-images.mjs";

test("chuẩn hóa và kiểm tra số CMND/CCCD", () => {
  assert.equal(normalizeCccd("001 234-567 890"), "001234567890");
  assert.equal(isValidCccd("123456789"), true);
  assert.equal(isValidCccd("001234567890"), true);
  assert.equal(isValidCccd("1234"), false);
  assert.equal(versionKey("u1", "001 234 567 890"), "u1:001234567890");
});

test("audit phát hiện history thiếu và liên kết sai version", () => {
  const users = [{ id: "u1", cccd: "001234567890", cccd_front: "front.jpg" }];
  const versions = [{ id: "v1", user: "u1", cccd_number: "999999999999", front_image: "x.jpg" }];
  const histories = [
    { id: "h1", user: "u1", worker_cccd_snapshot: "001234567890", cccd_version: "" },
    { id: "h2", user: "u1", worker_cccd_snapshot: "001234567890", cccd_version: "v1" },
    { id: "h3", user: "u1", worker_cccd_snapshot: "abc", cccd_version: "" },
  ];
  const report = buildAudit(users, histories, versions, true);
  assert.equal(report.missingHistoryVersions.length, 2);
  assert.equal(report.mismatchedHistoryVersions.length, 1);
  assert.equal(report.invalidHistories.length, 1);
  assert.equal(report.legacyImagesNotMigrated.length, 1);
  assert.equal(report.fallbackHistoryCandidates.length, 1);
  assert.equal(report.blockers, 4);
});

test("audit đạt khi history và ảnh cũ đã có version đúng", () => {
  const users = [{ id: "u1", cccd: "001234567890", cccd_front: "legacy.jpg" }];
  const versions = [
    { id: "v1", user: "u1", cccd_number: "001234567890", front_image: "official.jpg" },
  ];
  const histories = [
    { id: "h1", user: "u1", worker_cccd_snapshot: "001234567890", cccd_version: "v1" },
  ];
  const report = buildAudit(users, histories, versions, true);
  assert.equal(report.blockers, 0);
  assert.equal(report.legacyImageConflicts.length, 1);
});

test("history sai số ưu tiên users.cccd hợp lệ", () => {
  assert.deepEqual(
    resolveHistoryCccd({ worker_cccd_snapshot: "12345" }, { cccd: "010309003820" }),
    { number: "010309003820", source: "user" },
  );
});

test("dữ liệu không có số hợp lệ được bỏ qua và không chặn finalize", () => {
  const users = [
    { id: "u1", username: "NV02", cccd: "", cccd_front: "front.jpg", cccd_back: "back.jpg" },
  ];
  const histories = [{ id: "h1", user: "u1", worker_cccd_snapshot: "123456", cccd_version: "" }];
  const report = buildAudit(users, histories, [], true);
  assert.equal(report.skippedLegacyImages.length, 1);
  assert.equal(report.skippedHistories.length, 1);
  assert.equal(report.blockers, 0);
});
