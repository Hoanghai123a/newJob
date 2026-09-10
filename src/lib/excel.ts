import * as XLSX from "xlsx";

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function formatDateOnly(value: string | number | Date | undefined | null): string {
  if (!value) return "";
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return `${pad(value.getDate())}/${pad(value.getMonth() + 1)}/${value.getFullYear()}`;
  }
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    return parsed ? `${pad(parsed.d)}/${pad(parsed.m)}/${parsed.y}` : "";
  }

  const text = String(value).trim();
  if (!text) return "";

  const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${pad(Number(iso[3]))}/${pad(Number(iso[2]))}/${iso[1]}`;

  const vn = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (vn) return `${pad(Number(vn[1]))}/${pad(Number(vn[2]))}/${vn[3]}`;

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return `${pad(parsed.getDate())}/${pad(parsed.getMonth() + 1)}/${parsed.getFullYear()}`;
  }

  return text.replace(/[T ]\d{2}:\d{2}.*$/, "");
}

export async function parseExcelToRows(file: File): Promise<string[][]> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const ws = wb.Sheets[sheetName];
  const rows: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  return rows.map((row) => row.map((cell) => String(cell ?? "")));
}

export async function parseExcelToRowsFromUrl(url: string): Promise<string[][]> {
  const resp = await fetch(url);
  const buffer = await resp.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const ws = wb.Sheets[sheetName];
  const rows: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  return rows.map((row) => row.map((cell) => String(cell ?? "")));
}

export const EXCEL_DATE_FORMAT = "dd/mm/yyyy";
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const DAY_IN_MS = 24 * 60 * 60 * 1000;

function isValidCalendarDate(year: number, month: number, day: number) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function parseDateParts(value: unknown): { year: number; month: number; day: number } | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return {
      year: value.getFullYear(),
      month: value.getMonth() + 1,
      day: value.getDate(),
    };
  }

  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;

  const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:$|[T\s])/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    return isValidCalendarDate(year, month, day) ? { year, month, day } : null;
  }

  const local = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:$|[T\s])/);
  if (local) {
    const day = Number(local[1]);
    const month = Number(local[2]);
    const year = Number(local[3]);
    return isValidCalendarDate(year, month, day) ? { year, month, day } : null;
  }

  return null;
}

function dateCandidateSerial(cell: XLSX.CellObject | undefined): number | null {
  if (!cell || cell.v == null || cell.v === "") return null;
  // json_to_sheet biến Date thành ô số kèm z (và phần lẻ do lệch múi giờ); số thuần không có z.
  if (cell.t === "n") {
    return typeof cell.z === "string" && typeof cell.v === "number" ? Math.round(cell.v) : null;
  }
  const parts = parseDateParts(cell.v);
  if (!parts) return null;
  return (Date.UTC(parts.year, parts.month - 1, parts.day) - EXCEL_EPOCH_UTC) / DAY_IN_MS;
}

function applyDateColumns(ws: XLSX.WorkSheet) {
  if (!ws["!ref"]) return;

  const range = XLSX.utils.decode_range(ws["!ref"]);

  for (let column = range.s.c; column <= range.e.c; column++) {
    const pending: Array<{ address: string; serial: number }> = [];
    let hasOtherValue = false;

    for (let row = range.s.r + 1; row <= range.e.r && !hasOtherValue; row++) {
      const address = XLSX.utils.encode_cell({ r: row, c: column });
      const cell = ws[address];
      if (!cell || cell.v == null || cell.v === "") continue;

      const serial = dateCandidateSerial(cell);
      if (serial == null) hasOtherValue = true;
      else pending.push({ address, serial });
    }

    if (hasOtherValue || !pending.length) continue;

    for (const { address, serial } of pending) {
      const cell = ws[address];
      cell.t = "n";
      cell.v = serial;
      cell.z = EXCEL_DATE_FORMAT;
      delete cell.w;
      delete cell.h;
    }
  }
}

function getCellDisplayLength(cell: XLSX.CellObject | undefined) {
  if (!cell || cell.v == null || cell.v === "") return 0;

  const displayValue = cell.z === EXCEL_DATE_FORMAT ? EXCEL_DATE_FORMAT : (cell.w ?? cell.v);
  return Math.max(
    ...String(displayValue)
      .split(/\r\n?|\n/)
      .map((line) => Array.from(line).length),
  );
}

function applyAutoColumnWidths(ws: XLSX.WorkSheet) {
  if (!ws["!ref"]) return;

  const range = XLSX.utils.decode_range(ws["!ref"]);
  ws["!cols"] = Array.from({ length: range.e.c - range.s.c + 1 }, (_, index) => {
    const column = range.s.c + index;
    let maxLength = 0;

    for (let row = range.s.r; row <= range.e.r; row++) {
      const address = XLSX.utils.encode_cell({ r: row, c: column });
      maxLength = Math.max(maxLength, getCellDisplayLength(ws[address]));
    }

    return { wch: maxLength + 2 };
  });
}

export function buildExcelWorkbook(sheets: Record<string, any[]>) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{}]);
    applyDateColumns(ws);
    applyAutoColumnWidths(ws);
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  }
  return wb;
}

export function exportToExcel(filename: string, sheets: Record<string, any[]>) {
  const wb = buildExcelWorkbook(sheets);
  XLSX.writeFile(wb, filename.endsWith(".xlsx") ? filename : filename + ".xlsx");
}
