import type { EmploymentHistoryRecord } from "./employment";

export type HoursMetric = "hc" | "tc" | "both";
export type EmploymentStatusFilter = "all" | "working" | "left";

export interface EmployeeMonthlyHoursImportRow {
  rowNumber: number;
  historyUid: string;
  employeeCode: string;
  workerName: string;
  factoryName: string;
  month: string;
  regularHours: number;
  overtimeHours: number;
}

export interface EmployeeMonthlyHoursRecord {
  id: string;
  employment_history: string;
  month: string;
  regular_hours: number;
  overtime_hours: number;
}

export interface RankingHistory extends EmploymentHistoryRecord {
  factory_name?: string;
  tenant_company?: string;
}

export interface HourRankingRow {
  historyId: string;
  historyUid: string;
  employeeCode: string;
  workerName: string;
  factoryId: string;
  factoryName: string;
  status: "working" | "left" | "unknown";
  regularHours: number;
  overtimeHours: number;
  totalHours: number;
  rank: number;
}

export interface SeniorityRankingRow {
  historyId: string;
  historyUid: string;
  employeeCode: string;
  workerName: string;
  factoryId: string;
  factoryName: string;
  joinDate: string;
  seniorityDays: number;
  rank: number;
}

const IMPORT_COLUMNS = {
  historyUid: ["uid lich su", "ma lich su", "history uid", "history_uid"],
  employeeCode: ["ma nv", "ma nhan vien", "employee code", "employee_code"],
  workerName: ["ho ten", "ho ten tai thoi diem di lam", "worker name", "worker_name"],
  factoryName: ["ten nha may", "nha may", "factory name", "factory_name"],
  month: ["thang", "month"],
  regularHours: ["so gio hc", "gio hc", "hc", "regular hours", "regular_hours"],
  overtimeHours: ["so gio tc", "gio tc", "tc", "overtime hours", "overtime_hours"],
} as const;

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, (letter) => (letter === "Đ" ? "D" : "d"))
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("vi");
}

export function normalizeImportIdentity(value: unknown) {
  return normalizeText(value);
}

function columnKey(value: unknown) {
  return normalizeText(value).replace(/[^a-z0-9_]/g, "");
}

function excelMonth(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    // SheetJS can produce 23:59:56 for a date at local midnight after timezone conversion.
    if (value.getHours() === 23 && value.getMinutes() === 59) {
      value = new Date(value.getTime() + 60_000);
    }
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.trunc(value) * 86_400_000);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  const text = String(value ?? "").trim();
  let match = /^(\d{4})[-/](\d{1,2})$/.exec(text);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    return month >= 1 && month <= 12 ? `${year}-${String(month).padStart(2, "0")}` : "";
  }

  match = /^(\d{1,2})[/-](\d{4})$/.exec(text);
  if (match) {
    const month = Number(match[1]);
    const year = Number(match[2]);
    return month >= 1 && month <= 12 ? `${year}-${String(month).padStart(2, "0")}` : "";
  }

  match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
  if (match) {
    const month = Number(match[2]);
    const year = Number(match[3]);
    return month >= 1 && month <= 12 ? `${year}-${String(month).padStart(2, "0")}` : "";
  }

  return "";
}

function parseHours(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  let text = String(value ?? "").trim().replace(/\s/g, "");
  if (!text) return null;
  if (text.includes(",") && text.includes(".")) {
    text = text.lastIndexOf(",") > text.lastIndexOf(".")
      ? text.replace(/\./g, "").replace(",", ".")
      : text.replace(/,/g, "");
  } else if (text.includes(",")) {
    text = /,\d{3}$/.test(text) ? text.replace(/,/g, "") : text.replace(",", ".");
  }
  const number = Number(text);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function headerValue(row: Record<string, unknown>, aliases: readonly string[]) {
  const aliasSet = new Set(aliases.map(columnKey));
  const key = Object.keys(row).find((candidate) => aliasSet.has(columnKey(candidate)));
  return key === undefined ? undefined : row[key];
}

export function parseEmployeeMonthlyHoursImport(rawRows: Record<string, unknown>[]) {
  const headers = new Set(rawRows.length ? Object.keys(rawRows[0]).map(columnKey) : []);
  const missing = Object.entries(IMPORT_COLUMNS)
    .filter(([field]) => field !== "workerName" && field !== "factoryName")
    .filter(([, aliases]) => !aliases.some((alias) => headers.has(columnKey(alias))))
    .map(([field]) => field);

  if (missing.length) {
    const labels: Record<string, string> = {
      historyUid: "UID lịch sử",
      employeeCode: "Mã NV",
      workerName: "Họ tên",
      factoryName: "Tên nhà máy",
      month: "Tháng",
      regularHours: "Số giờ HC",
      overtimeHours: "Số giờ TC",
    };
    return {
      rows: [] as EmployeeMonthlyHoursImportRow[],
      errors: [{ rowNumber: 1, reason: `Thiếu cột: ${missing.map((field) => labels[field]).join(", ")}.` }],
    };
  }

  const rows: EmployeeMonthlyHoursImportRow[] = [];
  const errors: Array<{ rowNumber: number; reason: string }> = [];
  const importKeys = new Map<string, number[]>();
  const rowErrors = new Set<number>();

  rawRows.forEach((raw, index) => {
    if (!Object.values(raw).some((value) => String(value ?? "").trim())) return;
    const rowNumber = Number(raw.rowNumber) || index + 2;
    const historyUid = String(headerValue(raw, IMPORT_COLUMNS.historyUid) ?? "").trim();
    const employeeCode = String(headerValue(raw, IMPORT_COLUMNS.employeeCode) ?? "").trim();
    const workerName = String(headerValue(raw, IMPORT_COLUMNS.workerName) ?? "").trim();
    const factoryName = String(headerValue(raw, IMPORT_COLUMNS.factoryName) ?? "").trim();
    const month = excelMonth(headerValue(raw, IMPORT_COLUMNS.month));
    const regularHours = parseHours(headerValue(raw, IMPORT_COLUMNS.regularHours));
    const overtimeHours = parseHours(headerValue(raw, IMPORT_COLUMNS.overtimeHours));
    if (historyUid && month) {
      const key = `${historyUid}\u0000${month}`;
      importKeys.set(key, [...(importKeys.get(key) || []), rowNumber]);
    }
    const missingValues = [
      [historyUid, "UID lịch sử"],
      [employeeCode, "Mã NV"],
      [month, "Tháng hợp lệ"],
      [regularHours, "Số giờ HC hợp lệ"],
      [overtimeHours, "Số giờ TC hợp lệ"],
    ].filter(([value]) => value === "" || value === null || value === undefined);

    if (missingValues.length) {
      rowErrors.add(rowNumber);
      errors.push({
        rowNumber,
        reason: `Thiếu hoặc không hợp lệ: ${missingValues.map(([, label]) => label).join(", ")}.`,
      });
      return;
    }

    if ((regularHours as number) + (overtimeHours as number) <= 0) {
      rowErrors.add(rowNumber);
      errors.push({ rowNumber, reason: "Số giờ HC và TC không được đồng thời bằng 0." });
      return;
    }

    rows.push({
      rowNumber,
      historyUid,
      employeeCode,
      workerName,
      factoryName,
      month,
      regularHours: regularHours as number,
      overtimeHours: overtimeHours as number,
    });
  });

  const rowsByKey = new Map<string, EmployeeMonthlyHoursImportRow[]>();
  for (const row of rows) {
    const key = `${row.historyUid}\u0000${row.month}`;
    const sameKey = rowsByKey.get(key) || [];
    sameKey.push(row);
    rowsByKey.set(key, sameKey);
  }
  const duplicateRows = new Set<number>();
  for (const rowNumbers of importKeys.values()) {
    if (rowNumbers.length < 2) continue;
    for (const rowNumber of rowNumbers) {
      duplicateRows.add(rowNumber);
      if (!rowErrors.has(rowNumber)) {
        errors.push({ rowNumber, reason: "UID lịch sử và tháng bị trùng trong file." });
      }
    }
  }
  for (const duplicates of rowsByKey.values()) {
    if (duplicates.length < 2) continue;
    for (const row of duplicates) {
      duplicateRows.add(row.rowNumber);
      if (!rowErrors.has(row.rowNumber) && !errors.some((error) => error.rowNumber === row.rowNumber)) {
        errors.push({ rowNumber: row.rowNumber, reason: "UID lịch sử và tháng bị trùng trong file." });
      }
    }
  }

  return { rows: rows.filter((row) => !duplicateRows.has(row.rowNumber)), errors };
}

function timestamp(value?: string) {
  const parsed = value ? Date.parse(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

export function latestHistoryByWorker(histories: RankingHistory[]) {
  const ordered = [...histories].sort(
    (a, b) =>
      timestamp(b.join_date) - timestamp(a.join_date) || timestamp(b.created) - timestamp(a.created),
  );
  const latest = new Map<string, RankingHistory>();
  for (const history of ordered) {
    if (history.worker && !latest.has(history.worker)) latest.set(history.worker, history);
  }
  return latest;
}

function historyStatus(history: RankingHistory | undefined): HourRankingRow["status"] {
  if (!history) return "unknown";
  return isWorkingAt(history) ? "working" : "left";
}

function isWorkingAt(history: { leave_date?: string | null }, referenceDate = new Date()) {
  if (history.leave_date) {
    const leave = new Date(history.leave_date);
    if (!Number.isNaN(leave.getTime())) {
      const leaveDay = new Date(leave.getFullYear(), leave.getMonth(), leave.getDate());
      const today = new Date(
        referenceDate.getFullYear(),
        referenceDate.getMonth(),
        referenceDate.getDate(),
      );
      return leaveDay > today;
    }
  }
  return true;
}

function currentStintDays(joinDate: string, referenceDate: Date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(joinDate);
  if (!match) return 0;
  const join = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const today = Date.UTC(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
  );
  return Math.max(0, Math.floor((today - join) / 86_400_000));
}

function searchKey(value: unknown) {
  return normalizeText(value);
}

export function buildEmployeeHoursRanking(
  records: EmployeeMonthlyHoursRecord[],
  histories: RankingHistory[],
  filters: {
    monthFrom: string;
    monthTo: string;
    factoryId?: string;
    employeeCode?: string;
    workerName?: string;
    status?: EmploymentStatusFilter;
    metric?: HoursMetric;
  },
) {
  const historyById = new Map(histories.map((history) => [history.id, history]));
  const latestByWorker = latestHistoryByWorker(histories);
  const grouped = new Map<string, HourRankingRow>();
  const employeeCodeQuery = searchKey(filters.employeeCode);
  const workerNameQuery = searchKey(filters.workerName);
  const statusFilter = filters.status || "all";

  for (const record of records) {
    if (record.month < filters.monthFrom || record.month > filters.monthTo) continue;
    const history = historyById.get(record.employment_history);
    if (!history?.uid) continue;
    if (filters.factoryId && history.factory !== filters.factoryId) continue;
    if (employeeCodeQuery && !searchKey(history.employee_code).includes(employeeCodeQuery)) continue;
    if (workerNameQuery && !searchKey(history.worker_name_snapshot).includes(workerNameQuery)) continue;
    const status = historyStatus(latestByWorker.get(history.worker));
    if (statusFilter !== "all" && status !== statusFilter) continue;

    const row = grouped.get(history.id) || {
      historyId: history.id,
      historyUid: history.uid,
      employeeCode: history.employee_code || "",
      workerName: history.worker_name_snapshot || "",
      factoryId: history.factory,
      factoryName: history.factory_name || "",
      status,
      regularHours: 0,
      overtimeHours: 0,
      totalHours: 0,
      rank: 0,
    };
    row.regularHours += Math.max(0, Number(record.regular_hours) || 0);
    row.overtimeHours += Math.max(0, Number(record.overtime_hours) || 0);
    row.totalHours = row.regularHours + row.overtimeHours;
    grouped.set(history.id, row);
  }

  const metric = filters.metric || "both";
  const metricValue = (row: HourRankingRow) =>
    metric === "hc" ? row.regularHours : metric === "tc" ? row.overtimeHours : row.totalHours;
  return [...grouped.values()]
    .sort(
      (a, b) =>
        metricValue(b) - metricValue(a) ||
        a.workerName.localeCompare(b.workerName, "vi", { sensitivity: "base" }) ||
        a.historyUid.localeCompare(b.historyUid),
    )
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export function buildEmployeeSeniorityRanking(
  histories: RankingHistory[],
  filters: { factoryId?: string; joinDateFrom?: string; joinDateTo?: string },
  referenceDate = new Date(),
) {
  const rows: SeniorityRankingRow[] = [];
  for (const history of latestHistoryByWorker(histories).values()) {
    if (!history.uid || history.recruiter_partner || !isWorkingAt(history, referenceDate)) continue;
    const joinDate = String(history.join_date || "").slice(0, 10);
    if (!joinDate) continue;
    if (filters.factoryId && history.factory !== filters.factoryId) continue;
    if (filters.joinDateFrom && joinDate < filters.joinDateFrom) continue;
    if (filters.joinDateTo && joinDate > filters.joinDateTo) continue;

    const previousDays = Math.max(0, Number(history.accumulated_seniority_days) || 0);
    const currentDays = currentStintDays(history.join_date, referenceDate);
    rows.push({
      historyId: history.id,
      historyUid: history.uid,
      employeeCode: history.employee_code || "",
      workerName: history.worker_name_snapshot || "",
      factoryId: history.factory,
      factoryName: history.factory_name || "",
      joinDate,
      seniorityDays: previousDays + currentDays,
      rank: 0,
    });
  }

  return rows
    .sort(
      (a, b) =>
        b.seniorityDays - a.seniorityDays ||
        a.workerName.localeCompare(b.workerName, "vi", { sensitivity: "base" }) ||
        a.historyUid.localeCompare(b.historyUid),
    )
    .map((row, index) => ({ ...row, rank: index + 1 }));
}
