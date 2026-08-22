import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BarChart3,
  BriefcaseBusiness,
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  FileDown,
  ImageDown,
  Landmark,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Wallet,
  UserRoundCheck,
  UserRoundMinus,
  Users,
  UserRoundSearch,
  WifiOff,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { useDebouncedSearch } from "@/hooks/use-debounced-search";
import { normalizeUserPickerSearch } from "@/components/workforce/UserPicker";
import { PageContainer } from "@/components/layout/PageContainer";
import { WorkforceDashboard } from "@/components/workforce/WorkforceDashboard";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { StatCard } from "@/components/ui/stat-card";
import { StatusChip } from "@/components/ui/status-chip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { pb, type UserRecord } from "@/lib/pocketbase";
import { useAppSettings } from "@/lib/app-settings";
import { filterEmploymentFactories } from "@/lib/staff-employment-scope";
import { formatMoneyInput, parseMoneyInput } from "@/lib/money";
import {
  fetchEmploymentHistories,
  getHistoryCccdImageProgress,
  getLatestEmploymentHistory,
  isCurrentlyWorking,
  maskCccd,
  updateEmploymentHistory,
  updateUserAndCache,
  type EmploymentHistoryRecord,
} from "@/lib/employment";
import type { FactoryRecord } from "@/lib/factories";
import type { MainHouseRecord } from "@/lib/main-houses";
import { fetchCachedStaffWorkspace, type StaffWorkerRecord } from "@/lib/staff-permissions";
import { readCachedAuxData } from "@/lib/staff-cache";
import { getRecruiterDisplay } from "@/lib/recruiters";
import {
  staffDirectoryAuxQueryKey,
  staffWorkspaceQueryKey,
  useStaffDirectoryAuxQuery,
  useStaffWorkspaceQuery,
} from "@/lib/staff-workspace-query";
import { useStaffCacheSignal } from "@/lib/use-staff-cache-signal";
import { cn } from "@/lib/utils";
import { createStaffActionLog } from "@/lib/staff-log";
import { CccdManager } from "@/components/cccd/CccdManager";
import { CccdHistoryExportDialog } from "@/components/cccd/CccdHistoryExportDialog";
import { WorkerEmploymentDrawer } from "@/components/employment/WorkerEmploymentDrawer";
import { QuickWorkerAccountDialog } from "@/components/staff/QuickWorkerAccountDialog";
import { WorkerJoinSelectorDialog } from "@/components/staff/WorkerJoinSelectorDialog";
import { WorkerDesktopCard } from "@/components/staff/WorkerDesktopCard";
import { StaffWorkerDirectory } from "@/components/staff/StaffWorkerDirectory";
import { RecruitChartDialog } from "@/components/workforce/RecruitChartDialog";
import { RegisterDialog as SharedRegisterDialog } from "@/components/workforce/RegisterDialog";
import { getUserErrorMessage } from "@/lib/toast";
import { useStaffExcelExport } from "@/components/staff/staff-excel-export-context";

export const Route = createFileRoute("/_authenticated/admin/workforce")({
  beforeLoad: () => {
    if (typeof window === "undefined") return;
    const currentUser = pb.authStore.record as UserRecord | null;
    if (!currentUser || currentUser.role !== "admin") throw redirect({ to: "/" });
  },
  pendingMs: Infinity,
  component: WorkforcePage,
});

type ActiveTab = "list" | "stats" | "my-recruited";
type RecruitSubTab = "factory" | "recruiter";
type ListScope = "all" | "working" | "left";

const WORKER_LIST_PAGE_SIZE = 100;
const EMPTY_WORKSPACE_WORKERS: StaffWorkerRecord[] = [];
const EMPTY_USERS: UserRecord[] = [];
const EMPTY_FACTORIES: FactoryRecord[] = [];
const EMPTY_MAIN_HOUSES: MainHouseRecord[] = [];

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function daysAgoIso(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function inDateRange(value: string | undefined, from: string, to: string) {
  if (!value) return false;
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return false;
  const fromT = new Date(`${from}T00:00:00`).getTime();
  const toT = new Date(`${to}T23:59:59.999`).getTime();
  return t >= fromT && t <= toT;
}

function endOfDayDate(value: string) {
  const date = new Date(`${value}T23:59:59.999`);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function endOfDayTime(value: string) {
  return endOfDayDate(value).getTime();
}

function historySortTime(history: EmploymentHistoryRecord) {
  return new Date(history.join_date || history.created || 0).getTime();
}

function latestJoinTime(history: EmploymentHistoryRecord | null) {
  const time = new Date(history?.join_date || "").getTime();
  return Number.isNaN(time) ? null : time;
}

function getLatestHistoryAtEndDate(histories: EmploymentHistoryRecord[], to: string) {
  const toT = endOfDayTime(to);
  let latest: EmploymentHistoryRecord | null = null;
  for (const h of histories) {
    const joinT = new Date(h.join_date).getTime();
    if (Number.isNaN(joinT) || joinT > toT) continue;
    if (!latest || historySortTime(h) > historySortTime(latest)) {
      latest = h;
    }
  }
  return latest;
}

function isWorkingAtEndDate(history: EmploymentHistoryRecord, to: string) {
  const referenceDate = endOfDayDate(to);
  const joinT = new Date(history.join_date).getTime();
  if (Number.isNaN(joinT) || joinT > referenceDate.getTime()) return false;
  return isCurrentlyWorking(history, referenceDate);
}

function hasLeftInDateRange(history: EmploymentHistoryRecord, from: string, to: string) {
  return (
    !isCurrentlyWorking(history, endOfDayDate(to)) && inDateRange(history.leave_date, from, to)
  );
}

function formatDate(value?: string) {
  if (!value) return "—";
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : value;
}

function getWorkerDisplayName(user?: UserRecord) {
  return user?.full_name?.trim() || user?.username?.trim() || "Thiếu thông tin";
}

function getErrorMessage(error: unknown, fallback: string) {
  return getUserErrorMessage(error, fallback);
}

function getPocketBaseFieldErrors(error: unknown) {
  const data =
    typeof error === "object" && error !== null && "data" in error
      ? (error.data as { data?: Record<string, unknown> }).data
      : undefined;
  if (!data) return "";
  return Object.entries(data)
    .map(([field, value]) => {
      const message =
        typeof value === "object" && value !== null && "message" in value
          ? String(value.message)
          : String(value);
      return `${field}: ${message}`;
    })
    .join("; ");
}

function WorkforcePage() {
  const currentUser = pb.authStore.record as UserRecord | null;
  const { openStaffExcelExport } = useStaffExcelExport();
  const { data: settings } = useAppSettings();
  const queryClient = useQueryClient();
  const workspaceQuery = useStaffWorkspaceQuery(currentUser);
  const auxQuery = useStaffDirectoryAuxQuery(currentUser);
  const [tab, setTab] = useState<ActiveTab>("list");
  const [from, setFrom] = useState(daysAgoIso(30));
  const [to, setTo] = useState(todayIso());
  const [openRegister, setOpenRegister] = useState(false);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [joinSelectorOpen, setJoinSelectorOpen] = useState(false);
  const [selectedJoinWorker, setSelectedJoinWorker] = useState<{
    user: UserRecord;
    histories: EmploymentHistoryRecord[];
  } | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [cccdExportOpen, setCccdExportOpen] = useState(false);
  const [chartOpen, setChartOpen] = useState(false);
  const [selectedFactoryIds, setSelectedFactoryIds] = useState<string[]>([]);
  const [selectedRecruiterIds, setSelectedRecruiterIds] = useState<string[]>([]);

  useEffect(() => {
    const mobileViewport = window.matchMedia("(max-width: 1023px)");
    const keepVisibleTab = () => {
      if (mobileViewport.matches) {
        setTab((current) => (current === "stats" ? "list" : current));
      }
    };

    keepVisibleTab();
    mobileViewport.addEventListener("change", keepVisibleTab);
    return () => mobileViewport.removeEventListener("change", keepVisibleTab);
  }, []);

  const workspace = workspaceQuery.data;
  const workspaceWorkers = workspace?.workers ?? EMPTY_WORKSPACE_WORKERS;
  const staffAdminUsers = auxQuery.data?.staffUsers ?? EMPTY_USERS;
  const factories = auxQuery.data?.factories ?? EMPTY_FACTORIES;
  const employmentFactories = filterEmploymentFactories(
    currentUser,
    factories,
    workspace?.managedFactoryIds ?? new Set<string>(),
    settings.staff_employment_factory_scope,
  );
  const mainHouses = auxQuery.data?.recruitmentEntities ?? EMPTY_MAIN_HOUSES;
  const histories = useMemo(
    () => workspaceWorkers.flatMap((worker) => worker.histories),
    [workspaceWorkers],
  );
  const users = useMemo(() => {
    const workerUsers = workspaceWorkers.map((worker) => worker.user);
    const workerIds = new Set(workerUsers.map((user) => user.id));
    return [...workerUsers, ...staffAdminUsers.filter((user) => !workerIds.has(user.id))];
  }, [staffAdminUsers, workspaceWorkers]);

  const refreshWorkforce = async () => {
    await Promise.all([workspaceQuery.refetch(), auxQuery.refetch()]);
  };

  const cacheSignal = useStaffCacheSignal();
  useEffect(() => {
    if (!currentUser?.id || cacheSignal === 0) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void Promise.all([fetchCachedStaffWorkspace(currentUser), readCachedAuxData()])
        .then(([cachedWorkspace, cachedAux]) => {
          if (cancelled) return;
          if (cachedWorkspace) {
            queryClient.setQueryData(staffWorkspaceQueryKey(currentUser), cachedWorkspace);
          }
          if (cachedAux) {
            queryClient.setQueryData(staffDirectoryAuxQueryKey(currentUser), cachedAux);
          }
        })
        .catch((error) => console.warn("[admin-workforce] cache signal refresh failed", error));
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [cacheSignal, currentUser, queryClient]);

  const loading = !workspace && workspaceQuery.isPending;
  const initialError = !workspace && workspaceQuery.isError;
  const refreshing = Boolean(workspace && (workspaceQuery.isFetching || auxQuery.isFetching));
  const showingCachedError = Boolean(workspace && (workspaceQuery.isError || auxQuery.isError));

  const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const factoryById = useMemo(() => new Map(factories.map((f) => [f.id, f])), [factories]);

  const historiesByUser = useMemo(() => {
    const map = new Map<string, EmploymentHistoryRecord[]>();
    for (const h of histories) {
      const arr = map.get(h.user) || [];
      arr.push(h);
      map.set(h.user, arr);
    }
    return map;
  }, [histories]);

  const latestByUser = useMemo(() => {
    const latest = new Map<string, EmploymentHistoryRecord>();
    for (const [userId, arr] of historiesByUser.entries()) {
      const l = getLatestEmploymentHistory(arr);
      if (l) latest.set(userId, l);
    }
    return latest;
  }, [historiesByUser]);

  const stats = useMemo(() => {
    let working = 0;
    let joined = 0;
    let left = 0;
    for (const arr of historiesByUser.values()) {
      const h = getLatestHistoryAtEndDate(arr, to);
      if (h && isWorkingAtEndDate(h, to)) working++;
    }
    for (const h of histories) {
      if (inDateRange(h.join_date, from, to)) joined++;
      if (hasLeftInDateRange(h, from, to)) left++;
    }
    return { working, joined, left };
  }, [historiesByUser, histories, from, to]);

  const filteredHistoriesByDate = useMemo(() => {
    return histories.filter(
      (h) => inDateRange(h.join_date, from, to) || hasLeftInDateRange(h, from, to),
    );
  }, [histories, from, to]);

  const filteredHistoriesForStats = useMemo(() => {
    let result = filteredHistoriesByDate;
    if (selectedFactoryIds.length > 0) {
      const set = new Set(selectedFactoryIds);
      result = result.filter((h) => set.has(h.factory));
    }
    if (selectedRecruiterIds.length > 0) {
      const set = new Set(selectedRecruiterIds);
      result = result.filter((h) => h.recruiter_staff && set.has(h.recruiter_staff));
    }
    return result;
  }, [filteredHistoriesByDate, selectedFactoryIds, selectedRecruiterIds]);

  const latestByUserForStats = useMemo(() => {
    const map = new Map<string, EmploymentHistoryRecord[]>();
    for (const h of histories) {
      if (selectedFactoryIds.length > 0 && !selectedFactoryIds.includes(h.factory)) continue;
      if (
        selectedRecruiterIds.length > 0 &&
        (!h.recruiter_staff || !selectedRecruiterIds.includes(h.recruiter_staff))
      ) {
        continue;
      }
      const arr = map.get(h.user) || [];
      arr.push(h);
      map.set(h.user, arr);
    }
    const latest = new Map<string, EmploymentHistoryRecord>();
    for (const [userId, arr] of map.entries()) {
      const l = getLatestHistoryAtEndDate(arr, to);
      if (l) latest.set(userId, l);
    }
    return latest;
  }, [histories, selectedFactoryIds, selectedRecruiterIds, to]);

  const filteredStats = useMemo(() => {
    let working = 0;
    let joined = 0;
    let left = 0;
    for (const h of latestByUserForStats.values()) {
      if (isWorkingAtEndDate(h, to)) working++;
    }
    for (const h of filteredHistoriesForStats) {
      if (inDateRange(h.join_date, from, to)) joined++;
      if (hasLeftInDateRange(h, from, to)) left++;
    }
    return { working, joined, left };
  }, [latestByUserForStats, filteredHistoriesForStats, from, to]);

  const filteredFactoriesForStats = useMemo(() => {
    if (selectedFactoryIds.length === 0) return factories;
    const set = new Set(selectedFactoryIds);
    return factories.filter((f) => set.has(f.id));
  }, [factories, selectedFactoryIds]);

  return (
    <PageContainer
      title="Nhân sự đi làm"
      subtitle="Quản trị tuyển dụng & danh sách lao động"
      right={
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setOpenRegister(true)}
            className="flex h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs font-medium text-foreground shadow-sm active:scale-[0.98]"
            aria-label="Đăng ký đi làm"
          >
            <BriefcaseBusiness className="h-4 w-4" />
            Đăng ký
          </button>
          <button
            type="button"
            onClick={openStaffExcelExport}
            className="hidden h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted active:scale-[0.98] desktop:flex"
            aria-label="Xuất Excel"
          >
            <FileDown className="h-4 w-4" />
            Xuất Excel
          </button>
          <button
            type="button"
            onClick={() => setCccdExportOpen(true)}
            className="hidden h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted active:scale-[0.98] desktop:flex"
            aria-label="Xuất ảnh CCCD"
          >
            <ImageDown className="h-4 w-4" />
            Xuất CCCD
          </button>
          <button
            type="button"
            onClick={() => setJoinSelectorOpen(true)}
            className="flex h-9 items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-3 text-xs font-medium text-primary shadow-sm active:scale-[0.98]"
            aria-label="Nối TN cho NLĐ đã có"
          >
            <UserRoundSearch className="h-4 w-4" />
            Nối TN
          </button>
          <button
            type="button"
            onClick={() => setQuickCreateOpen(true)}
            className="flex h-9 items-center gap-1.5 rounded-full bg-primary px-3 text-xs font-medium text-primary-foreground shadow active:scale-[0.98]"
            aria-label="Tạo nhanh hồ sơ NLĐ"
          >
            <Plus className="h-4 w-4" />
            Tạo nhanh
          </button>
        </div>
      }
    >
      {refreshing && (
        <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-card/70 px-3 py-2 text-xs text-muted-foreground">
          <RefreshCw className="h-3.5 w-3.5 animate-spin text-primary" />
          Đang đồng bộ dữ liệu lao động...
        </div>
      )}

      {showingCachedError && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
          <span className="min-w-0">
            Đang hiển thị dữ liệu đã lưu. Chưa thể đồng bộ dữ liệu mới.
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 rounded-full"
            onClick={() => void refreshWorkforce()}
          >
            Thử lại
          </Button>
        </div>
      )}

      {initialError ? (
        <EmptyState
          icon={WifiOff}
          title="Không tải được dữ liệu lao động"
          description="Thiết bị chưa có dữ liệu đã lưu và hiện không thể kết nối PocketBase."
          action={
            <Button type="button" className="rounded-full" onClick={() => void refreshWorkforce()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Thử lại
            </Button>
          }
        />
      ) : (
        <Tabs value={tab} onValueChange={(v) => setTab(v as ActiveTab)} className="space-y-3">
          <TabsList className="sticky top-[calc(env(safe-area-inset-top)+3.25rem)] z-20 grid w-full grid-cols-2 gap-1 desktop:grid-cols-3">
            <TabsTrigger
              value="list"
              className="min-w-0 w-full rounded-lg bg-muted text-xs shadow-sm"
            >
              Danh sách
            </TabsTrigger>
            <TabsTrigger
              value="stats"
              className="hidden min-w-0 w-full rounded-lg bg-muted text-xs shadow-sm desktop:inline-flex"
            >
              Thống kê
            </TabsTrigger>
            <TabsTrigger
              value="my-recruited"
              className="min-w-0 w-full rounded-lg bg-muted text-xs shadow-sm"
            >
              Tôi tuyển
            </TabsTrigger>
          </TabsList>

          <TabsContent value="list" className="mt-0">
            <WorkerList
              histories={histories}
              userById={userById}
              factoryById={factoryById}
              latestByUser={latestByUser}
              loading={loading}
              onSelectWorker={setSelectedUserId}
              headerSlot={
                <div className="grid grid-cols-2 gap-2 desktop:hidden">
                  <button
                    type="button"
                    onClick={openStaffExcelExport}
                    className="flex items-center justify-center gap-1.5 rounded-xl border bg-card px-3 py-2 text-xs font-medium text-foreground"
                  >
                    <FileDown className="h-4 w-4" />
                    Xuất Excel
                  </button>
                  <button
                    type="button"
                    onClick={() => setCccdExportOpen(true)}
                    className="flex items-center justify-center gap-1.5 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-xs font-medium text-primary"
                  >
                    <ImageDown className="h-4 w-4" />
                    Xuất CCCD
                  </button>
                </div>
              }
            />
          </TabsContent>

          <TabsContent value="stats" className="mt-0 hidden space-y-3 desktop:block">
            <WorkforceDashboard viewer={currentUser} detailHref="/admin/workforce" />
          </TabsContent>

          <TabsContent value="my-recruited" className="mt-0 space-y-3">
            <StaffWorkerDirectory
              workers={workspaceWorkers}
              viewer={currentUser}
              loading={loading}
              mode="recruited"
              embedded
              onSelectWorker={(worker) => setSelectedUserId(worker.user.id)}
            />
          </TabsContent>
        </Tabs>
      )}

      <RegisterDialog
        open={openRegister}
        actor={currentUser}
        onClose={() => setOpenRegister(false)}
        users={users}
        factories={factories}
        mainHouses={mainHouses}
        onCreated={refreshWorkforce}
      />

      <QuickWorkerAccountDialog
        open={quickCreateOpen}
        onOpenChange={setQuickCreateOpen}
        actor={currentUser}
        factories={employmentFactories}
        mainHouses={mainHouses}
        staffUsers={users.filter((item) => item.role === "staff" || item.role === "admin")}
        onCreated={(results) => {
          void refreshWorkforce().then(() => {
            if (results.length === 1) setSelectedUserId(results[0].worker.id);
          });
        }}
      />

      <WorkerJoinSelectorDialog
        open={joinSelectorOpen}
        onOpenChange={setJoinSelectorOpen}
        viewer={currentUser}
        factories={factories}
        onSelect={(candidate) => {
          setJoinSelectorOpen(false);
          setSelectedJoinWorker(candidate);
        }}
      />

      <WorkerEmploymentDrawer
        user={selectedJoinWorker?.user ?? null}
        actor={currentUser}
        histories={selectedJoinWorker?.histories ?? []}
        factories={factories}
        mainHouses={mainHouses}
        users={users}
        managedFactoryIds={workspace?.managedFactoryIds}
        factoryScope={settings.staff_employment_factory_scope}
        initialJoinOpen
        permissions={{
          canEditHistory: false,
          canAddOldHistory: false,
          canReportAdvance: false,
          canUpdateBank: false,
          canReportLeave: false,
          canReportJoin: true,
          canViewPayroll: false,
        }}
        open={Boolean(selectedJoinWorker)}
        onClose={() => setSelectedJoinWorker(null)}
        onDataChanged={async () => {
          setSelectedJoinWorker(null);
          await refreshWorkforce();
        }}
      />

      <WorkerEmploymentDrawer
        user={selectedUserId ? userById.get(selectedUserId) || null : null}
        actor={currentUser}
        histories={selectedUserId ? histories.filter((h) => h.user === selectedUserId) : []}
        factories={factories}
        mainHouses={mainHouses}
        users={users}
        permissions={{
          canEditHistory: true,
          canAddOldHistory: true,
          canReportAdvance: true,
          canUpdateBank: true,
          canReportLeave: true,
          canReportJoin: true,
          canViewPayroll: true,
        }}
        open={!!selectedUserId}
        onClose={() => setSelectedUserId(null)}
        onDataChanged={refreshWorkforce}
      />

      <CccdHistoryExportDialog
        open={cccdExportOpen}
        onClose={() => setCccdExportOpen(false)}
        histories={histories}
        users={users}
        factories={factories}
      />

      <RecruitChartDialog
        open={chartOpen}
        onOpenChange={setChartOpen}
        histories={histories}
        users={users}
        factories={factories}
      />
    </PageContainer>
  );
}

function RecruitGroups({
  histories,
  factories,
  users,
  from,
  to,
  latestByUser,
  loading,
  onSelectWorker,
}: {
  histories: EmploymentHistoryRecord[];
  factories: FactoryRecord[];
  users: UserRecord[];
  from: string;
  to: string;
  latestByUser: Map<string, EmploymentHistoryRecord>;
  loading: boolean;
  onSelectWorker: (userId: string) => void;
}) {
  const [sub, setSub] = useState<RecruitSubTab>("factory");
  const userById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);

  const factoryStats = useMemo(() => {
    const map = new Map<string, { working: number; joined: number; left: number }>();
    for (const f of factories) map.set(f.id, { working: 0, joined: 0, left: 0 });

    for (const h of latestByUser.values()) {
      if (isWorkingAtEndDate(h, to)) {
        const s = map.get(h.factory) || { working: 0, joined: 0, left: 0 };
        s.working++;
        map.set(h.factory, s);
      }
    }
    for (const h of histories) {
      if (inDateRange(h.join_date, from, to)) {
        const s = map.get(h.factory) || { working: 0, joined: 0, left: 0 };
        s.joined++;
        map.set(h.factory, s);
      }
      if (hasLeftInDateRange(h, from, to)) {
        const s = map.get(h.factory) || { working: 0, joined: 0, left: 0 };
        s.left++;
        map.set(h.factory, s);
      }
    }
    return map;
  }, [factories, histories, latestByUser, from, to]);

  const recruiterStats = useMemo(() => {
    const map = new Map<string, { working: number; joined: number; left: number }>();
    const staffSet = new Set(users.filter((u) => u.role === "staff").map((u) => u.id));

    for (const h of latestByUser.values()) {
      const recruiterId = h.recruiter_staff;
      if (!recruiterId || !staffSet.has(recruiterId)) continue;
      if (isWorkingAtEndDate(h, to)) {
        const s = map.get(recruiterId) || { working: 0, joined: 0, left: 0 };
        s.working++;
        map.set(recruiterId, s);
      }
    }
    for (const h of histories) {
      const recruiterId = h.recruiter_staff;
      if (!recruiterId || !staffSet.has(recruiterId)) continue;
      if (inDateRange(h.join_date, from, to)) {
        const s = map.get(recruiterId) || { working: 0, joined: 0, left: 0 };
        s.joined++;
        map.set(recruiterId, s);
      }
      if (hasLeftInDateRange(h, from, to)) {
        const s = map.get(recruiterId) || { working: 0, joined: 0, left: 0 };
        s.left++;
        map.set(recruiterId, s);
      }
    }
    return map;
  }, [users, histories, latestByUser, from, to]);

  return (
    <Tabs value={sub} onValueChange={(v) => setSub(v as RecruitSubTab)} className="space-y-2">
      <TabsList className="grid h-9 w-full grid-cols-2 rounded-xl">
        <TabsTrigger value="factory" className="rounded-lg text-xs">
          Theo nhà máy
        </TabsTrigger>
        <TabsTrigger value="recruiter" className="rounded-lg text-xs">
          Theo người tuyển
        </TabsTrigger>
      </TabsList>

      <TabsContent value="factory" className="mt-0 space-y-2">
        {loading && <SkeletonRows />}
        {!loading && factories.length === 0 && (
          <EmptyState
            icon={Building2}
            title="Chưa có nhà máy"
            description="Thêm nhà máy ở phần Cài đặt để hiển thị tại đây."
          />
        )}
        {factories.map((f) => {
          const s = factoryStats.get(f.id) || { working: 0, joined: 0, left: 0 };
          if (s.working === 0 && s.joined === 0 && s.left === 0) return null;
          return (
            <GroupCard
              key={f.id}
              title={f.name}
              subtitle={f.code || ""}
              icon={Building2}
              stats={s}
              workers={collectWorkersForFactory(histories, latestByUser, userById, f.id, from, to)}
              onSelectWorker={onSelectWorker}
            />
          );
        })}
      </TabsContent>

      <TabsContent value="recruiter" className="mt-0 space-y-2">
        {loading && <SkeletonRows />}
        {!loading && recruiterStats.size === 0 && (
          <EmptyState
            icon={ShieldCheck}
            title="Chưa có người tuyển"
            description="Khi có lịch sử đi làm gắn với staff người tuyển, dữ liệu sẽ hiển thị."
          />
        )}
        {[...recruiterStats.entries()]
          .sort(([, a], [, b]) => b.joined + b.working - (a.joined + a.working))
          .map(([staffId, s]) => {
            const staff = users.find((u) => u.id === staffId);
            if (!staff) return null;
            return (
              <GroupCard
                key={staffId}
                title={staff.full_name || staff.username || "Nhân sự"}
                subtitle={staff.phone || staff.username || ""}
                icon={ShieldCheck}
                stats={s}
                workers={collectWorkersForRecruiter(
                  histories,
                  latestByUser,
                  userById,
                  staffId,
                  from,
                  to,
                )}
                onSelectWorker={onSelectWorker}
              />
            );
          })}
      </TabsContent>
    </Tabs>
  );
}

type GroupWorker = {
  userId: string;
  fullName: string;
  factoryName: string;
  state: "working" | "joined" | "left";
  date: string;
};

function collectWorkersForFactory(
  histories: EmploymentHistoryRecord[],
  latestByUser: Map<string, EmploymentHistoryRecord>,
  userById: Map<string, UserRecord>,
  factoryId: string,
  from: string,
  to: string,
): GroupWorker[] {
  const seen = new Map<string, GroupWorker>();
  for (const [userId, h] of latestByUser.entries()) {
    if (h.factory !== factoryId) continue;
    if (isWorkingAtEndDate(h, to)) {
      seen.set(`${userId}:working`, {
        userId,
        fullName: getWorkerDisplayName(userById.get(h.user)),
        factoryName: h.expand?.factory?.name || "",
        state: "working",
        date: h.join_date,
      });
    }
  }
  for (const h of histories) {
    if (h.factory !== factoryId) continue;
    if (inDateRange(h.join_date, from, to)) {
      seen.set(`${h.user}:joined:${h.id}`, {
        userId: h.user,
        fullName: getWorkerDisplayName(userById.get(h.user)),
        factoryName: h.expand?.factory?.name || "",
        state: "joined",
        date: h.join_date,
      });
    }
    if (hasLeftInDateRange(h, from, to)) {
      seen.set(`${h.user}:left:${h.id}`, {
        userId: h.user,
        fullName: getWorkerDisplayName(userById.get(h.user)),
        factoryName: h.expand?.factory?.name || "",
        state: "left",
        date: h.leave_date || "",
      });
    }
  }
  return [...seen.values()];
}

function collectWorkersForRecruiter(
  histories: EmploymentHistoryRecord[],
  latestByUser: Map<string, EmploymentHistoryRecord>,
  userById: Map<string, UserRecord>,
  staffId: string,
  from: string,
  to: string,
): GroupWorker[] {
  const seen = new Map<string, GroupWorker>();
  for (const [userId, h] of latestByUser.entries()) {
    if (h.recruiter_staff !== staffId) continue;
    if (isWorkingAtEndDate(h, to)) {
      seen.set(`${userId}:working`, {
        userId,
        fullName: getWorkerDisplayName(userById.get(h.user)),
        factoryName: h.expand?.factory?.name || "",
        state: "working",
        date: h.join_date,
      });
    }
  }
  for (const h of histories) {
    if (h.recruiter_staff !== staffId) continue;
    if (inDateRange(h.join_date, from, to)) {
      seen.set(`${h.user}:joined:${h.id}`, {
        userId: h.user,
        fullName: getWorkerDisplayName(userById.get(h.user)),
        factoryName: h.expand?.factory?.name || "",
        state: "joined",
        date: h.join_date,
      });
    }
    if (hasLeftInDateRange(h, from, to)) {
      seen.set(`${h.user}:left:${h.id}`, {
        userId: h.user,
        fullName: getWorkerDisplayName(userById.get(h.user)),
        factoryName: h.expand?.factory?.name || "",
        state: "left",
        date: h.leave_date || "",
      });
    }
  }
  return [...seen.values()];
}

function GroupCard({
  title,
  subtitle,
  icon: Icon,
  stats,
  workers,
  onSelectWorker,
}: {
  title: string;
  subtitle?: string;
  icon: typeof Building2;
  stats: { working: number; joined: number; left: number };
  workers: GroupWorker[];
  onSelectWorker: (userId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"working" | "joined" | "left">("working");

  const filtered = workers.filter((w) => w.state === view);

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{title}</div>
          {subtitle && <div className="truncate text-[11px] text-muted-foreground">{subtitle}</div>}
          <div className="mt-1 flex flex-wrap gap-1.5">
            <StatusChip tone="success">Còn đi làm: {stats.working}</StatusChip>
            <StatusChip tone="primary">Tuyển mới: {stats.joined}</StatusChip>
            <StatusChip tone="warning">Đã nghỉ: {stats.left}</StatusChip>
          </div>
        </div>
        <ChevronRight
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
      </button>

      {open && (
        <div className="border-t bg-muted/30 p-3">
          <div className="mb-2 flex gap-1.5">
            <SubChip
              label={`Còn đi làm (${stats.working})`}
              active={view === "working"}
              onClick={() => setView("working")}
            />
            <SubChip
              label={`Tuyển mới (${stats.joined})`}
              active={view === "joined"}
              onClick={() => setView("joined")}
            />
            <SubChip
              label={`Đã nghỉ (${stats.left})`}
              active={view === "left"}
              onClick={() => setView("left")}
            />
          </div>
          {filtered.length === 0 ? (
            <div className="rounded-xl border bg-card p-3 text-center text-xs text-muted-foreground">
              Không có dữ liệu
            </div>
          ) : (
            <div className="space-y-1.5">
              {filtered.map((w, idx) => (
                <button
                  key={`${w.userId}-${w.state}-${idx}`}
                  type="button"
                  onClick={() => onSelectWorker(w.userId)}
                  className="flex w-full items-center justify-between gap-2 rounded-xl border bg-card px-3 py-2 text-left text-sm"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{w.fullName}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {w.factoryName || "—"} · {w.state === "left" ? "Nghỉ" : "Vào"}{" "}
                      {formatDate(w.date)}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function SubChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium transition",
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "border border-border bg-card text-muted-foreground",
      )}
    >
      {label}
    </button>
  );
}

function WorkerList({
  histories,
  userById,
  factoryById,
  latestByUser,
  loading,
  onSelectWorker,
  headerSlot,
}: {
  histories: EmploymentHistoryRecord[];
  userById: Map<string, UserRecord>;
  factoryById: Map<string, FactoryRecord>;
  latestByUser: Map<string, EmploymentHistoryRecord>;
  loading: boolean;
  onSelectWorker: (userId: string) => void;
  headerSlot?: ReactNode;
}) {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedSearch(search);
  const [scope, setScope] = useState<ListScope>("all");
  const [page, setPage] = useState(1);
  const listTopRef = useRef<HTMLDivElement>(null);

  const updateSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const updateScope = (value: ListScope) => {
    setScope(value);
    setPage(1);
  };

  const rows = useMemo(() => {
    const userIds = new Set<string>();
    for (const h of histories) userIds.add(h.user);
    return [...userIds].map((id) => ({
      user: userById.get(id),
      latest: latestByUser.get(id) || null,
    }));
  }, [histories, userById, latestByUser]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return rows
      .filter(({ user, latest }) => {
        if (!user) return false;
        const status = latest && isCurrentlyWorking(latest) ? "working" : "left";
        if (scope === "working" && status !== "working") return false;
        if (scope === "left" && status !== "left") return false;
        if (!q) return true;
        const haystack = [
          user.full_name,
          user.username,
          user.phone,
          latest?.employee_code,
          latest?.worker_name_snapshot,
          latest?.worker_cccd_snapshot,
          latest?.worker_tax_code_snapshot,
          factoryById.get(latest?.factory || "")?.name,
          latest?.expand?.factory?.name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      })
      .sort((a, b) => {
        const aTime = latestJoinTime(a.latest);
        const bTime = latestJoinTime(b.latest);
        if (aTime !== null && bTime !== null && aTime !== bTime) return bTime - aTime;
        if (aTime === null && bTime !== null) return 1;
        if (aTime !== null && bTime === null) return -1;

        const aName = getWorkerDisplayName(a.user);
        const bName = getWorkerDisplayName(b.user);
        const nameOrder = aName.localeCompare(bName, "vi", { sensitivity: "base" });
        return nameOrder || (a.user?.id || "").localeCompare(b.user?.id || "");
      });
  }, [debouncedSearch, rows, scope, factoryById]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / WORKER_LIST_PAGE_SIZE));
  const pageStart = (page - 1) * WORKER_LIST_PAGE_SIZE;
  const pageEnd = Math.min(pageStart + WORKER_LIST_PAGE_SIZE, filtered.length);
  const visibleRows = filtered.slice(pageStart, pageEnd);

  useEffect(() => {
    setPage((currentPage) => Math.min(currentPage, totalPages));
  }, [totalPages]);

  const goToPage = (nextPage: number) => {
    const boundedPage = Math.min(Math.max(nextPage, 1), totalPages);
    if (boundedPage === page) return;
    setPage(boundedPage);
    requestAnimationFrame(() => {
      listTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  return (
    <div ref={listTopRef} className="space-y-3">
      <div className="sticky top-[calc(env(safe-area-inset-top)+6.5rem)] z-10 -mx-4 space-y-3 bg-background px-4 pb-2 pt-1">
        {headerSlot}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => updateSearch(e.target.value)}
            placeholder="Tìm tên, mã NV, CCCD, mã số thuế, SĐT, nhà máy..."
            className="rounded-full pl-9"
          />
        </div>
        <div className="flex gap-1.5">
          <SubChip
            label={`Tất cả (${rows.length})`}
            active={scope === "all"}
            onClick={() => updateScope("all")}
          />
          <SubChip
            label="Đang làm"
            active={scope === "working"}
            onClick={() => updateScope("working")}
          />
          <SubChip label="Đã nghỉ" active={scope === "left"} onClick={() => updateScope("left")} />
        </div>
      </div>

      {loading ? (
        <SkeletonRows />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Không có hồ sơ"
          description="Thử đổi từ khoá hoặc bộ lọc."
        />
      ) : (
        <>
          <div className="text-xs text-muted-foreground" aria-live="polite">
            Đang hiển thị {pageStart + 1}–{pageEnd} trong {filtered.length.toLocaleString("vi-VN")}{" "}
            lao động.
          </div>

          <div className="space-y-2">
            {visibleRows.map(({ user, latest }) => {
              if (!user) return null;
              const isWorking = !!latest && isCurrentlyWorking(latest);
              const factoryName =
                latest?.expand?.factory?.name || factoryById.get(latest?.factory || "")?.name;
              const recruiter = getRecruiterDisplay(latest);
              const recruiterName = recruiter
                ? `${recruiter.name} · ${recruiter.label}`
                : undefined;
              const mainHouseName = latest?.expand?.main_house?.name;
              const workerName = getWorkerDisplayName(user);
              const snapshotCccd = latest?.worker_cccd_snapshot || "";
              const cccdImageProgress = getHistoryCccdImageProgress(
                latest,
                histories.filter((history) => history.user === user.id),
              );

              return (
                <Fragment key={user.id}>
                  <WorkerDesktopCard
                    name={workerName}
                    username={user.username}
                    uid={latest?.uid || user.uid}
                    employeeCode={latest?.employee_code || ""}
                    cccd={maskCccd(snapshotCccd)}
                    cccdImageProgress={cccdImageProgress}
                    phone={user.phone}
                    dateOfBirth={
                      latest?.worker_date_of_birth_snapshot
                        ? formatDate(latest.worker_date_of_birth_snapshot)
                        : undefined
                    }
                    gender={user.gender}
                    address={latest?.worker_address_snapshot || latest?.hometown_snapshot}
                    factoryName={factoryName || ""}
                    mainHouseName={mainHouseName}
                    recruiterName={recruiterName}
                    joinDate={formatDate(latest?.join_date)}
                    leaveDate={latest?.leave_date ? formatDate(latest.leave_date) : undefined}
                    isWorking={isWorking}
                    onClick={() => onSelectWorker(user.id)}
                  />

                  <button
                    key={`${user.id}-mobile`}
                    type="button"
                    onClick={() => onSelectWorker(user.id)}
                    className="list-card border-l-primary flex w-full items-start justify-between gap-3 text-left desktop:hidden"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{workerName}</div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {user.uid && (
                          <>
                            <span className="font-medium text-primary">{user.uid}</span> ·{" "}
                          </>
                        )}
                        Mã NV: {latest?.employee_code || "" || "—"} · CCCD: {maskCccd(snapshotCccd)}
                        {` · Ảnh CCCD: ${cccdImageProgress}`}
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {factoryName || "Chưa có nhà máy"} · Vào {formatDate(latest?.join_date)}
                        {latest?.leave_date && ` · Nghỉ ${formatDate(latest.leave_date)}`}
                      </div>
                    </div>
                    <StatusChip tone={isWorking ? "success" : "neutral"}>
                      {isWorking ? "Đang làm" : "Đã nghỉ"}
                    </StatusChip>
                  </button>
                </Fragment>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full"
                disabled={page === 1}
                onClick={() => goToPage(page - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
                Trang trước
              </Button>

              <span className="min-w-20 text-center text-xs font-medium text-muted-foreground">
                Trang {page}/{totalPages}
              </span>

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full"
                disabled={page === totalPages}
                onClick={() => goToPage(page + 1)}
              >
                Trang sau
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-16 animate-pulse rounded-2xl bg-muted/60" />
      ))}
    </div>
  );
}

function RegisterDialog({
  open,
  actor,
  onClose,
  users,
  factories,
  mainHouses,
  onCreated,
}: {
  open: boolean;
  actor: UserRecord | null;
  onClose: () => void;
  users: UserRecord[];
  factories: FactoryRecord[];
  mainHouses: MainHouseRecord[];
  onCreated: () => void;
}) {
  return (
    <SharedRegisterDialog
      open={open}
      actor={actor}
      onClose={onClose}
      users={users}
      factories={factories}
      mainHouses={mainHouses}
      onCreated={onCreated}
      includeLongLeft
    />
  );
}

function MultiSelectFactoryPicker({
  factories,
  selected,
  onChange,
}: {
  factories: FactoryRecord[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedSearch(query);
  const selectedSet = new Set(selected);

  const toggle = (id: string) => {
    if (selectedSet.has(id)) {
      onChange(selected.filter((s) => s !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  const filteredItems = useMemo(() => {
    const keyword = normalizeUserPickerSearch(debouncedQuery);
    if (!keyword) return factories;
    return factories.filter((item) =>
      normalizeUserPickerSearch(`${item.name} ${item.code || ""}`).includes(keyword),
    );
  }, [debouncedQuery, factories]);

  const label =
    selected.length === 0
      ? "Tất cả nhà máy"
      : selected.length === 1
        ? factories.find((f) => f.id === selected[0])?.name || "1 nhà máy"
        : `${selected.length} nhà máy`;

  return (
    <div className="space-y-1">
      <Label className="text-xs">Nhà máy</Label>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery("");
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-white px-3 text-left text-sm text-slate-900"
          >
            <span className={cn("truncate", selected.length === 0 && "text-muted-foreground")}>
              {label}
            </span>
            <ChevronRight className="h-4 w-4 rotate-90 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder="Tìm nhà máy..." value={query} onValueChange={setQuery} />
            <CommandList>
              <CommandEmpty>Không tìm thấy.</CommandEmpty>
              <CommandGroup>
                {filteredItems.map((f) => (
                  <CommandItem
                    key={f.id}
                    value={`${f.name} ${f.code || ""}`}
                    onSelect={() => toggle(f.id)}
                  >
                    <div
                      className={cn(
                        "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                        selectedSet.has(f.id) ? "bg-primary text-primary-foreground" : "opacity-50",
                      )}
                    >
                      {selectedSet.has(f.id) && <Check className="h-3 w-3" />}
                    </div>
                    <Building2 className="mr-1.5 h-4 w-4 text-muted-foreground" />
                    <span className="truncate text-sm">{f.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selected.length > 0 && (
        <button
          type="button"
          onClick={() => onChange([])}
          className="text-[11px] text-muted-foreground underline"
        >
          Bỏ lọc
        </button>
      )}
    </div>
  );
}

function MultiSelectRecruiterPicker({
  users,
  selected,
  onChange,
}: {
  users: UserRecord[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedSearch(query);
  const selectedSet = new Set(selected);

  const toggle = (id: string) => {
    if (selectedSet.has(id)) {
      onChange(selected.filter((s) => s !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  const filteredItems = useMemo(() => {
    const keyword = normalizeUserPickerSearch(debouncedQuery);
    if (!keyword) return users;
    return users.filter((item) =>
      normalizeUserPickerSearch(
        `${item.full_name || ""} ${item.username || ""} ${item.phone || ""}`,
      ).includes(keyword),
    );
  }, [debouncedQuery, users]);

  const label =
    selected.length === 0
      ? "Tất cả người tuyển"
      : selected.length === 1
        ? users.find((u) => u.id === selected[0])?.full_name || "1 người tuyển"
        : `${selected.length} người tuyển`;

  return (
    <div className="space-y-1">
      <Label className="text-xs">Người tuyển</Label>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery("");
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-white px-3 text-left text-sm text-slate-900"
          >
            <span className={cn("truncate", selected.length === 0 && "text-muted-foreground")}>
              {label}
            </span>
            <ChevronRight className="h-4 w-4 rotate-90 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder="Tìm người tuyển..." value={query} onValueChange={setQuery} />
            <CommandList>
              <CommandEmpty>Không tìm thấy.</CommandEmpty>
              <CommandGroup>
                {filteredItems.map((u) => (
                  <CommandItem
                    key={u.id}
                    value={`${u.full_name || ""} ${u.username || ""} ${u.phone || ""}`}
                    onSelect={() => toggle(u.id)}
                  >
                    <div
                      className={cn(
                        "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                        selectedSet.has(u.id) ? "bg-primary text-primary-foreground" : "opacity-50",
                      )}
                    >
                      {selectedSet.has(u.id) && <Check className="h-3 w-3" />}
                    </div>
                    <ShieldCheck className="mr-1.5 h-4 w-4 text-muted-foreground" />
                    <span className="truncate text-sm">{u.full_name || u.username || "—"}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selected.length > 0 && (
        <button
          type="button"
          onClick={() => onChange([])}
          className="text-[11px] text-muted-foreground underline"
        >
          Bỏ lọc
        </button>
      )}
    </div>
  );
}
