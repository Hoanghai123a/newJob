import * as XLSX from "xlsx";

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/**
 * Normalize various date formats to yyyy-mm-dd string.
 * Handles: Excel serial numbers, Date objects, dd-mm-yyyy, dd/mm/yyyy, yyyy-mm-dd.
 */
export function normalizeDate(value: unknown): string {
  if (value == null || value === "") return "";

  if (typeof value === "number") {
    const d = XLSX.SSF.parse_date_code(value);
    if (d) {
      return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
    }
    return "";
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }

  const text = String(value).trim();
  if (!text) return "";

  // yyyy-mm-dd
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(text)) {
    const [y, m, d] = text.split(/[-/]/);
    if (!isValidCalendarDate(+y, +m, +d)) return "";
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // dd-mm-yyyy or dd/mm/yyyy
  if (/^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/.test(text)) {
    const [d, m, y] = text.split(/[-/]/);
    if (!isValidCalendarDate(+y, +m, +d)) return "";
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // Fallback: try native Date parse
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
  }

  return "";
}
