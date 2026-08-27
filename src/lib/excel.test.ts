import assert from "node:assert/strict";
import test from "node:test";

const { buildExcelWorkbook, EXCEL_DATE_FORMAT } = await import("./excel.ts");

function sheetOf(rows: Record<string, unknown>[]) {
  return buildExcelWorkbook({ Data: rows }).Sheets["Data"];
}

test("cột toàn ngày dd/mm/yyyy trở thành ô ngày với serial đúng", () => {
  const sheet = sheetOf([{ "Ngày vào": "01/09/2026" }, { "Ngày vào": "15/03/2025" }]);
  assert.equal(sheet["A2"].t, "n");
  assert.equal(sheet["A2"].z, EXCEL_DATE_FORMAT);
  assert.equal(sheet["A2"].v, 46266);
  assert.equal(sheet["A3"].v, 45731);
});

test("chuỗi ISO kèm giờ thành ô ngày và bỏ phần giờ", () => {
  const sheet = sheetOf([{ "Ngày tạo": "2026-08-27 10:23:45Z" }]);
  assert.equal(sheet["A2"].t, "n");
  assert.equal(sheet["A2"].z, EXCEL_DATE_FORMAT);
  assert.equal(sheet["A2"].v, 46261);
});

test("giá trị Date object thành ô ngày dd/mm/yyyy", () => {
  const sheet = sheetOf([{ "Ngày cấp CCCD": new Date(2026, 0, 15) }]);
  assert.equal(sheet["A2"].t, "n");
  assert.equal(sheet["A2"].z, EXCEL_DATE_FORMAT);
  assert.equal(sheet["A2"].v, 46037);
});

test("cột số không bị đổi thành ngày", () => {
  const sheet = sheetOf([{ "Thâm niên (ngày)": 500 }, { "Thâm niên (ngày)": 120 }]);
  assert.equal(sheet["A2"].t, "n");
  assert.equal(sheet["A2"].v, 500);
  assert.notEqual(sheet["A2"].z, EXCEL_DATE_FORMAT);
});

test("chuỗi số kiểu số điện thoại giữ nguyên text", () => {
  const sheet = sheetOf([{ "Số điện thoại": "0900000000" }]);
  assert.equal(sheet["A2"].t, "s");
  assert.equal(sheet["A2"].v, "0900000000");
});

test("cột lẫn ngày và chữ không đổi ô nào", () => {
  const sheet = sheetOf([{ "Ghi chú": "01/02/2024" }, { "Ghi chú": "ok" }]);
  assert.equal(sheet["A2"].t, "s");
  assert.equal(sheet["A2"].v, "01/02/2024");
  assert.equal(sheet["A3"].v, "ok");
});

test("ô rỗng xen kẽ không chặn nhận diện ngày", () => {
  const sheet = sheetOf([
    { "Ngày nghỉ": "31/12/2025" },
    { "Ngày nghỉ": "" },
    { "Ngày nghỉ": "01/01/2026" },
  ]);
  assert.equal(sheet["A2"].t, "n");
  assert.equal(sheet["A4"].t, "n");
  assert.equal(sheet["A4"].v, 46023);
});
