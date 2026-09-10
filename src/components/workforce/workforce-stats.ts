import type { EmploymentHistoryRecord } from "@/lib/employment";
import type { FactoryRecord } from "@/lib/factories";
import type { UserRecord } from "@/lib/pocketbase";

export type WorkforceMetricSource = "internal" | "partner";

export type WorkforceMetricRow = {
  id: string;
  name: string;
  displayName: string;
  source?: WorkforceMetricSource;
  sourceLabel?: "Nội bộ" | "Đối tác";
  joined: number;
  left: number;
  working: number;
};

export type WorkforceSummary = {
  joined: number;
  left: number;
  working: number;
};

export type RecruitmentSourceScope = "all" | "internal" | "partner";

export function localIsoDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function shiftIsoDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localIsoDate(date);
}

export function isIsoDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime())
  );
}

export function datePart(value?: string | null) {
  if (!value) return "";
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : localIsoDate(date);
}

export function isDateInRange(value: string | undefined, from: string, to: string) {
  const day = datePart(value);
  return Boolean(day && day >= from && day <= to);
}

function historyOrder(history: EmploymentHistoryRecord) {
  const join = datePart(history.join_date);
  const created = new Date(history.created || 0).getTime();
  return { join, created: Number.isNaN(created) ? 0 : created };
}

function compareHistories(a: EmploymentHistoryRecord, b: EmploymentHistoryRecord) {
  const aOrder = historyOrder(a);
  const bOrder = historyOrder(b);
  if (!aOrder.join && bOrder.join) return 1;
  if (aOrder.join && !bOrder.join) return -1;
  return (
    aOrder.join.localeCompare(bOrder.join) ||
    aOrder.created - bOrder.created ||
    a.id.localeCompare(b.id)
  );
}

export function groupHistoriesByUser(histories: EmploymentHistoryRecord[]) {
  const grouped = new Map<string, EmploymentHistoryRecord[]>();
  for (const history of histories) {
    if (!history.worker) continue;
    const rows = grouped.get(history.worker) || [];
    rows.push(history);
    grouped.set(history.worker, rows);
  }
  for (const rows of grouped.values()) rows.sort(compareHistories);
  return grouped;
}

/** Bản ghi đang có hiệu lực tại cuối ngày; ngày nghỉ được xem là đã nghỉ. */
export function getActiveHistoryAtDate(
  histories: EmploymentHistoryRecord[],
  referenceDate: string,
) {
  let active: EmploymentHistoryRecord | null = null;
  for (const history of histories) {
    const joined = datePart(history.join_date);
    if (!joined || joined > referenceDate) continue;
    const left = datePart(history.leave_date);
    if (left && left <= referenceDate) continue;
    if (!active || compareHistories(active, history) < 0) active = history;
  }
  return active;
}

export function getActiveHistoriesAtDate(
  histories: EmploymentHistoryRecord[],
  referenceDate: string,
) {
  const active: EmploymentHistoryRecord[] = [];
  for (const rows of groupHistoriesByUser(histories).values()) {
    const history = getActiveHistoryAtDate(rows, referenceDate);
    if (history) active.push(history);
  }
  return active;
}

export function filterWorkforceHistoriesByRecruitmentScope(
  histories: EmploymentHistoryRecord[],
  _users: UserRecord[],
  scope: RecruitmentSourceScope,
) {
  if (scope === "all") return histories;
  return histories.filter((history) =>
    scope === "partner" ? Boolean(history.recruiter_partner) : Boolean(history.recruiter_staff),
  );
}

export function getWorkforceSummary(
  histories: EmploymentHistoryRecord[],
  from: string,
  to: string,
): WorkforceSummary {
  return {
    joined: histories.filter((history) => isDateInRange(history.join_date, from, to)).length,
    left: histories.filter((history) => isDateInRange(history.leave_date, from, to)).length,
    working: getActiveHistoriesAtDate(histories, to).length,
  };
}

function sortRows(
  rows: WorkforceMetricRow[],
  key: keyof Pick<WorkforceMetricRow, "joined" | "working">,
) {
  return rows.sort(
    (a, b) => b[key] - a[key] || b.joined - a.joined || a.name.localeCompare(b.name, "vi"),
  );
}

export function buildWorkforceRankings(
  histories: EmploymentHistoryRecord[],
  users: UserRecord[],
  factories: FactoryRecord[],
  from: string,
  to: string,
) {
  const userById = new Map(users.map((user) => [user.id, user]));
  const factoryById = new Map(factories.map((factory) => [factory.id, factory]));
  const recruiterRows = new Map<string, WorkforceMetricRow>();
  const factoryRows = new Map<string, WorkforceMetricRow>();

  const recruiterInfo = (history: EmploymentHistoryRecord) => {
    if (history.recruiter_partner) {
      const partner = history.expand?.recruiter_partner;
      return {
        id: `partner:${history.recruiter_partner}`,
        name: partner?.name || "Đối tác chưa xác định",
        source: "partner" as const,
        sourceLabel: "Đối tác" as const,
      };
    }
    if (!history.recruiter_staff) return null;
    const staff = userById.get(history.recruiter_staff) || history.expand?.recruiter_staff;
    if (staff?.role && staff.role !== "staff" && staff.role !== "admin") return null;
    return {
      id: `internal:${history.recruiter_staff}`,
      name: staff?.full_name || staff?.username || "Nhân sự chưa xác định",
      source: "internal" as const,
      sourceLabel: "Nội bộ" as const,
    };
  };

  const ensureRecruiter = (history: EmploymentHistoryRecord) => {
    const info = recruiterInfo(history);
    if (!info) return null;
    const current = recruiterRows.get(info.id) || {
      ...info,
      displayName: `${info.name} (${info.sourceLabel})`,
      joined: 0,
      left: 0,
      working: 0,
    };
    recruiterRows.set(info.id, current);
    return current;
  };

  const ensureFactory = (id: string) => {
    const factory = factoryById.get(id);
    const name = factory?.name || "Chưa gắn nhà máy";
    const current = factoryRows.get(id) || {
      id,
      name,
      displayName: name,
      joined: 0,
      left: 0,
      working: 0,
    };
    factoryRows.set(id, current);
    return current;
  };

  for (const history of histories) {
    const recruiter = ensureRecruiter(history);
    const factory = ensureFactory(history.factory || "__unassigned__");
    if (isDateInRange(history.join_date, from, to)) {
      if (recruiter) recruiter.joined++;
      factory.joined++;
    }
    if (isDateInRange(history.leave_date, from, to)) {
      if (recruiter) recruiter.left++;
      factory.left++;
    }
  }

  for (const history of getActiveHistoriesAtDate(histories, to)) {
    const recruiter = ensureRecruiter(history);
    if (recruiter) recruiter.working++;
    ensureFactory(history.factory || "__unassigned__").working++;
  }

  const uniqueRecruiterRows = new Map<string, WorkforceMetricRow>();
  const byUser = groupHistoriesByUser(histories);
  for (const rows of byUser.values()) {
    const first = rows[0];
    if (!first || !isDateInRange(first.join_date, from, to)) continue;
    const info = recruiterInfo(first);
    if (!info) continue;
    const row = uniqueRecruiterRows.get(info.id) || {
      ...info,
      displayName: `${info.name} (${info.sourceLabel})`,
      joined: 0,
      left: 0,
      working: 0,
    };
    row.joined++;
    if (getActiveHistoryAtDate(rows, to)) row.working++;
    else row.left++;
    uniqueRecruiterRows.set(row.id, row);
  }

  const recruiters = [...recruiterRows.values()].filter(
    (row) => row.joined || row.left || row.working,
  );
  const factory = [...factoryRows.values()].filter((row) => row.joined || row.left || row.working);
  const uniqueRecruiters = [...uniqueRecruiterRows.values()];

  return {
    staffRecruitment: sortRows([...recruiters], "joined"),
    factoryRecruitment: sortRows([...factory], "joined"),
    staffRetention: sortRows(
      [...recruiters].filter((row) => row.working > 0),
      "working",
    ),
    factoryRetention: sortRows(
      [...factory].filter((row) => row.working > 0),
      "working",
    ),
    uniqueStaffRecruitment: sortRows(uniqueRecruiters, "joined"),
  };
}

export function enumerateDates(from: string, to: string) {
  const dates: string[] = [];
  for (let day = from; day <= to; day = shiftIsoDate(day, 1)) dates.push(day);
  return dates;
}
