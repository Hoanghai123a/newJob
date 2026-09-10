import type { EmploymentHistoryRecord } from "./employment";
import { aggregate, type AttendanceRow, type RateBuckets } from "./salary";

export type HourStatSource = "attendance" | "salary";

export interface AttendanceHourItem {
  id: string;
  user: string;
  month: string;
  round_no?: number;
  rows?: AttendanceRow[];
  summary?: Partial<RateBuckets>;
}

export interface SalaryHourLine {
  rate?: string;
  hours?: number;
}

export interface SalaryHourItem {
  id: string;
  user: string;
  month: string;
  round_no?: number;
  personal?: {
    employee_code?: string;
    company?: string;
  };
  wage_lines?: SalaryHourLine[];
}

export interface WorkerHourStat {
  userId: string;
  fullName: string;
  employeeCode: string;
  factoryId: string;
  factoryName: string;
  recruiterId: string;
  recruiterName: string;
  recruiterType: "internal" | "partner" | "unassigned";
  source: HourStatSource;
  hours: number;
  roundNo: number;
}

export interface RecruiterHourGroup {
  recruiterId: string;
  recruiterName: string;
  recruiterType: "internal" | "partner" | "unassigned";
  hours: number;
  workers: WorkerHourStat[];
}

const RATE_KEYS: Array<keyof RateBuckets> = [
  "r100",
  "r130",
  "r150",
  "r200",
  "r270",
  "r300",
  "r390",
];

function normalize(value?: string) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .trim()
    .toLowerCase();
}

function sumBuckets(summary?: Partial<RateBuckets>) {
  if (!summary || Object.keys(summary).length === 0) return null;
  return RATE_KEYS.reduce((sum, key) => sum + Math.max(0, Number(summary[key]) || 0), 0);
}

export function attendanceHours(item: AttendanceHourItem) {
  const summaryTotal = sumBuckets(item.summary);
  if (summaryTotal !== null && (summaryTotal > 0 || !item.rows?.length)) return summaryTotal;
  const buckets = aggregate(item.rows || []);
  return RATE_KEYS.reduce((sum, key) => sum + Math.max(0, Number(buckets[key]) || 0), 0);
}

export function salaryHours(item: SalaryHourItem) {
  return (item.wage_lines || []).reduce((sum, line) => {
    const match = String(line.rate || "")
      .replace(",", ".")
      .match(/\d+(?:\.\d+)?/);
    const rate = match ? Number(match[0]) : 0;
    return rate >= 100 ? sum + Math.max(0, Number(line.hours) || 0) : sum;
  }, 0);
}

function monthBounds(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const start = `${year}-${String(monthNumber).padStart(2, "0")}-01`;
  const endDate = new Date(year, monthNumber, 0);
  const end = `${year}-${String(monthNumber).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`;
  return { start, end };
}

function historyOverlapsMonth(history: EmploymentHistoryRecord, month: string) {
  const { start, end } = monthBounds(month);
  const joined = (history.join_date || "").slice(0, 10);
  const left = (history.leave_date || "").slice(0, 10);
  return Boolean(joined && joined <= end && (!left || left >= start));
}

function selectHistory(
  histories: EmploymentHistoryRecord[],
  month: string,
  salaryItem?: SalaryHourItem,
) {
  const overlapping = histories.filter((history) => historyOverlapsMonth(history, month));
  const candidates = overlapping.length ? overlapping : histories;
  const employeeCode = normalize(salaryItem?.personal?.employee_code);
  const company = normalize(salaryItem?.personal?.company);
  const exact = candidates.find(
    (history) =>
      employeeCode &&
      normalize(history.employee_code) === employeeCode &&
      (!company || normalize(history.expand?.factory?.name) === company),
  );
  const sorted = [...candidates].sort((a, b) =>
    (b.join_date || "").localeCompare(a.join_date || ""),
  );
  return exact || sorted[0];
}

function latestByWorker<T extends { user: string; round_no?: number }>(items: T[]) {
  const result = new Map<string, T>();
  for (const item of items) {
    if (!item.worker) continue;
    const current = result.get(item.worker);
    if (!current || Number(item.round_no || 0) > Number(current.round_no || 0)) {
      result.set(item.worker, item);
    }
  }
  return result;
}

export function buildWorkerHourStats({
  month,
  attendanceItems,
  salaryItems,
  histories,
}: {
  month: string;
  attendanceItems: AttendanceHourItem[];
  salaryItems: SalaryHourItem[];
  histories: EmploymentHistoryRecord[];
}) {
  const attendanceByWorker = latestByWorker(attendanceItems);
  const salaryByWorker = latestByWorker(salaryItems);
  const historiesByWorker = new Map<string, EmploymentHistoryRecord[]>();
  for (const history of histories) {
    const rows = historiesByWorker.get(history.worker) || [];
    rows.push(history);
    historiesByWorker.set(history.worker, rows);
  }

  const workerIds = new Set([...attendanceByWorker.keys(), ...salaryByWorker.keys()]);
  const stats: WorkerHourStat[] = [];

  for (const userId of workerIds) {
    const attendanceItem = attendanceByWorker.get(userId);
    const salaryItem = salaryByWorker.get(userId);
    const source: HourStatSource = attendanceItem ? "attendance" : "salary";
    const sourceItem = attendanceItem || salaryItem;
    if (!sourceItem) continue;

    const history = selectHistory(historiesByWorker.get(userId) || [], month, salaryItem);
    const user = history?.expand?.worker;
    const partner = history?.expand?.recruiter_partner;
    const recruiter = history?.expand?.recruiter_staff;
    const recruiterType = history?.recruiter_partner
      ? "partner"
      : history?.recruiter_staff
        ? "internal"
        : "unassigned";
    const recruiterId = history?.recruiter_partner
      ? `partner:${history.recruiter_partner}`
      : history?.recruiter_staff
        ? `internal:${history.recruiter_staff}`
        : "";
    stats.push({
      userId,
      fullName: user?.full_name?.trim() || user?.username?.trim() || "NLĐ chưa xác định",
      employeeCode:
        history?.employee_code?.trim() || salaryItem?.personal?.employee_code?.trim() || "Chưa có",
      factoryId: history?.factory || "",
      factoryName:
        history?.expand?.factory?.name?.trim() ||
        salaryItem?.personal?.company?.trim() ||
        "Chưa có nhà máy",
      recruiterId,
      recruiterName:
        partner?.name?.trim() ||
        recruiter?.full_name?.trim() ||
        recruiter?.username?.trim() ||
        "Chưa gắn người tuyển",
      recruiterType,
      source,
      hours: source === "attendance" ? attendanceHours(attendanceItem!) : salaryHours(salaryItem!),
      roundNo: Number(sourceItem.round_no || 0),
    });
  }

  return stats.sort(
    (a, b) =>
      a.recruiterName.localeCompare(b.recruiterName, "vi", { sensitivity: "base" }) ||
      a.fullName.localeCompare(b.fullName, "vi", { sensitivity: "base" }),
  );
}

export function groupWorkerHourStats(rows: WorkerHourStat[]) {
  const groups = new Map<string, RecruiterHourGroup>();
  for (const row of rows) {
    const key = row.recruiterId || "unassigned";
    const group = groups.get(key) || {
      recruiterId: row.recruiterId,
      recruiterName: row.recruiterName,
      recruiterType: row.recruiterType,
      hours: 0,
      workers: [],
    };
    group.hours += row.hours;
    group.workers.push(row);
    groups.set(key, group);
  }
  return [...groups.values()].sort(
    (a, b) => b.hours - a.hours || a.recruiterName.localeCompare(b.recruiterName, "vi"),
  );
}
