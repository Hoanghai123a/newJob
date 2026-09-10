import { pb, type UserRecord } from "./pocketbase";
import { companyFilter, companyIdOf } from "./tenant";

export type PayrollPeriod = {
  start: string;
  end: string;
  title: string;
  cutoffDay: number | null;
};

type FactoryPayrollSettings = {
  name?: string;
  attendance_cutoff_day?: number | string;
  cutoff_day?: number | string;
  closing_day?: number | string;
};

export function padDatePart(n: number) {
  return String(n).padStart(2, "0");
}

export function dateKey(date: Date) {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

export function formatShortDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}` : value;
}

export function addDaysToDateKey(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  return dateKey(addDays(new Date(year, month - 1, day), days));
}

export function normalizeCutoffDay(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const day = Math.trunc(n);
  return day >= 1 && day <= 31 ? day : null;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function normalizeText(value?: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/g, "d")
    .replace(/\u0110/g, "D")
    .toLowerCase()
    .trim();
}

export function getPayrollPeriod(monthDate: Date, cutoffDay?: number | null): PayrollPeriod {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const normalizedCutoff = normalizeCutoffDay(cutoffDay);

  if (!normalizedCutoff) {
    const start = dateKey(new Date(year, month, 1));
    const end = dateKey(new Date(year, month + 1, 0));
    return {
      start,
      end,
      title: `Tháng ${padDatePart(month + 1)}/${year}`,
      cutoffDay: null,
    };
  }

  const currentEndDay = Math.min(normalizedCutoff, new Date(year, month + 1, 0).getDate());
  const previousEndDay = Math.min(normalizedCutoff, new Date(year, month, 0).getDate());
  const startDate = addDays(new Date(year, month - 1, previousEndDay), 1);
  const endDate = new Date(year, month, currentEndDay);
  const start = dateKey(startDate);
  const end = dateKey(endDate);

  return {
    start,
    end,
    title: `Kỳ công ${formatShortDate(start)} - ${formatShortDate(end)}`,
    cutoffDay: normalizedCutoff,
  };
}

export function buildPayrollCalendarCells(period: PayrollPeriod) {
  const [startYear, startMonth, startDay] = period.start.split("-").map(Number);
  const [endYear, endMonth, endDay] = period.end.split("-").map(Number);
  const start = new Date(startYear, startMonth - 1, startDay);
  const end = new Date(endYear, endMonth - 1, endDay);
  const firstDow = (start.getDay() + 6) % 7;
  const cells: ({ day: number; key: string } | null)[] = [];

  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let cursor = new Date(start); cursor <= end; cursor = addDays(cursor, 1)) {
    cells.push({ day: cursor.getDate(), key: dateKey(cursor) });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

const factoryCutoffCache = new Map<string, number | null>();
const factoryCutoffPending = new Map<string, Promise<number | null>>();

export async function fetchFactoryAttendanceCutoffDay(company?: string) {
  const currentCompany = normalizeText(company);
  if (!currentCompany) return null;
  if (factoryCutoffCache.has(currentCompany)) return factoryCutoffCache.get(currentCompany) ?? null;
  const pending = factoryCutoffPending.get(currentCompany);
  if (pending) return pending;

  const request = (async () => {
    try {
      const user = pb.authStore.record as UserRecord | null;
      const factoryRes = await pb.collection("factories").getList(1, 300, {
        sort: "name",
        ...(companyIdOf(user) ? { filter: companyFilter(user) } : {}),
      });
      const factories = factoryRes.items as unknown as FactoryPayrollSettings[];
      const factory = factories.find((item) => normalizeText(item.name) === currentCompany);
      const cutoff = normalizeCutoffDay(
        factory?.attendance_cutoff_day ?? factory?.cutoff_day ?? factory?.closing_day,
      );
      factoryCutoffCache.set(currentCompany, cutoff);
      return cutoff;
    } catch {
      return null;
    } finally {
      factoryCutoffPending.delete(currentCompany);
    }
  })();
  factoryCutoffPending.set(currentCompany, request);
  return request;
}
