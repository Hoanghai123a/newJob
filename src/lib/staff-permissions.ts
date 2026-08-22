import { pb, type UserRecord } from "./pocketbase";
import type { WorkerRecord } from "./workers";
import {
  getLatestEmploymentHistory,
  isCurrentlyWorking,
  isHistoryWithinLast90Days,
  type EmploymentHistoryRecord,
} from "./employment";
import { fetchFactoryManagers, isFactoryAssignmentActive } from "./factories";
import {
  readCachedStaffData,
  syncStaffData,
  fetchUsersBatched,
  buildScopeFingerprint,
  isCacheScopeValid,
  saveScopeFingerprint,
  clearStaffCache,
  idbPutManyHistories,
} from "./staff-cache";
import { escapePb, relationInFilter } from "./delegations";
import { canUseEmploymentFactory } from "./staff-employment-scope";
import { companyFilter, companyIdOf } from "./tenant";

export type StaffVisibilityReason = "qlnm" | "nvtd";

export interface StaffWorkerRecord {
  user: WorkerRecord;
  histories: EmploymentHistoryRecord[];
  latestHistory: EmploymentHistoryRecord | null;
  recentHistories: EmploymentHistoryRecord[];
  reasons: StaffVisibilityReason[];
  isRecentRecruiter: boolean;
  canReportAdvance: boolean;
  canUpdateBank: boolean;
  canViewPayroll: boolean;
  canReportLeave: boolean;
  canReportJoin: boolean;
  canEditHistory: boolean;
}

const RECENT_RECRUITER_HISTORY_LIMIT = 3;

export function canAccessStaffWorkspace(user?: Partial<UserRecord> | null) {
  return user?.role === "staff" || user?.role === "admin";
}

export function getStaffReasonsForHistory(
  _staffId: string,
  history: EmploymentHistoryRecord,
  managedFactoryIds: Set<string>,
) {
  const reasons = new Set<StaffVisibilityReason>();
  if (managedFactoryIds.has(history.factory)) reasons.add("qlnm");
  return [...reasons];
}

function toTimestamp(value?: string) {
  const time = new Date(value || 0).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function compareRecentHistories(a: EmploymentHistoryRecord, b: EmploymentHistoryRecord) {
  const joinDiff = toTimestamp(b.join_date) - toTimestamp(a.join_date);
  if (joinDiff !== 0) return joinDiff;

  const createdDiff = toTimestamp(b.created) - toTimestamp(a.created);
  if (createdDiff !== 0) return createdDiff;

  return toTimestamp(b.leave_date) - toTimestamp(a.leave_date);
}

function toDateOnly(value: Date) {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const d = String(value.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function buildScopedHistoryFilter(viewer: UserRecord, managedFactoryIds: Set<string>) {
  const referenceDate = new Date();
  const windowStart = new Date(referenceDate);
  windowStart.setDate(windowStart.getDate() - 180);
  const tomorrow = new Date(referenceDate);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const scopeFilter = [
    companyFilter(viewer),
    `join_date < "${toDateOnly(tomorrow)}"`,
    `(leave_date="" || leave_date >= "${toDateOnly(windowStart)}")`,
  ].join(" && ");

  if (viewer.role === "admin") return scopeFilter;

  const qlnmFilters: string[] = [];
  if (managedFactoryIds.size > 0) {
    qlnmFilters.push(
      `(${relationInFilter("factory", [...managedFactoryIds])}) && (${scopeFilter})`,
    );
  }

  const recruiterFilter = `recruiter_staff="${escapePb(viewer.id)}"`;
  return [...qlnmFilters, recruiterFilter].map((item) => `(${item})`).join(" || ");
}

export function getRecentRecruiterHistories(histories: EmploymentHistoryRecord[]) {
  return [...histories].sort(compareRecentHistories).slice(0, RECENT_RECRUITER_HISTORY_LIMIT);
}

export function isRecentRecruiter(
  viewer: Partial<UserRecord> | null | undefined,
  histories: EmploymentHistoryRecord[],
) {
  if (!viewer?.id || viewer.role !== "staff") return false;
  return getRecentRecruiterHistories(histories).some(
    (history) => history.recruiter_staff === viewer.id,
  );
}

export function hasActiveOrRecentlyLeftEmployment(
  histories: EmploymentHistoryRecord[],
  referenceDate = new Date(),
) {
  if (histories.some((history) => isCurrentlyWorking(history, referenceDate))) {
    return true;
  }

  const latestHistory = getLatestEmploymentHistory(histories);
  if (!latestHistory?.leave_date) return false;

  const datePart = latestHistory.leave_date.slice(0, 10);
  const match = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;

  const leaveDate = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (
    Number.isNaN(leaveDate.getTime()) ||
    leaveDate.getFullYear() !== Number(match[1]) ||
    leaveDate.getMonth() !== Number(match[2]) - 1 ||
    leaveDate.getDate() !== Number(match[3])
  ) {
    return false;
  }

  const cutoff = new Date(referenceDate);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - 90);
  return leaveDate >= cutoff;
}

export function canViewHistoryInStaffScope(
  viewer: Partial<UserRecord> | null | undefined,
  history: EmploymentHistoryRecord,
  allWorkerHistories: EmploymentHistoryRecord[],
  managedFactoryIds: Set<string>,
) {
  if (viewer?.role === "admin") return true;
  if (!viewer?.id || viewer.role !== "staff") return false;

  const recentRecruiterHistoryIds = new Set(
    getRecentRecruiterHistories(allWorkerHistories)
      .filter((item) => item.recruiter_staff === viewer.id)
      .map((item) => item.id),
  );
  if (recentRecruiterHistoryIds.has(history.id)) return true;

  return managedFactoryIds.has(history.factory) && isHistoryWithinLast90Days(history);
}

export function filterHistoriesForStaffScope(
  viewer: Partial<UserRecord> | null | undefined,
  histories: EmploymentHistoryRecord[],
  managedFactoryIds: Set<string>,
) {
  return histories.filter((history) =>
    canViewHistoryInStaffScope(viewer, history, histories, managedFactoryIds),
  );
}

export function canReportAdvance(
  viewer: Partial<UserRecord> | null | undefined,
  histories: EmploymentHistoryRecord[],
) {
  return viewer?.role === "admin" || isRecentRecruiter(viewer, histories);
}

export function canUpdateBank(
  viewer: Partial<UserRecord> | null | undefined,
  histories: EmploymentHistoryRecord[],
  managedFactoryIds: Set<string>,
) {
  if (viewer?.role === "admin") return true;
  if (!viewer?.id || viewer.role !== "staff") return false;
  if (isRecentRecruiter(viewer, histories)) return true;
  return histories.some((history) => managedFactoryIds.has(history.factory));
}

export function canViewPayroll(
  viewer: Partial<UserRecord> | null | undefined,
  histories: EmploymentHistoryRecord[],
  managedFactoryIds?: Set<string>,
) {
  if (canReportAdvance(viewer, histories)) return true;
  if (!viewer?.id || viewer.role !== "staff" || !managedFactoryIds?.size) return false;
  return histories.some((h) => managedFactoryIds.has(h.factory) && isHistoryWithinLast90Days(h));
}

export function canReportLeave(
  viewer: Partial<UserRecord> | null | undefined,
  activeHistory: EmploymentHistoryRecord | null,
  histories: EmploymentHistoryRecord[],
  managedFactoryIds: Set<string>,
) {
  if (!viewer?.id || !activeHistory) return false;
  if (viewer.role === "admin") return true;
  if (isRecentRecruiter(viewer, histories)) return true;
  return viewer.role === "staff" && managedFactoryIds.has(activeHistory.factory);
}

export function canReportJoin(
  viewer: Partial<UserRecord> | null | undefined,
  histories: EmploymentHistoryRecord[],
  managedFactoryIds: Set<string>,
  targetFactoryId?: string,
  factoryScope?: "assigned" | "all",
) {
  if (!viewer?.id) return false;
  if (viewer.role === "admin") return true;
  if (viewer.role !== "staff") return false;
  if (targetFactoryId) {
    return canUseEmploymentFactory(viewer, targetFactoryId, managedFactoryIds, factoryScope);
  }
  return factoryScope === "all" || managedFactoryIds.size > 0;
}

export function canEditHistory(
  viewer: Partial<UserRecord> | null | undefined,
  histories: EmploymentHistoryRecord[],
  managedFactoryIds: Set<string>,
) {
  if (!viewer?.id) return false;
  if (viewer.role === "admin") return true;
  if (viewer.role !== "staff") return false;
  if (isRecentRecruiter(viewer, histories)) return true;
  return histories.some((history) => managedFactoryIds.has(history.factory));
}

function hasRecentEmployment(userHistories: EmploymentHistoryRecord[]): boolean {
  const latest = getLatestEmploymentHistory(userHistories);
  if (!latest) return false;
  if (isCurrentlyWorking(latest)) return true;
  if (!latest.leave_date) return false;

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setDate(sixMonthsAgo.getDate() - 180);
  const leaveDate = new Date(latest.leave_date);
  return !Number.isNaN(leaveDate.getTime()) && leaveDate >= sixMonthsAgo;
}

function isWorkerInStaffScope(
  viewer: UserRecord,
  userHistories: EmploymentHistoryRecord[],
  managedFactoryIds: Set<string>,
  bypassScope: boolean,
): boolean {
  if (viewer.role === "admin") {
    return bypassScope || hasRecentEmployment(userHistories);
  }
  if (viewer.role !== "staff") return false;

  if (isRecentRecruiter(viewer, userHistories)) return true;

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setDate(sixMonthsAgo.getDate() - 180);

  const managedHistories = userHistories
    .filter((h) => managedFactoryIds.has(h.factory))
    .sort(compareRecentHistories);

  const latestManaged = managedHistories[0];
  if (!latestManaged) return false;

  if (isCurrentlyWorking(latestManaged)) return true;
  if (!latestManaged.leave_date) return false;

  const leaveDate = new Date(latestManaged.leave_date);
  return !Number.isNaN(leaveDate.getTime()) && leaveDate >= sixMonthsAgo;
}

function buildWorkspace(
  viewer: UserRecord,
  histories: EmploymentHistoryRecord[],
  users: WorkerRecord[],
  managedFactoryIds: Set<string>,
  opts?: { bypassScope?: boolean },
) {
  const bypassScope = opts?.bypassScope ?? false;
  const grouped = new Map<string, EmploymentHistoryRecord[]>();
  for (const history of histories) {
    const bucket = grouped.get(history.user) || [];
    bucket.push(history);
    grouped.set(history.user, bucket);
  }

  const workerMap = new Map(users.map((item) => [item.id, item]));
  const workerEntries =
    viewer.role === "admin"
      ? users.map((item) => [item.id, grouped.get(item.id) || []] as const)
      : [...grouped.entries()];

  const workers = workerEntries
    .map(([userId, userHistories]) => {
      const user = workerMap.get(userId);
      if (!user) return null;

      // Tài khoản NLĐ mới import chưa có lịch sử đi làm vẫn phải hiện cho quản trị viên.
      if (
        userHistories.length > 0 &&
        !isWorkerInStaffScope(viewer, userHistories, managedFactoryIds, bypassScope)
      ) {
        return null;
      }

      const visibleHistories = userHistories;

      const latestHistory = getLatestEmploymentHistory(visibleHistories);
      const activeHistory = visibleHistories.find((item) => isCurrentlyWorking(item)) || null;
      const recentRecruiter = isRecentRecruiter(viewer, visibleHistories);
      const reasons = new Set<StaffVisibilityReason>();
      for (const history of visibleHistories) {
        for (const reason of getStaffReasonsForHistory(viewer.id, history, managedFactoryIds)) {
          reasons.add(reason);
        }
      }
      if (recentRecruiter) reasons.add("nvtd");

      if (viewer.role === "admin" && reasons.size === 0) {
        reasons.add("qlnm");
        reasons.add("nvtd");
      }

      if (!reasons.size && viewer.role !== "admin") return null;

      const sortedHistories = [...visibleHistories].sort(compareRecentHistories);

      return {
        user,
        histories: sortedHistories,
        latestHistory,
        recentHistories: getRecentRecruiterHistories(visibleHistories),
        reasons: [...reasons],
        isRecentRecruiter: recentRecruiter,
        canReportAdvance: canReportAdvance(viewer, visibleHistories),
        canUpdateBank: canUpdateBank(viewer, visibleHistories, managedFactoryIds),
        canViewPayroll: canViewPayroll(viewer, visibleHistories, managedFactoryIds),
        canReportLeave: canReportLeave(viewer, activeHistory, visibleHistories, managedFactoryIds),
        canReportJoin: canReportJoin(viewer, visibleHistories, managedFactoryIds),
        canEditHistory: canEditHistory(viewer, visibleHistories, managedFactoryIds),
      } satisfies StaffWorkerRecord;
    })
    .filter(Boolean)
    .sort((a, b) => {
      const nameA = (a!.user.full_name || a!.user.username || "").toLowerCase();
      const nameB = (b!.user.full_name || b!.user.username || "").toLowerCase();
      return nameA.localeCompare(nameB, "vi");
    }) as StaffWorkerRecord[];

  return { managedFactoryIds, workers };
}

async function getManagedFactoryIds(viewer: UserRecord) {
  const managers = await fetchFactoryManagers(viewer.id);
  return new Set(
    managers.filter((item) => isFactoryAssignmentActive(item)).map((item) => item.factory),
  );
}

async function fetchAdminWorkerAccounts(viewer: UserRecord): Promise<WorkerRecord[]> {
  if (viewer.role !== "admin") return [];

  return pb
    .collection("workers")
    .getFullList<WorkerRecord>({
      filter: companyFilter(viewer),
      sort: "full_name",
    })
    .catch(() => [] as WorkerRecord[]);
}

function mergeUsers(...groups: WorkerRecord[][]): WorkerRecord[] {
  const usersById = new Map<string, WorkerRecord>();
  for (const group of groups) {
    for (const user of group) usersById.set(user.id, user);
  }
  return [...usersById.values()];
}

export async function fetchCachedStaffWorkspace(viewer: UserRecord) {
  const managedFactoryIds = await getManagedFactoryIds(viewer);
  const useCache = viewer.role === "admin" || viewer.role === "staff";
  const fingerprint = buildScopeFingerprint(
    viewer.id,
    managedFactoryIds,
    viewer.role,
    companyIdOf(viewer),
  );
  const cacheValid = useCache ? await isCacheScopeValid(fingerprint) : false;
  const cached = useCache && cacheValid ? await readCachedStaffData() : null;
  const adminWorkerAccounts = await fetchAdminWorkerAccounts(viewer);

  return cached
    ? buildWorkspace(
        viewer,
        cached.histories,
        mergeUsers(cached.users, adminWorkerAccounts),
        managedFactoryIds,
      )
    : null;
}

export async function fetchFreshStaffWorkspace(
  viewer: UserRecord,
  opts?: { bypassScope?: boolean; hydrateCache?: boolean },
) {
  const managedFactoryIds = await getManagedFactoryIds(viewer);
  const historyFilter = opts?.bypassScope
    ? ""
    : buildScopedHistoryFilter(viewer, managedFactoryIds);
  const synced = await syncStaffData({
    historyFilter,
    useCache: false,
    includeCccdVersions: false,
    hydrateCache: opts?.hydrateCache,
  });

  const userIds = [...new Set(synced.histories.map((h) => h.user).filter(Boolean))];
  const cachedUserIds = new Set(synced.users.map((u) => u.id));
  const missingIds = userIds.filter((id) => !cachedUserIds.has(id));
  if (missingIds.length) {
    const extra = await fetchUsersBatched(missingIds);
    synced.users.push(...extra);
  }

  if (opts?.hydrateCache) {
    await saveScopeFingerprint(
      buildScopeFingerprint(viewer.id, managedFactoryIds, viewer.role, companyIdOf(viewer)),
    );
  }

  const adminWorkerAccounts = await fetchAdminWorkerAccounts(viewer);
  return buildWorkspace(
    viewer,
    synced.histories,
    mergeUsers(synced.users, adminWorkerAccounts),
    managedFactoryIds,
    {
      bypassScope: opts?.bypassScope,
    },
  );
}

export async function fetchStaffWorkspace(
  viewer: UserRecord,
  opts?: { onCacheReady?: (result: StaffWorkspaceResult) => void },
) {
  const managedFactoryIds = await getManagedFactoryIds(viewer);

  const useCache = viewer.role === "admin" || viewer.role === "staff";

  let cacheValid = false;
  if (useCache) {
    const fingerprint = buildScopeFingerprint(
      viewer.id,
      managedFactoryIds,
      viewer.role,
      companyIdOf(viewer),
    );
    cacheValid = await isCacheScopeValid(fingerprint);
    if (!cacheValid) {
      await clearStaffCache();
    }
  }

  const cached = useCache && cacheValid ? await readCachedStaffData() : null;
  if (cached) {
    const cachedResult = buildWorkspace(viewer, cached.histories, cached.users, managedFactoryIds);
    opts?.onCacheReady?.(cachedResult);
  }

  const synced = await syncStaffData({
    historyFilter: buildScopedHistoryFilter(viewer, managedFactoryIds),
    useCache,
    includeCccdVersions: useCache,
  });

  if (useCache) {
    await saveScopeFingerprint(
      buildScopeFingerprint(viewer.id, managedFactoryIds, viewer.role, companyIdOf(viewer)),
    );
  }

  const userIds = [...new Set(synced.histories.map((h) => h.user).filter(Boolean))];
  const cachedUserIds = new Set(synced.users.map((u) => u.id));
  const missingIds = userIds.filter((id) => !cachedUserIds.has(id));
  if (missingIds.length) {
    const extra = await fetchUsersBatched(missingIds);
    synced.users.push(...extra);
  }

  const adminWorkerAccounts = await fetchAdminWorkerAccounts(viewer);
  return buildWorkspace(
    viewer,
    synced.histories,
    mergeUsers(synced.users, adminWorkerAccounts),
    managedFactoryIds,
  );
}

export async function fetchStaffWorkerWorkspace(viewer: UserRecord, workerId: string) {
  const workspace = await fetchStaffWorkspace(viewer);
  const worker = workspace.workers.find((item) => item.user.id === workerId) ?? null;
  if (worker || viewer.role !== "admin") {
    return { ...workspace, worker };
  }

  const fullWorkspace = await fetchFreshStaffWorkspace(viewer, { bypassScope: true });
  return {
    ...fullWorkspace,
    worker: fullWorkspace.workers.find((item) => item.user.id === workerId) ?? null,
  };
}

export type StaffWorkspaceResult = ReturnType<typeof buildWorkspace>;
