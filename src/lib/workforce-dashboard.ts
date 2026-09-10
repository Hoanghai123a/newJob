export type WorkforceRecruitmentScope = "all" | "internal" | "partner";

export type WorkforceHistoryInput = {
  id: string;
  user: string;
  factory?: string;
  recruiter_staff?: string;
  recruiter_partner?: string;
  join_date: string;
  leave_date?: string;
  created?: string;
  updated?: string;
  employee_code?: string;
  main_house?: string;
  worker_name_snapshot?: string;
  expand?: {
    user?: { full_name?: string; username?: string };
    factory?: { name?: string };
    main_house?: { name?: string };
    recruiter_staff?: { id?: string; full_name?: string; username?: string };
    recruiter_partner?: { id?: string; name?: string };
  };
};

export type WorkforceBreakdown = {
  id: string;
  source?: "internal" | "partner";
  joined: number;
  left: number;
  working: number;
  uniqueJoined: number;
};

export type WorkforceRecruitmentWorker = {
  id: string;
  employeeCode: string;
  workerName: string;
  factoryId: string;
  factoryName: string;
  mainHouseName: string;
  recruiterName: string;
  recruiterId: string;
  recruiterSource?: "internal" | "partner";
  joinDate: string;
};
export type WorkforceDashboardDay = {
  date: string;
  joined: number;
  left: number;
  working: number;
  uniqueJoined: number;
  factories: WorkforceBreakdown[];
  recruiters: WorkforceBreakdown[];
  /** Optional so older IndexedDB entries can still render the cached chart. */
  recruitedWorkers?: WorkforceRecruitmentWorker[];
};

export type WorkforceLookupItem = {
  id: string;
  name: string;
  source?: "internal" | "partner";
};

export type WorkforceLookups = {
  factories: WorkforceLookupItem[];
  recruiters: WorkforceLookupItem[];
  generatedAt: string;
  scopeFingerprint: string;
};

export type WorkforceDashboardResponse = {
  from: string;
  to: string;
  scope: WorkforceRecruitmentScope;
  generatedAt: string;
  scopeFingerprint: string;
  days: WorkforceDashboardDay[];
};

export const WORKFORCE_MAX_RANGE_DAYS = 180;

export function localWorkforceDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function shiftWorkforceDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localWorkforceDate(date);
}

export function enumerateWorkforceDates(from: string, to: string) {
  const dates: string[] = [];
  for (let value = from; value <= to; value = shiftWorkforceDate(value, 1)) dates.push(value);
  return dates;
}

export function validateWorkforceRange(from: string, to: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return "Ngày không đúng định dạng YYYY-MM-DD.";
  }
  if (from > to) return "Ngày bắt đầu không được sau ngày kết thúc.";
  if (to > localWorkforceDate()) return "Ngày kết thúc không được lớn hơn hôm nay.";
  if (enumerateWorkforceDates(from, to).length > WORKFORCE_MAX_RANGE_DAYS) {
    return `Chỉ được xem tối đa ${WORKFORCE_MAX_RANGE_DAYS} ngày.`;
  }
  return "";
}

function datePart(value?: string) {
  return String(value || "").slice(0, 10);
}

function appliesToScope(row: WorkforceHistoryInput, scope: WorkforceRecruitmentScope) {
  if (scope === "internal") return Boolean(row.recruiter_staff);
  if (scope === "partner") return Boolean(row.recruiter_partner);
  return true;
}

function rowOrder(a: WorkforceHistoryInput, b: WorkforceHistoryInput) {
  return (
    datePart(a.join_date).localeCompare(datePart(b.join_date)) ||
    String(a.created || "").localeCompare(String(b.created || "")) ||
    a.id.localeCompare(b.id)
  );
}

function activeAt(rows: WorkforceHistoryInput[], date: string) {
  let active: WorkforceHistoryInput | null = null;
  for (const row of rows) {
    const joined = datePart(row.join_date);
    const left = datePart(row.leave_date);
    if (!joined || joined > date || (left && left <= date)) continue;
    if (!active || rowOrder(active, row) < 0) active = row;
  }
  return active;
}

function addBreakdown(
  map: Map<string, WorkforceBreakdown>,
  id: string | undefined,
  source: WorkforceBreakdown["source"],
  metric: "joined" | "left" | "working" | "uniqueJoined",
) {
  const key = id || "__unassigned__";
  const item = map.get(`${source || "factory"}:${key}`) || {
    id: key,
    source,
    joined: 0,
    left: 0,
    working: 0,
    uniqueJoined: 0,
  };
  item[metric] += 1;
  map.set(`${source || "factory"}:${key}`, item);
}

function addRowMetric(
  factories: Map<string, WorkforceBreakdown>,
  recruiters: Map<string, WorkforceBreakdown>,
  row: WorkforceHistoryInput,
  metric: "joined" | "left" | "working" | "uniqueJoined",
) {
  addBreakdown(factories, row.factory, undefined, metric);
  if (row.recruiter_partner) addBreakdown(recruiters, row.recruiter_partner, "partner", metric);
  else if (row.recruiter_staff) addBreakdown(recruiters, row.recruiter_staff, "internal", metric);
}

export function aggregateWorkforceDays(params: {
  histories: WorkforceHistoryInput[];
  from: string;
  to: string;
  scope: WorkforceRecruitmentScope;
  firstHistoryIds?: Set<string>;
}): WorkforceDashboardDay[] {
  const { from, to, scope } = params;
  const histories = params.histories.filter((row) => appliesToScope(row, scope));
  const grouped = new Map<string, WorkforceHistoryInput[]>();
  for (const row of histories) {
    const bucket = grouped.get(row.user) || [];
    bucket.push(row);
    grouped.set(row.user, bucket);
  }
  for (const rows of grouped.values()) rows.sort(rowOrder);

  return enumerateWorkforceDates(from, to).map((date) => {
    const factories = new Map<string, WorkforceBreakdown>();
    const recruiters = new Map<string, WorkforceBreakdown>();
    let joined = 0;
    let left = 0;
    let uniqueJoined = 0;
    const recruitedWorkers: WorkforceRecruitmentWorker[] = [];

    for (const row of histories) {
      if (datePart(row.join_date) === date) {
        joined += 1;
        addRowMetric(factories, recruiters, row, "joined");
        const partner = row.expand?.recruiter_partner;
        const staff = row.expand?.recruiter_staff;
        const recruiterSource = partner
          ? "partner"
          : staff || row.recruiter_staff
            ? "internal"
            : undefined;
        recruitedWorkers.push({
          id: row.id,
          employeeCode: row.employee_code || "—",
          workerName:
            row.worker_name_snapshot ||
            row.expand?.worker?.full_name ||
            row.expand?.worker?.username ||
            "—",
          factoryId: row.factory || "",
          factoryName: row.expand?.factory?.name || "—",
          mainHouseName: row.expand?.main_house?.name || "—",
          recruiterName: partner?.name || staff?.full_name || staff?.username || "—",
          recruiterId:
            partner?.id || staff?.id || row.recruiter_partner || row.recruiter_staff || "",
          recruiterSource,
          joinDate: date,
        });
        if (params.firstHistoryIds?.has(row.id)) {
          uniqueJoined += 1;
          addRowMetric(factories, recruiters, row, "uniqueJoined");
        }
      }
      if (datePart(row.leave_date) === date) {
        left += 1;
        addRowMetric(factories, recruiters, row, "left");
      }
    }

    let working = 0;
    for (const rows of grouped.values()) {
      const active = activeAt(rows, date);
      if (!active) continue;
      working += 1;
      addRowMetric(factories, recruiters, active, "working");
    }

    return {
      date,
      joined,
      left,
      working,
      uniqueJoined,
      factories: [...factories.values()],
      recruiters: [...recruiters.values()],
      recruitedWorkers,
    };
  });
}

export function findMissingWorkforceRanges(dates: string[], cachedDates: Set<string>) {
  const ranges: Array<{ from: string; to: string }> = [];
  let current: { from: string; to: string } | null = null;
  for (const date of dates) {
    if (cachedDates.has(date)) {
      if (current) ranges.push(current);
      current = null;
    } else if (current) current.to = date;
    else current = { from: date, to: date };
  }
  if (current) ranges.push(current);
  return ranges;
}
