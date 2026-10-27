import assert from "node:assert/strict";
import test from "node:test";
import { parseQrAmount } from "./bank-qr-amount.ts";

test("nhận biết dấu phân cách hàng nghìn theo cả hai kiểu", () => {
  assert.deepEqual(parseQrAmount("1,000,000"), { amount: 1_000_000 });
  assert.deepEqual(parseQrAmount("1.000.000"), { amount: 1_000_000 });
});

test("bỏ phần thập phân thay vì ghép thành chữ số hàng đơn vị", () => {
  assert.deepEqual(parseQrAmount("1000,000.013"), { amount: 1_000_000 });
  assert.deepEqual(parseQrAmount("1.000.000,013"), { amount: 1_000_000 });
  assert.deepEqual(parseQrAmount("1000.013"), { amount: 1_000 });
});

test("chấp nhận phần thập phân bằng không và từ chối định dạng không hợp lệ", () => {
  assert.deepEqual(parseQrAmount("1.000.000,000"), { amount: 1_000_000 });
  assert.deepEqual(parseQrAmount("12,34,567"), { error: "Số tiền không hợp lệ" });
});
