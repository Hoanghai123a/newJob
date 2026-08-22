import { createFileRoute, redirect } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LayoutGrid } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WorkforceDashboard } from "@/components/workforce/WorkforceDashboard";
import { OtherDashboard } from "@/components/dashboard/OtherDashboard";
import { ApprovalDashboard } from "@/components/dashboard/ApprovalDashboard";
import { HourStatsDashboard } from "@/components/dashboard/HourStatsDashboard";
import {
  createEmptyApprovalDashboardStats,
  isApprovalDashboardStatus,
  type ApprovalDashboardStats,
} from "@/lib/approval-dashboard";
import { fetchCccdVersionsByIds, type CccdVersionRecord } from "@/lib/cccd-versions";
import { fetchFactories, type FactoryRecord } from "@/lib/factories";
import {
  fetchCachedStaffWorkspace,
  fetchStaffWorkspace,
  filterHistoriesForStaffScope,
  type StaffWorkspaceResult,
} from "@/lib/staff-permissions";
import { useStaffCacheSignal } from "@/lib/use-staff-cache-signal";
import { useAuth } from "@/lib/auth";
import { escapePb } from "@/lib/delegations";
import { joinTenantFilters } from "@/lib/tenant";
import { pb, type UserRecord } from "@/lib/pocketbase";
import type { EmploymentHistoryRecord } from "@/lib/employment";
import { getRecentDateKeys } from "@/lib/workforce-other-stats";

export const Route = createFileRoute("/_authenticated/staff/workforce")({
  beforeLoad: () => {
    if (typeof window === "undefined") return;
    const currentUser = pb.authStore.record as UserRecord | null;
    if (currentUser?.role !== "staff") {
      throw redirect({ to: currentUser?.role === "admin" ? "/admin/workforce" : "/" });
    }
  },
  component: StaffWorkforceDashboardPage,
});

type ActiveTab = "workforce" | "other" | "hour-stats";

type ApprovalRequestSummary = {
  status?: string;
  amount?: number | string;
};

function getScopedHistories(viewer: UserRecord, workspace: StaffWorkspaceResult) {
  const uniqueHistories = new Map<string, EmploymentHistoryRecord>();

  for (const worker of workspace.workers) {
    const visibleHistories = filterHistoriesForStaffScope(
      viewer,
      worker.histories,
      workspace.managedFactoryIds,
    );
    for (const history of visibleHistories) uniqueHistories.set(history.id, history);
  }

  return [...uniqueHistories.values()];
}

function getScopedUsers(
  viewer: UserRecord,
  workspace: StaffWorkspaceResult,
  histories: EmploymentHistoryRecord[],
  fetchedUsers: UserRecord[],
) {
  const scopedWorkerIds = new Set(histories.map((history) => history.user));
  const recruiterIds = new Set(
    histories.map((history) => history.recruiter_staff).filter((id): id is string => Boolean(id)),
  );
  const usersById = new Map<string, UserRecord>();

  for (const worker of workspace.workers) {
    if (scopedWorkerIds.has(worker.user.id)) usersById.set(worker.user.id, worker.user);
  }

  for (const user of fetchedUsers) {
    if (recruiterIds.has(user.id)) usersById.set(user.id, user);
  }

  for (const history of histories) {
    const recruiter = history.expand?.recruiter_staff as UserRecord | undefined;
    if (recruiter?.id && recruiterIds.has(recruiter.id)) usersById.set(recruiter.id, recruiter);
  }

  if (recruiterIds.has(viewer.id)) usersById.set(viewer.id, viewer);

  return [...usersById.values()].sort((a, b) =>
    (a.full_name || a.username || "").localeCompare(b.full_name || b.username || "", "vi"),
  );
}

function getScopedFactories(
  histories: EmploymentHistoryRecord[],
  fetchedFactories: FactoryRecord[],
) {
  const factoryIds = new Set(
    histories.map((history) => history.factory).filter((id): id is string => Boolean(id)),
  );
  const factoriesById = new Map(
    fetchedFactories
      .filter((factory) => factoryIds.has(factory.id))
      .map((factory) => [factory.id, factory]),
  );

  for (const history of histories) {
    const factory = history.expand?.factory as FactoryRecord | undefined;
    if (factory?.id && factoryIds.has(factory.id)) factoriesById.set(factory.id, factory);
  }

  return [...factoriesById.values()].sort((a, b) => a.name.localeCompare(b.name, "vi"));
}

function buildApprovalStats(requests: ApprovalRequestSummary[]): ApprovalDashboardStats {
  const stats = createEmptyApprovalDashboardStats();
  for (const request of requests) {
    if (!isApprovalDashboardStatus(request.status)) continue;
    const amount = Math.max(0, Number(request.amount) || 0);
    stats[request.status] += 1;
    stats.amountByStatus[request.status] += amount;
    stats.totalAmount += amount;
  }
  return stats;
}

function StaffWorkforceDashboardPage() {
  const { user } = useAuth();
  const viewer = user as UserRecord | null;
  const [tab, setTab] = useState<ActiveTab>("workforce");
  const [desktopViewport, setDesktopViewport] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [histories, setHistories] = useState<EmploymentHistoryRecord[]>([]);
  const [factories, setFactories] = useState<FactoryRecord[]>([]);
  const [staffUsers, setStaffUsers] = useState<UserRecord[]>([]);
  const [reloadToken, setReloadToken] = useState(0);
  const [otherLoading, setOtherLoading] = useState(false);
  const [otherError, setOtherError] = useState("");
  const [otherReloadToken, setOtherReloadToken] = useState(0);
  const [cccdVersions, setCccdVersions] = useState<CccdVersionRecord[]>([]);
  const [approvalStats, setApprovalStats] = useState<ApprovalDashboardStats>(
    createEmptyApprovalDashboardStats,
  );
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const syncViewport = () => setDesktopViewport(media.matches);
    syncViewport();
    media.addEventListener("change", syncViewport);
    return () => media.removeEventListener("change", syncViewport);
  }, []);

  const load = useCallback(async () => {
    if (!viewer?.id || viewer.role !== "staff") return;

    setLoading(true);
    setError("");
    try {
      const [workspace, factoryRows, staffRows] = await Promise.all([
        fetchStaffWorkspace(viewer),
        fetchFactories().catch(() => [] as FactoryRecord[]),
        pb
          .collection("users")
          .getList<UserRecord>(1, 200, {
            filter: `(role="staff" || role="admin")`,
            sort: "full_name,username",
          })
          .then((result) => result.items)
          .catch(() => [] as UserRecord[]),
      ]);
      const scopedHistories = getScopedHistories(viewer, workspace);

      setHistories(scopedHistories);
      setFactories(getScopedFactories(scopedHistories, factoryRows));
      setStaffUsers(getScopedUsers(viewer, workspace, scopedHistories, staffRows));
    } catch {
      setHistories([]);
      setFactories([]);
      setStaffUsers([]);
      setError("Không tải được dữ liệu nhân lực. Vui lòng thử lại.");
    } finally {
      setLoading(false);
    }
  }, [viewer]);

  useEffect(() => {
    if (tab === "other") load();
  }, [load, reloadToken, tab]);

  const cacheSignal = useStaffCacheSignal();
  useEffect(() => {
    if (!viewer?.id || viewer.role !== "staff" || cacheSignal === 0 || tab !== "other") return;

    const timer = setTimeout(async () => {
      const workspace = await fetchCachedStaffWorkspace(viewer);
      if (!workspace) return;

      const scopedHistories = getScopedHistories(viewer, workspace);
      setHistories(scopedHistories);
      setFactories((current) => getScopedFactories(scopedHistories, current));
      setStaffUsers((current) => getScopedUsers(viewer, workspace, scopedHistories, current));
    }, 150);

    return () => clearTimeout(timer);
  }, [cacheSignal, tab, viewer]);

  useEffect(() => {
    if (tab !== "other" || loading || !viewer?.id || viewer.role !== "staff") return;

    let alive = true;
    setOtherLoading(true);
    setOtherError("");

    const recentDates = new Set(getRecentDateKeys());
    const referencedVersionIds = histories
      .filter((history) => recentDates.has(history.join_date.slice(0, 10)))
      .map((history) => history.cccd_version || "")
      .filter(Boolean);

    Promise.all([
      fetchCccdVersionsByIds(referencedVersionIds),
      pb.collection("approval_requests").getFullList<ApprovalRequestSummary>({
        filter: joinTenantFilters(viewer, `creator = "${escapePb(viewer.id)}"`),
        fields: "status,amount",
      }),
    ])
      .then(([versions, requests]) => {
        if (!alive) return;
        setCccdVersions(versions);
        setApprovalStats(buildApprovalStats(requests));
      })
      .catch(() => {
        if (!alive) return;
        setCccdVersions([]);
        setApprovalStats(createEmptyApprovalDashboardStats());
        setOtherError("Không tải được dữ liệu tab Khác. Vui lòng thử lại.");
      })
      .finally(() => {
        if (alive) setOtherLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [histories, loading, otherReloadToken, tab, viewer?.id, viewer?.role]);

  const visibleFactories = useMemo(() => {
    const factoryIds = new Set(histories.map((history) => history.factory));
    return factories.filter((factory) => factoryIds.has(factory.id));
  }, [factories, histories]);

  if (viewer?.role !== "staff") return null;

  const combinedOtherError = error || otherError;
  const combinedOtherLoading = loading || otherLoading;
  const retryOther = () => {
    setReloadToken((value) => value + 1);
    setOtherReloadToken((value) => value + 1);
  };

  return (
    <>
      <div className="desktop:hidden">
        <PageContainer
          title="Dashboard Staff"
          subtitle="Số liệu trong phạm vi quản lý của bạn"
          desktopWidth="wide"
        >
          <Tabs
            value={tab}
            onValueChange={(value) => setTab(value as ActiveTab)}
            className="min-w-0 space-y-3"
          >
            <TabsList className="sticky top-[calc(env(safe-area-inset-top)+3.25rem)] z-20 grid h-auto w-full grid-cols-3 gap-1 rounded-xl bg-background/95 p-1 shadow-soft backdrop-blur">
              <TabsTrigger
                value="workforce"
                className="min-h-10 min-w-0 rounded-lg px-1 text-[11px] font-semibold shadow-sm"
              >
                Nhân lực
              </TabsTrigger>
              <TabsTrigger
                value="other"
                className="min-h-10 min-w-0 rounded-lg px-1 text-[11px] font-semibold shadow-sm"
              >
                Khác
              </TabsTrigger>
              <TabsTrigger
                value="hour-stats"
                className="min-h-10 min-w-0 rounded-lg px-1 text-[11px] font-semibold shadow-sm"
              >
                Thống kê giờ
              </TabsTrigger>
            </TabsList>

            <TabsContent value="workforce" className="mt-0 min-w-0">
              <WorkforceDashboard
                viewer={viewer}
                detailHref="/staff/workers"
                presentation="mobile-dialog"
              />
            </TabsContent>

            <TabsContent value="other" className="mt-0 min-w-0 space-y-3">
              <OtherDashboard
                histories={histories}
                users={staffUsers}
                factories={visibleFactories}
                cccdVersions={cccdVersions}
                loading={combinedOtherLoading}
                error={combinedOtherError}
                onRetry={retryOther}
                presentation="mobile-dialog"
              />

              <ApprovalDashboard stats={approvalStats} presentation="mobile-dialog" />
            </TabsContent>

            <TabsContent value="hour-stats" className="mt-0 min-w-0">
              {!desktopViewport && <HourStatsDashboard />}
            </TabsContent>
          </Tabs>
        </PageContainer>
      </div>

      <main
        data-staff-dashboard-content="dashboard"
        className="hidden min-h-[calc(100dvh-5rem)] min-w-0 bg-background desktop:block"
      >
        <div className="mx-auto w-full max-w-[110rem] space-y-6 px-8 py-7">
          <section id="dashboard" className="space-y-4 scroll-mt-28">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <LayoutGrid className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold tracking-tight">Dashboard</h2>
                <p className="text-sm text-muted-foreground">
                  Theo dõi nhân lực và các thông tin nghiệp vụ trong phạm vi quản lý của bạn.
                </p>
              </div>
            </div>

            <Tabs
              value={tab}
              onValueChange={(value) => setTab(value as ActiveTab)}
              className="min-w-0 space-y-4"
            >
              <TabsList className="sticky top-[calc(env(safe-area-inset-top)+3.25rem)] z-20 grid h-auto w-full min-w-0 grid-cols-3 gap-2 overflow-hidden rounded-xl bg-background/95 p-1 shadow-soft backdrop-blur desktop:grid desktop:overflow-x-hidden">
                <TabsTrigger
                  value="workforce"
                  className="w-full min-w-0 rounded-lg bg-muted px-2 text-xs shadow-sm desktop:min-w-0 desktop:px-2 desktop:text-sm"
                >
                  Nhân lực
                </TabsTrigger>
                <TabsTrigger
                  value="other"
                  className="w-full min-w-0 rounded-lg bg-muted px-2 text-xs shadow-sm desktop:min-w-0 desktop:px-2 desktop:text-sm"
                >
                  Khác
                </TabsTrigger>
                <TabsTrigger
                  value="hour-stats"
                  className="w-full min-w-0 rounded-lg bg-muted px-2 text-xs shadow-sm desktop:min-w-0 desktop:px-2 desktop:text-sm"
                >
                  Thống kê giờ
                </TabsTrigger>
              </TabsList>

              <TabsContent value="workforce" className="col-span-3 mt-0">
                <WorkforceDashboard
                  viewer={viewer}
                  detailHref="/staff/workers"
                  detailHistories={histories}
                  detailUsers={staffUsers}
                  detailFactories={visibleFactories}
                />
              </TabsContent>

              <TabsContent value="other" className="col-span-3 mt-0 space-y-4">
                <OtherDashboard
                  histories={histories}
                  users={staffUsers}
                  factories={visibleFactories}
                  cccdVersions={cccdVersions}
                  loading={combinedOtherLoading}
                  error={combinedOtherError}
                  onRetry={retryOther}
                />
                <ApprovalDashboard stats={approvalStats} />
              </TabsContent>

              <TabsContent value="hour-stats" className="col-span-3 mt-0">
                {desktopViewport && <HourStatsDashboard />}
              </TabsContent>
            </Tabs>
          </section>
        </div>
      </main>
    </>
  );
}
