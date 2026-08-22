import { pb } from "@/lib/pocketbase";
import { escapePb } from "@/lib/delegations";
import { companyFilter } from "@/lib/tenant";
import type {
  WorkerAttendanceCheckItem,
  WorkerSalaryCheckItem,
} from "@/components/payroll/WorkerPayrollView";

export const CHECK_PAYROLL_CACHE_TTL = 60_000;
const CACHE_PREFIX = "jobconnect:check-payroll:v1";

type CacheEntry = {
  cachedAt: number;
  expiresAt: number;
  attendance: WorkerAttendanceCheckItem[];
  salary: WorkerSalaryCheckItem[];
  attendanceError?: string;
  salaryError?: string;
};
const memoryCache = new Map<string, CacheEntry>();

function cacheKey(viewerId: string, scope: string, workerId: string, month = "all") {
  return `${CACHE_PREFIX}:${viewerId}:${scope}:${workerId}:${month}`;
}

function readSession(key: string): CacheEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as CacheEntry;
    if (!Array.isArray(value.attendance) || !Array.isArray(value.salary)) return null;
    return value;
  } catch {
    return null;
  }
}

function writeSession(key: string, value: CacheEntry) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Cache is optional; continue normally when storage is unavailable/full.
  }
}

function normalizeAttendance(item: Partial<WorkerAttendanceCheckItem>): WorkerAttendanceCheckItem {
  return {
    ...(item as WorkerAttendanceCheckItem),
    id: String(item.id || ""),
    user: String(item.user || ""),
    batch: String(item.batch || ""),
    month: String(item.month || ""),
    round_no: Number(item.round_no || 0),
    rows: Array.isArray(item.rows) ? item.rows : [],
    summary: item.summary || {},
  };
}

function normalizeSalary(item: Partial<WorkerSalaryCheckItem>): WorkerSalaryCheckItem {
  return {
    ...(item as WorkerSalaryCheckItem),
    id: String(item.id || ""),
    user: String(item.user || ""),
    batch: String(item.batch || ""),
    month: String(item.month || ""),
    round_no: Number(item.round_no || 0),
    personal:
      item.personal ||
      ({
        employee_code: "",
        company: "",
        start_date: "",
        end_date: "",
        base_salary: 0,
        standard_workdays: 0,
      } as any),
    wage_lines: Array.isArray(item.wage_lines) ? item.wage_lines : [],
    allowance_lines: Array.isArray(item.allowance_lines) ? item.allowance_lines : [],
    deduction_lines: Array.isArray(item.deduction_lines) ? item.deduction_lines : [],
    totals: item.totals || { wage: 0, allowance: 0, deduction: 0, net: 0 },
  };
}

export function invalidateCheckPayrollCache(workerId?: string) {
  for (const key of memoryCache.keys())
    if (!workerId || key.includes(`:${workerId}:`)) memoryCache.delete(key);
  if (typeof window === "undefined") return;
  try {
    for (let i = window.sessionStorage.length - 1; i >= 0; i--) {
      const key = window.sessionStorage.key(i);
      if (key?.startsWith(CACHE_PREFIX) && (!workerId || key.includes(`:${workerId}:`)))
        window.sessionStorage.removeItem(key);
    }
  } catch {}
}

export type CheckPayrollLoadResult = CacheEntry & { isStale: boolean };

export async function fetchWorkerCheckPayroll(
  viewerId: string,
  scope: string,
  workerId: string,
  force = false,
) {
  const key = cacheKey(viewerId, scope, workerId);
  const cached = memoryCache.get(key) || readSession(key);
  if (cached) {
    memoryCache.set(key, cached);
    if (!force && cached.expiresAt > Date.now()) return { ...cached, isStale: false };
    void refreshWorkerCheckPayroll(key, workerId, cached).catch(() => undefined);
    return { ...cached, isStale: true };
  }
  return refreshWorkerCheckPayroll(key, workerId);
}

async function refreshWorkerCheckPayroll(
  key: string,
  workerId: string,
  previous?: CacheEntry,
): Promise<CheckPayrollLoadResult> {
  const filter = `${companyFilter(pb.authStore.record as any)} && user="${escapePb(workerId)}"`;
  const metadataFields = "id,user,month,round_no,created,summary,personal,batch,expand.batch";
  const detailFields = "id,rows";
  const salaryDetailFields = "id,wage_lines,allowance_lines,deduction_lines,totals";
  const [attendanceResult, salaryResult] = await Promise.allSettled([
    pb.collection("check_attendance_items").getFullList({
      filter,
      sort: "-month,-round_no,-created",
      expand: "batch",
      fields: `${metadataFields},rows`,
    }),
    pb.collection("check_salary_items").getFullList({
      filter,
      sort: "-month,-round_no,-created",
      expand: "batch",
      fields: `${metadataFields},${salaryDetailFields.replace("id,", "")}`,
    }),
  ]);
  const attendanceRows = attendanceResult.status === "fulfilled" ? attendanceResult.value : [];
  const salaryRows = salaryResult.status === "fulfilled" ? salaryResult.value : [];
  const value: CacheEntry = {
    cachedAt: Date.now(),
    expiresAt: Date.now() + CHECK_PAYROLL_CACHE_TTL,
    attendance: attendanceRows.map(normalizeAttendance),
    salary: salaryRows.map(normalizeSalary),
    ...(attendanceResult.status === "rejected"
      ? { attendanceError: "Không tải được bảng check công" }
      : {}),
    ...(salaryResult.status === "rejected"
      ? { salaryError: "Không tải được bảng check lương" }
      : {}),
  };
  if (!attendanceRows.length && !salaryRows.length && previous)
    return { ...previous, isStale: true };
  memoryCache.set(key, value);
  writeSession(key, value);
  return { ...value, isStale: false };
}
