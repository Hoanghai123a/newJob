import * as XLSX from "xlsx";

import { EXCEL_DATE_FORMAT } from "./excel";

export type LastWorkingDayLayout = "vertical" | "horizontal-single" | "horizontal-multi";
export type ExcelCell = string | number | boolean | Date | null | undefined;
export type SheetRows = ExcelCell[][];

export interface WorkbookData {
  workbook: XLSX.WorkBook;
  sheetNames: string[];
}

export interface ColumnMapping {
  headerRow: number;
  employeeCodeColumn: number;
  employeeNameColumn?: number;
  dateColumn?: number;
  hoursColumn?: number;
  dateStartColumn?: number;
  dateEndColumn?: number;
}

export interface LastWorkingDayResult {
  employeeCode: string;
  employeeName: string;
  lastWorkingDay: Date | null;
}

export interface ProcessingSummary {
  total: number;
  found: number;
  empty: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function readSheetRows(workbook: XLSX.WorkBook, sheetName: string): SheetRows {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<ExcelCell[]>(sheet, {
    header: 1,
    defval: "",
    raw: true,
  });
}

export async function readWorkbook(file: File): Promise<WorkbookData> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
  return { workbook, sheetNames: workbook.SheetNames };
}

export function parseHours(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/\s/g, "").replace(",", ".");
  if (!text || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function validDate(year: number, month: number, day: number) {
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : null;
}

export function parseExcelDate(value: unknown): Date | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;

    // SheetJS creates Excel date cells at local midnight; keep the local calendar date.
    return validDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const utc = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * DAY_MS);
    return validDate(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate());
  }
  const text = String(value ?? "").trim();
  if (!text) return null;
  const local = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (local) return validDate(Number(local[3]), Number(local[2]), Number(local[1]));
  const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/);
  if (iso) return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  return null;
}

function employeeCode(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return String(value ?? "").trim();
}

function laterDate(current: Date | null, candidate: Date | null) {
  if (!candidate) return current;
  return !current || candidate.getTime() > current.getTime() ? candidate : current;
}

export function processLastWorkingDays(
  rows: SheetRows,
  layout: LastWorkingDayLayout,
  mapping: ColumnMapping,
): LastWorkingDayResult[] {
  if (mapping.employeeCodeColumn < 0) throw new Error("Vui lòng chọn cột Mã NV.");
  const header = rows[mapping.headerRow] ?? [];
  let dateColumns: number[] = [];
  if (layout === "vertical") {
    if (mapping.dateColumn == null || mapping.hoursColumn == null) {
      throw new Error("Vui lòng chọn đủ cột Ngày/tháng và Số giờ.");
    }
  } else {
    if (mapping.dateStartColumn == null || mapping.dateEndColumn == null) {
      throw new Error("Vui lòng chọn cột ngày bắt đầu và cột ngày kết thúc.");
    }
    if (mapping.dateEndColumn < mapping.dateStartColumn) {
      throw new Error("Cột ngày kết thúc không thể đứng trước cột ngày bắt đầu.");
    }
    dateColumns = Array.from(
      { length: mapping.dateEndColumn - mapping.dateStartColumn + 1 },
      (_, index) => mapping.dateStartColumn! + index,
    ).filter((column) => Boolean(parseExcelDate(header[column])));
    if (dateColumns.length === 0) {
      throw new Error("Khoảng cột đã chọn không có ngày hợp lệ trên dòng tiêu đề.");
    }
  }

  const results = new Map<string, LastWorkingDayResult>();
  let activeCode = "";
  for (let rowIndex = mapping.headerRow + 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex] ?? [];
    let code = employeeCode(row[mapping.employeeCodeColumn]);
    if (layout === "horizontal-multi") {
      if (code) activeCode = code;
      else code = activeCode;
    }
    if (!code) continue;

    const name =
      mapping.employeeNameColumn == null
        ? ""
        : String(row[mapping.employeeNameColumn] ?? "").trim();
    let result = results.get(code);
    if (!result) {
      result = { employeeCode: code, employeeName: name, lastWorkingDay: null };
      results.set(code, result);
    } else if (!result.employeeName && name) {
      result.employeeName = name;
    }

    if (layout === "vertical") {
      const hours = parseHours(row[mapping.hoursColumn!]);
      if (hours != null && hours > 0) {
        result.lastWorkingDay = laterDate(
          result.lastWorkingDay,
          parseExcelDate(row[mapping.dateColumn!]),
        );
      }
      continue;
    }

    for (const column of dateColumns) {
      const hours = parseHours(row[column]);
      if (hours != null && hours > 0) {
        result.lastWorkingDay = laterDate(result.lastWorkingDay, parseExcelDate(header[column]));
      }
    }
  }

  if (results.size === 0) throw new Error("Không tìm thấy Mã NV hợp lệ trong sheet đã chọn.");
  return [...results.values()];
}

function dateSerial(date: Date) {
  return (
    (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(1899, 11, 30)) /
    DAY_MS
  );
}

export function downloadLastWorkingDayResults(results: LastWorkingDayResult[], sourceName: string) {
  const data = [
    ["Mã NV", "Họ tên", "Ngày công cuối"],
    ...results.map((item) => [
      item.employeeCode,
      item.employeeName,
      item.lastWorkingDay ? dateSerial(item.lastWorkingDay) : "",
    ]),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(data);
  sheet["!cols"] = [{ wch: 16 }, { wch: 30 }, { wch: 18 }];
  for (let row = 1; row < data.length; row++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: row, c: 2 })];
    if (cell && typeof cell.v === "number") {
      cell.t = "n";
      cell.z = EXCEL_DATE_FORMAT;
    }
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Ngày công cuối");
  const baseName = sourceName.replace(/\.(xlsx|xls)$/i, "").replace(/[^a-zA-Z0-9_-]+/g, "_");
  XLSX.writeFile(workbook, `Ngay_cong_cuoi_${baseName || "ket_qua"}.xlsx`);
}

export function summarizeResults(results: LastWorkingDayResult[]): ProcessingSummary {
  const found = results.filter((item) => item.lastWorkingDay).length;
  return { total: results.length, found, empty: results.length - found };
}
