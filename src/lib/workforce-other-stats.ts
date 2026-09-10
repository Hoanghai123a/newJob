import type { CccdVersionRecord } from "./cccd-versions";
import type { EmploymentHistoryRecord } from "./employment";
import type { FactoryRecord } from "./factories";
import type { UserRecord } from "./pocketbase";
import { getRecruiterDisplay } from "./recruiters";

export type WorkforceStatsUser = UserRecord;

export type CccdDuplicateDetail = {
  id: string;
  employeeCode: string;
  fullName: string;
  factoryName: string;
  joinDate: string;
};

export type CccdDuplicateGroup = {
  cccd: string;
  fullName: string;
  count: number;
  factoryCount: number;
  details: CccdDuplicateDetail[];
};

export type CccdCompletionItem = {
  id: string;
  fullName: string;
  factoryName: string;
  recruiterName: string;
  hasCccdImages: boolean;
};

export type CccdCompletionDay = {
  date: string;
  total: number;
  completed: number;
  incomplete: number;
  rate: number | null;
  items: CccdCompletionItem[];
};

export type MonthPeriod = {
  key: string;
  label: string;
  start: string;
  end: string;
};

function dateKey(value?: string | null) {
  return value ? value.slice(0, 10) : "";
}

function localIsoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function getMonthPeriod(referenceDate = new Date(), monthOffset = 0): MonthPeriod {
  const month = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + monthOffset, 1);
  const nextMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const key = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
  return {
    key,
    label: month.toLocaleDateString("vi-VN", { month: "long", year: "numeric" }),
    start: localIsoDate(startOfMonth(month)),
    end: localIsoDate(nextMonth),
  };
}

export function getRecentDateKeys(referenceDate = new Date(), days = 7) {
  const today = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
  );
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (days - index - 1));
    return localIsoDate(date);
  });
}

export function normalizeCccd12(value?: string | null) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 12 ? digits.slice(0, 12) : "";
}

export function getHistoryCccd(
  history: EmploymentHistoryRecord,
  _usersById: ReadonlyMap<string, UserRecord>,
) {
  return normalizeCccd12(history.worker_cccd_snapshot);
}

export function historyIntersectsMonth(history: EmploymentHistoryRecord, period: MonthPeriod) {
  const joinDate = dateKey(history.join_date);
  if (!joinDate || joinDate > period.end) return false;
  const leaveDate = dateKey(history.leave_date);
  return !leaveDate || leaveDate > period.start;
}

function historyName(
  history: EmploymentHistoryRecord,
  _usersById: ReadonlyMap<string, UserRecord>,
) {
  return history.worker_name_snapshot || "Thiếu thông tin";
}

function factoryName(
  history: EmploymentHistoryRecord,
  factoriesById: ReadonlyMap<string, FactoryRecord>,
) {
  return (
    history.expand?.factory?.name || factoriesById.get(history.factory)?.name || "Chưa có nhà máy"
  );
}

function compareDateDesc(a: string, b: string) {
  return dateKey(b).localeCompare(dateKey(a));
}

export function buildCccdDuplicateGroups(
  histories: EmploymentHistoryRecord[],
  usersById: ReadonlyMap<string, UserRecord>,
  factoriesById: ReadonlyMap<string, FactoryRecord>,
  period: MonthPeriod,
): CccdDuplicateGroup[] {
  const grouped = new Map<string, EmploymentHistoryRecord[]>();

  for (const history of histories) {
    if (!historyIntersectsMonth(history, period)) continue;
    const cccd = getHistoryCccd(history, usersById);
    if (!cccd) continue;
    const bucket = grouped.get(cccd) || [];
    bucket.push(history);
    grouped.set(cccd, bucket);
  }

  return [...grouped.entries()]
    .map(([cccd, records]) => {
      const details = records
        .map((history) => ({
          id: history.id,
          employeeCode: history.employee_code || "—",
          fullName: historyName(history, usersById),
          factoryName: factoryName(history, factoriesById),
          joinDate: history.join_date,
          factoryId: history.factory,
        }))
        .sort((a, b) => compareDateDesc(a.joinDate, b.joinDate))
        .map(({ factoryId: _factoryId, ...detail }) => detail);
      const factoryCount = new Set(records.map((history) => history.factory).filter(Boolean)).size;
      return {
        cccd,
        fullName: details[0]?.fullName || "Người lao động",
        count: details.length,
        factoryCount,
        details,
      };
    })
    .filter((group) => group.factoryCount >= 2)
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.fullName.localeCompare(b.fullName, "vi", { sensitivity: "base" }) ||
        a.cccd.localeCompare(b.cccd),
    );
}

export function hasCompleteCccdImages(
  history: EmploymentHistoryRecord,
  usersById: ReadonlyMap<string, UserRecord>,
  versionsById: ReadonlyMap<string, CccdVersionRecord>,
) {
  void usersById;
  const version = history.cccd_version ? versionsById.get(history.cccd_version) : undefined;
  const frontImage = version?.front_image;
  const backImage = version?.back_image;
  return Boolean(frontImage && backImage);
}

export function buildCccdCompletionDays(
  histories: EmploymentHistoryRecord[],
  usersById: ReadonlyMap<string, UserRecord>,
  factoriesById: ReadonlyMap<string, FactoryRecord>,
  versionsById: ReadonlyMap<string, CccdVersionRecord>,
  referenceDate = new Date(),
): CccdCompletionDay[] {
  const dateKeys = getRecentDateKeys(referenceDate, 7);
  const dateSet = new Set(dateKeys);
  const grouped = new Map<string, CccdCompletionItem[]>();

  for (const history of histories) {
    const date = dateKey(history.join_date);
    if (!dateSet.has(date)) continue;
    const items = grouped.get(date) || [];
    items.push({
      id: history.id,
      fullName: historyName(history, usersById),
      factoryName: factoryName(history, factoriesById),
      recruiterName: (() => {
        const recruiter = getRecruiterDisplay(history);
        if (recruiter) return `${recruiter.name} · ${recruiter.label}`;
        return (
          (history.recruiter_staff ? usersById.get(history.recruiter_staff)?.full_name : "") ||
          "Chưa có người tuyển"
        );
      })(),
      hasCccdImages: hasCompleteCccdImages(history, usersById, versionsById),
    });
    grouped.set(date, items);
  }

  return dateKeys.map((date) => {
    const items = (grouped.get(date) || []).sort(
      (a, b) =>
        Number(a.hasCccdImages) - Number(b.hasCccdImages) ||
        a.fullName.localeCompare(b.fullName, "vi", { sensitivity: "base" }),
    );
    const completed = items.filter((item) => item.hasCccdImages).length;
    const total = items.length;
    return {
      date,
      total,
      completed,
      incomplete: total - completed,
      rate: total ? (completed / total) * 100 : null,
      items,
    };
  });
}
