import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { pb, type UserRecord } from "@/lib/pocketbase";
import { useAuth } from "@/lib/auth";
import { companyFilter, companyPayload, joinTenantFilters } from "@/lib/tenant";
import { useAppSettings } from "@/lib/app-settings";
import { useDebouncedSearch } from "@/hooks/use-debounced-search";
import {
  fetchCachedStaffWorkspace,
  fetchStaffWorkspace,
  type StaffWorkerRecord,
} from "@/lib/staff-permissions";
import { useStaffCacheSignal } from "@/lib/use-staff-cache-signal";
import { isCurrentlyWorking } from "@/lib/employment";
import { escapePb } from "@/lib/delegations";
import {
  type AdvanceRecord,
  type AdvanceStatus,
  type AdminTab,
  type AdvancePayoutMethod,
  ADVANCE_TAB_FILTERS,
  STATUS_META,
  PAYOUT_METHOD_META,
  normalizeAdvancePayoutMethod,
  joinPbFilters,
  buildAdvanceFilter,
  formatMoney,
} from "@/lib/advances";
import { PageContainer } from "@/components/layout/PageContainer";
import { FilterBar } from "@/components/ui/filter-bar";
import { StatCard } from "@/components/ui/stat-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { type ChipTone, StatusChip, toneBorder } from "@/components/ui/status-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { DataLoadingState } from "@/components/ui/data-loading-state";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createStaffActionLog } from "@/lib/staff-log";
import { parseMoneyInput, formatMoneyInput } from "@/lib/money";
import {
  assertAdvanceInteractionAllowed,
  isAdvanceInteractionAllowed,
  resolveAdvancePolicy,
  validateAdvanceAmount,
  type AdvancePolicy,
} from "@/lib/advance-policy";
import { resolveBankName } from "@/lib/vn-banks";
import { BankPicker } from "@/components/staff/BankNameInput";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { AdvancePayoutMethodPicker } from "@/components/advances/AdvancePayoutMethodPicker";
import { AdvanceReadOnlyNotice } from "@/components/advances/AdvanceReadOnlyNotice";
import {
  BarChart3,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock,
  Landmark,
  Plus,
  RotateCcw,
  Search,
  Send,
  Wallet,
  X,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { getUserErrorMessage } from "@/lib/toast";

export const Route = createFileRoute("/_authenticated/staff/advances")({
  component: StaffAdvancesPage,
});

type AdvanceSummary = {
  count: number;
  total: number;
};

function emptyAdvanceSummaries(): Record<AdminTab, AdvanceSummary> {
  return {
    pending: { count: 0, total: 0 },
    recruiter_approved: { count: 0, total: 0 },
    accepted: { count: 0, total: 0 },
    recovered: { count: 0, total: 0 },
    unrecoverable: { count: 0, total: 0 },
    rejected: { count: 0, total: 0 },
    all: { count: 0, total: 0 },
  };
}

function statValue(summary: AdvanceSummary) {
  return (
    <span className="block text-[15px] leading-tight sm:text-base">
      SL:{summary.count} - {formatMoney(summary.total)}đ
    </span>
  );
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message
  ) {
    return error.message;
  }
  return fallback;
}

async function loadAdvanceSummary(filter: string): Promise<AdvanceSummary> {
  const rows = await pb.collection("advances").getFullList<Pick<AdvanceRecord, "amount">>({
    filter,
    fields: "amount",
  });
  return rows.reduce<AdvanceSummary>(
    (summary, row) => ({
      count: summary.count + 1,
      total: summary.total + Number(row.amount || 0),
    }),
    { count: 0, total: 0 },
  );
}

type OutstandingAdvance = AdvanceRecord & {
  expand?: AdvanceRecord["expand"] & {
    requested_by?: UserRecord;
  };
};

type OutstandingWorkerSummary = {
  workerId: string;
  fullName: string;
  employeeCode: string;
  company: string;
  count: number;
  total: number;
  advances: OutstandingAdvance[];
};

function groupOutstandingAdvances(rows: OutstandingAdvance[]): OutstandingWorkerSummary[] {
  const grouped = new Map<string, OutstandingWorkerSummary>();

  for (const row of rows) {
    const workerId = row.worker || `missing-${row.id}`;
    const current = grouped.get(workerId);
    if (current) {
      current.count += 1;
      current.total += Number(row.amount || 0);
      current.advances.push(row);
      continue;
    }

    grouped.set(workerId, {
      workerId,
      fullName: row.full_name || "Chưa có tên",
      employeeCode: row.employee_code || "",
      company: row.company || "",
      count: 1,
      total: Number(row.amount || 0),
      advances: [row],
    });
  }

  return [...grouped.values()]
    .map((worker) => ({
      ...worker,
      advances: [...worker.advances].sort(
        (a, b) => new Date(b.created || 0).getTime() - new Date(a.created || 0).getTime(),
      ),
    }))
    .sort((a, b) => b.total - a.total || a.fullName.localeCompare(b.fullName, "vi"));
}

async function loadStaffAdvanceHistory(staffId: string) {
  return pb.collection("advances").getFullList<OutstandingAdvance>({
    filter: joinTenantFilters(
      pb.authStore.record as UserRecord | null,
      joinPbFilters([`recruiter_id="${escapePb(staffId)}"`, 'worker!=""']),
    ),
    sort: "-created",
    expand: "requested_by",
  });
}

function isOutstandingAdvance(row: OutstandingAdvance) {
  return (
    row.status === "pending" ||
    row.status === "recruiter_approved" ||
    (row.status === "accepted" && (!row.recovery_status || row.recovery_status === "none"))
  );
}

function advanceStatisticsStatusMeta(row: OutstandingAdvance) {
  if (row.status === "pending")
    return { label: "Ch\u1edd ng\u01b0\u1eddi tuy\u1ec3n duy\u1ec7t", tone: "warning" as const };
  if (row.status === "recruiter_approved")
    return { label: "Ch\u1edd admin duy\u1ec7t", tone: "primary" as const };
  if (row.status === "accepted" && row.recovery_status === "recovered") {
    return { label: "\u0110\u00e3 thu h\u1ed3i", tone: "success" as const };
  }
  if (row.status === "accepted" && row.recovery_status === "unrecoverable") {
    return { label: "Kh\u00f4ng thu h\u1ed3i", tone: "danger" as const };
  }
  if (row.status === "accepted")
    return { label: "Ch\u1edd thu h\u1ed3i", tone: "neutral" as const };
  if (row.status === "rejected")
    return { label: "\u0110\u00e3 t\u1eeb ch\u1ed1i", tone: "danger" as const };
  return { label: "Ch\u01b0a x\u00e1c \u0111\u1ecbnh", tone: "neutral" as const };
}

function outstandingStatusMeta(row: OutstandingAdvance) {
  if (row.status === "pending") return { label: "Chờ người tuyển duyệt", tone: "warning" as const };
  if (row.status === "recruiter_approved")
    return { label: "Chờ admin duyệt", tone: "primary" as const };
  return { label: "Chờ thu hồi", tone: "neutral" as const };
}

type AdvanceDaySummary = {
  key: string;
  label: string;
  count: number;
  total: number;
  advances: OutstandingAdvance[];
};

const advanceSevenDayChartConfig = {
  count: { label: "Số lần ứng", color: "oklch(0.68 0.17 55)" },
} satisfies ChartConfig;

function localAdvanceDateKey(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) => (index === 0 ? String(part) : String(part).padStart(2, "0")))
    .join("-");
}

function buildAdvanceDaySummaries(
  rows: OutstandingAdvance[],
  now = new Date(),
): AdvanceDaySummary[] {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() - (6 - index));
    return {
      key: localAdvanceDateKey(date),
      label: date.toLocaleDateString("vi-VN", {
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
      }),
      count: 0,
      total: 0,
      advances: [] as OutstandingAdvance[],
    };
  });
  const byKey = new Map(days.map((day) => [day.key, day]));

  for (const row of rows) {
    const day = byKey.get(localAdvanceDateKey(row.created));
    if (!day) continue;
    day.count += 1;
    day.total += Number(row.amount || 0);
    day.advances.push(row);
  }

  return days.map((day) => ({
    ...day,
    advances: [...day.advances].sort(
      (a, b) => new Date(b.created || 0).getTime() - new Date(a.created || 0).getTime(),
    ),
  }));
}

function getOutstandingRequesterName(row: OutstandingAdvance) {
  const requester = row.expand?.requested_by;
  return requester?.full_name || requester?.username || requester?.phone || "Không xác định";
}

// PLACEHOLDER_CONTINUE

function StaffAdvancesPage() {
  const { user } = useAuth();
  const { data: settings } = useAppSettings();
  const [segment, setSegment] = useState<"workers" | "mine">("workers");
  const interactionAllowed = isAdvanceInteractionAllowed(settings, user?.role);

  return (
    <PageContainer title="Ứng lương">
      {!interactionAllowed && <AdvanceReadOnlyNotice />}
      <div className="flex gap-1 rounded-lg bg-muted p-1">
        <button
          type="button"
          className={cn(
            "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            segment === "workers"
              ? "bg-background shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => setSegment("workers")}
        >
          Duyệt ứng NLĐ
        </button>
        <button
          type="button"
          className={cn(
            "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            segment === "mine"
              ? "bg-background shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => setSegment("mine")}
        >
          Ứng của tôi
        </button>
      </div>

      {segment === "workers" ? (
        <WorkerAdvancesView interactionAllowed={interactionAllowed} />
      ) : (
        <MyAdvancesView interactionAllowed={interactionAllowed} />
      )}
    </PageContainer>
  );
}

// PLACEHOLDER_WORKERS_VIEW

function WorkerAdvancesView({ interactionAllowed }: { interactionAllowed: boolean }) {
  const { user, isAdmin, isStaff } = useAuth();
  const { data: settings } = useAppSettings();
  const [items, setItems] = useState<AdvanceRecord[]>([]);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedSearch(search);
  const [tab, setTab] = useState<AdminTab>("pending");
  const [loading, setLoading] = useState(true);
  const [advanceDetail, setAdvanceDetail] = useState<AdvanceRecord | null>(null);
  const [withdrawTarget, setWithdrawTarget] = useState<AdvanceRecord | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [workers, setWorkers] = useState<StaffWorkerRecord[]>([]);
  const [loadingWorkers, setLoadingWorkers] = useState(false);
  const [selectedWorkerId, setSelectedWorkerId] = useState("");
  const [workerSearch, setWorkerSearch] = useState("");
  const debouncedWorkerSearch = useDebouncedSearch(workerSearch);
  const [workerAmountText, setWorkerAmountText] = useState("");
  const [workerReason, setWorkerReason] = useState("");
  const [workerPayoutMethod, setWorkerPayoutMethod] =
    useState<AdvancePayoutMethod>("bank_transfer");
  const [bankChoice, setBankChoice] = useState<"worker" | "staff">("worker");
  const [workerPolicy, setWorkerPolicy] = useState<AdvancePolicy | null>(null);
  const [workerPolicyError, setWorkerPolicyError] = useState("");
  const [loadingWorkerPolicy, setLoadingWorkerPolicy] = useState(false);
  const [creatingAdvance, setCreatingAdvance] = useState(false);
  const [stats, setStats] = useState<Record<AdminTab, AdvanceSummary>>(emptyAdvanceSummaries);
  const [showMobileStats, setShowMobileStats] = useState(false);
  const [outstandingWorkers, setOutstandingWorkers] = useState<OutstandingWorkerSummary[]>([]);
  const [advanceHistory, setAdvanceHistory] = useState<OutstandingAdvance[]>([]);
  const [loadingOutstandingStats, setLoadingOutstandingStats] = useState(false);
  const [showOutstandingStats, setShowOutstandingStats] = useState(false);
  const [statisticsTab, setStatisticsTab] = useState<"outstanding" | "history" | "chart">(
    "outstanding",
  );
  const [selectedOutstandingWorkerId, setSelectedOutstandingWorkerId] = useState<string | null>(
    null,
  );
  const [selectedAdvanceDate, setSelectedAdvanceDate] = useState<string | null>(null);

  const eligibleWorkers = useMemo(
    () =>
      workers.filter(
        (worker) =>
          worker.canReportAdvance &&
          (Boolean(settings.allow_advance_after_leave) ||
            worker.histories.some((history) => isCurrentlyWorking(history))),
      ),
    [settings.allow_advance_after_leave, workers],
  );
  const selectedWorker =
    eligibleWorkers.find((worker) => worker.user.id === selectedWorkerId) || null;
  const workerLimit = workerPolicy?.limit || 0;
  const workerOutstanding = workerPolicy?.outstanding || 0;
  const workerAvailable = workerPolicy?.available || 0;

  const filteredWorkers = useMemo(() => {
    const keyword = removeVietnameseTone(debouncedWorkerSearch.trim().toLowerCase());
    if (!keyword) return eligibleWorkers;
    return eligibleWorkers.filter((worker) => {
      const active = getAdvanceHistory(worker, Boolean(settings.allow_advance_after_leave));
      const haystack = removeVietnameseTone(
        [
          worker.user.full_name,
          worker.user.username,
          worker.user.phone,
          active?.employee_code,
          active?.expand?.factory?.name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
      );
      return haystack.includes(keyword);
    });
  }, [debouncedWorkerSearch, eligibleWorkers]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const filter = buildAdvanceFilter({
        isAdmin,
        isStaff,
        userId: user?.id,
        tab,
        search: debouncedSearch,
      });
      const res = await pb.collection("advances").getList(1, 300, {
        filter,
        sort: "-created",
        expand: "requested_by",
      });
      setItems(res.items as unknown as AdvanceRecord[]);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Lỗi tải Ứng lương"));
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, isAdmin, isStaff, tab, user?.id]);

  const loadOutstandingStats = useCallback(async () => {
    if (isAdmin || !isStaff || !user?.id) {
      setShowOutstandingStats(false);
      setSelectedOutstandingWorkerId(null);
      setSelectedAdvanceDate(null);
      setOutstandingWorkers([]);
      setAdvanceHistory([]);
      return;
    }

    setLoadingOutstandingStats(true);
    try {
      const rows = await loadStaffAdvanceHistory(user.id);
      setAdvanceHistory(rows);
      setOutstandingWorkers(groupOutstandingAdvances(rows.filter(isOutstandingAdvance)));
    } finally {
      setLoadingOutstandingStats(false);
    }
  }, [isAdmin, isStaff, user?.id]);

  const loadStats = useCallback(async () => {
    const base = buildAdvanceFilter({
      isAdmin,
      isStaff,
      userId: user?.id,
      search: debouncedSearch,
    });
    const withBase = (f: string) => joinPbFilters([base, f]);
    const [pending, recruiter_approved, accepted, rejected, all] = await Promise.all([
      loadAdvanceSummary(withBase(ADVANCE_TAB_FILTERS.pending)),
      loadAdvanceSummary(withBase(ADVANCE_TAB_FILTERS.recruiter_approved)),
      loadAdvanceSummary(withBase(ADVANCE_TAB_FILTERS.accepted)),
      loadAdvanceSummary(withBase(ADVANCE_TAB_FILTERS.rejected)),
      loadAdvanceSummary(base),
    ]);
    setStats((s) => ({ ...s, pending, recruiter_approved, accepted, rejected, all }));
  }, [debouncedSearch, isAdmin, isStaff, user?.id]);

  useEffect(() => {
    load();
    loadStats().catch(() => {});
    loadOutstandingStats().catch((error: unknown) =>
      toast.error((error as { message?: string })?.message || "Không tải được thống kê tồn ứng"),
    );
  }, [load, loadStats, loadOutstandingStats]);

  const outstandingTotal = useMemo(
    () => outstandingWorkers.reduce((sum, worker) => sum + worker.total, 0),
    [outstandingWorkers],
  );
  const advanceDaySummaries = useMemo(
    () => buildAdvanceDaySummaries(advanceHistory),
    [advanceHistory],
  );
  const selectedAdvanceDay =
    advanceDaySummaries.find((day) => day.key === selectedAdvanceDate) || null;
  const selectedOutstandingWorker =
    outstandingWorkers.find((worker) => worker.workerId === selectedOutstandingWorkerId) || null;

  useEffect(() => {
    if (selectedOutstandingWorkerId && !selectedOutstandingWorker) {
      setSelectedOutstandingWorkerId(null);
    }
  }, [selectedOutstandingWorker, selectedOutstandingWorkerId]);

  useEffect(() => {
    if (!showCreateForm || !user?.id) return;
    setLoadingWorkers(true);
    fetchStaffWorkspace(user as UserRecord)
      .then((workspace) => setWorkers(workspace.workers))
      .catch((error: unknown) =>
        toast.error((error as { message?: string })?.message || "Không tải được danh sách NLĐ"),
      )
      .finally(() => setLoadingWorkers(false));
  }, [showCreateForm, user]);

  const cacheSignal = useStaffCacheSignal();
  useEffect(() => {
    if (!showCreateForm || !user?.id || cacheSignal === 0) return;
    const timer = setTimeout(async () => {
      const ws = await fetchCachedStaffWorkspace(user as UserRecord);
      if (ws) setWorkers(ws.workers);
    }, 150);
    return () => clearTimeout(timer);
  }, [cacheSignal, showCreateForm, user]);

  useEffect(() => {
    if (!selectedWorkerId) {
      setWorkerPolicy(null);
      setWorkerPolicyError("");
      return;
    }
    let active = true;
    setLoadingWorkerPolicy(true);
    resolveAdvancePolicy(selectedWorkerId, {
      allowAfterLeave: Boolean(settings.allow_advance_after_leave),
      actorRole: user?.role,
    })
      .then((policy) => {
        if (!active) return;
        setWorkerPolicy(policy);
        setWorkerPolicyError("");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setWorkerPolicy(null);
        setWorkerPolicyError(getUserErrorMessage(error, "Không thể kiểm tra hạn mức ứng tiền"));
      })
      .finally(() => active && setLoadingWorkerPolicy(false));
    return () => {
      active = false;
    };
  }, [selectedWorkerId, settings.allow_advance_after_leave, user?.role]);

  const updateRow = async (id: string, payload: Partial<AdvanceRecord>) => {
    await assertAdvanceInteractionAllowed(user?.role);
    await pb.collection("advances").update(id, payload);
  };

  const staffResolve = async (row: AdvanceRecord, newStatus: "recruiter_approved" | "rejected") => {
    try {
      const after = {
        status: newStatus,
        ...(newStatus === "rejected" ? { resolved_at: new Date().toISOString() } : {}),
      };
      await updateRow(row.id, after);
      await createStaffActionLog({
        actor: user,
        targetUserId: row.worker,
        targetCollection: "advances",
        targetRecord: row.id,
        action: "update",
        before: { status: row.status || "pending" },
        after,
        note:
          newStatus === "recruiter_approved"
            ? "Người tuyển chấp nhận ứng lương"
            : "Người tuyển từ chối ứng lương",
      });
      toast.success(newStatus === "recruiter_approved" ? "Đã chấp nhận" : "Đã từ chối");
      load();
      loadStats().catch(() => {});
      loadOutstandingStats().catch(() => {});
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Lỗi xử lý"));
    }
  };

  const withdrawAdvance = async () => {
    if (!withdrawTarget || !user?.id) return;
    setWithdrawing(true);
    try {
      await withdrawStaffAdvance(user, withdrawTarget);
      toast.success("Đã thu hồi yêu cầu ứng lương");
      setWithdrawTarget(null);
      setAdvanceDetail(null);
      await load();
      await loadStats();
      await loadOutstandingStats();
    } catch (error: unknown) {
      toast.error(getWithdrawErrorMessage(error));
      setWithdrawTarget(null);
      await load();
      await loadStats().catch(() => {});
      await loadOutstandingStats().catch(() => {});
    } finally {
      setWithdrawing(false);
    }
  };

  const resetCreateForm = () => {
    setSelectedWorkerId("");
    setWorkerSearch("");
    setWorkerAmountText("");
    setWorkerReason("");
    setWorkerPayoutMethod("bank_transfer");
    setBankChoice("worker");
    setWorkerPolicy(null);
    setWorkerPolicyError("");
  };

  const createWorkerAdvance = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user?.id || !selectedWorkerId) {
      toast.error("Vui lòng chọn người lao động");
      return;
    }
    const amount = parseMoneyInput(workerAmountText);
    if (!amount) {
      toast.error("Số tiền ứng không được để trống");
      return;
    }
    if (!workerReason.trim()) {
      toast.error("Lý do ứng không được để trống");
      return;
    }

    setCreatingAdvance(true);
    try {
      await assertAdvanceInteractionAllowed(user.role);
      const workspace = await fetchStaffWorkspace(user as UserRecord);
      const currentWorker = workspace.workers.find((worker) => worker.user.id === selectedWorkerId);
      if (!currentWorker?.canReportAdvance) {
        throw new Error("Bạn không còn quyền báo ứng cho hồ sơ này");
      }
      const policy = await resolveAdvancePolicy(currentWorker.user.id, {
        allowAfterLeave: Boolean(settings.allow_advance_after_leave),
        actorRole: user.role,
      });
      validateAdvanceAmount(policy, amount);
      const employment = policy.employment;

      const bankSource = bankChoice === "staff" ? user : currentWorker.user;
      if (workerPayoutMethod === "bank_transfer" && !bankSource.bank_account_number) {
        throw new Error(
          bankChoice === "staff"
            ? "Tài khoản ngân hàng của staff chưa có"
            : "Tài khoản ngân hàng của NLĐ chưa có",
        );
      }

      const payload = {
        worker: currentWorker.user.id,
        requested_by: user.id,
        recruiter_id: employment.recruiter_staff || "",
        employee_code: employment.employee_code || "",
        full_name: employment.worker_name_snapshot || currentWorker.user.full_name || "",
        company: policy.factoryName,
        phone: currentWorker.user.phone || "",
        join_date: employment.join_date || "",
        bank_name: workerPayoutMethod === "cash" ? "" : bankSource.bank_name || "",
        bank_account_number:
          workerPayoutMethod === "cash" ? "" : bankSource.bank_account_number || "",
        bank_account_name: workerPayoutMethod === "cash" ? "" : bankSource.bank_account_name || "",
        payout_method: workerPayoutMethod,
        amount,
        reason: workerReason.trim(),
        status: "recruiter_approved",
        recovery_status: "none",
      };
      const created = await pb
        .collection("advances")
        .create({ ...payload, ...companyPayload(user) });
      await createStaffActionLog({
        actor: user,
        targetUserId: currentWorker.user.id,
        targetCollection: "advances",
        targetRecord: created.id,
        action: "report_advance",
        after: payload,
        note: "Staff tạo yêu cầu ứng lương thay người lao động từ màn duyệt ứng",
      });

      toast.success("Đã gửi yêu cầu ứng lương cho NLĐ");
      setShowCreateForm(false);
      resetCreateForm();
      setTab("recruiter_approved");
      await load();
      await loadStats();
      await loadOutstandingStats();
    } catch (error: unknown) {
      toast.error((error as { message?: string })?.message || "Không thể tạo yêu cầu ứng lương");
    } finally {
      setCreatingAdvance(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setShowMobileStats((current) => !current)}
        aria-expanded={showMobileStats}
        aria-controls="staff-advance-statistics"
        className="w-full text-right text-xs font-medium text-primary md:hidden"
      >
        {showMobileStats ? "Ẩn thống kê" : "Hiện thống kê"}
      </button>

      <div
        id="staff-advance-statistics"
        className={
          showMobileStats
            ? "grid grid-cols-2 gap-2 desktop:grid-cols-6"
            : "hidden grid-cols-2 gap-2 md:grid desktop:grid-cols-6"
        }
      >
        <StatCard
          label="Chờ duyệt"
          value={statValue(stats.pending)}
          icon={Clock}
          tone="warning"
          className="desktop:!p-2.5 desktop:[&>div:first-child>div:first-child]:!text-[10px] desktop:[&>div:first-child>div:last-child]:!h-6 desktop:[&>div:first-child>div:last-child]:!w-6 desktop:[&>div:first-child>div:last-child>svg]:!h-3 desktop:[&>div:first-child>div:last-child>svg]:!w-3 desktop:[&>div:nth-child(2)]:!mt-0.5 desktop:[&>div:nth-child(2)]:!text-sm desktop:[&>div:nth-child(2)>span]:!text-sm"
        />
        <StatCard
          label="Đã chuyển admin"
          value={statValue(stats.recruiter_approved)}
          icon={Check}
          tone="primary"
          className="desktop:!p-2.5 desktop:[&>div:first-child>div:first-child]:!text-[10px] desktop:[&>div:first-child>div:last-child]:!h-6 desktop:[&>div:first-child>div:last-child]:!w-6 desktop:[&>div:first-child>div:last-child>svg]:!h-3 desktop:[&>div:first-child>div:last-child>svg]:!w-3 desktop:[&>div:nth-child(2)]:!mt-0.5 desktop:[&>div:nth-child(2)]:!text-sm desktop:[&>div:nth-child(2)>span]:!text-sm"
        />
        <StatCard
          label="Đã duyệt"
          value={statValue(stats.accepted)}
          icon={Check}
          tone="success"
          className="desktop:!p-2.5 desktop:[&>div:first-child>div:first-child]:!text-[10px] desktop:[&>div:first-child>div:last-child]:!h-6 desktop:[&>div:first-child>div:last-child]:!w-6 desktop:[&>div:first-child>div:last-child>svg]:!h-3 desktop:[&>div:first-child>div:last-child>svg]:!w-3 desktop:[&>div:nth-child(2)]:!mt-0.5 desktop:[&>div:nth-child(2)]:!text-sm desktop:[&>div:nth-child(2)>span]:!text-sm"
        />
        <StatCard
          label="Từ chối"
          value={statValue(stats.rejected)}
          icon={X}
          tone="danger"
          className="desktop:!p-2.5 desktop:[&>div:first-child>div:first-child]:!text-[10px] desktop:[&>div:first-child>div:last-child]:!h-6 desktop:[&>div:first-child>div:last-child]:!w-6 desktop:[&>div:first-child>div:last-child>svg]:!h-3 desktop:[&>div:first-child>div:last-child>svg]:!w-3 desktop:[&>div:nth-child(2)]:!mt-0.5 desktop:[&>div:nth-child(2)]:!text-sm desktop:[&>div:nth-child(2)>span]:!text-sm"
        />
        <StatCard
          label="Tổng đơn"
          value={statValue(stats.all)}
          icon={Wallet}
          tone="primary"
          className="desktop:!p-2.5 desktop:[&>div:first-child>div:first-child]:!text-[10px] desktop:[&>div:first-child>div:last-child]:!h-6 desktop:[&>div:first-child>div:last-child]:!w-6 desktop:[&>div:first-child>div:last-child>svg]:!h-3 desktop:[&>div:first-child>div:last-child>svg]:!w-3 desktop:[&>div:nth-child(2)]:!mt-0.5 desktop:[&>div:nth-child(2)]:!text-sm desktop:[&>div:nth-child(2)>span]:!text-sm"
        />
        {isStaff && !isAdmin && (
          <button
            type="button"
            className="col-span-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 desktop:col-span-1"
            onClick={() => {
              setStatisticsTab("outstanding");
              setShowOutstandingStats(true);
            }}
            aria-label="Mở thống kê báo ứng"
          >
            <StatCard
              label="Thống kê báo ứng"
              value={
                <span className="block text-[15px] leading-tight sm:text-base">
                  {loadingOutstandingStats
                    ? "Đang tải..."
                    : `${outstandingWorkers.length} NLĐ - ${formatMoney(outstandingTotal)}đ`}
                </span>
              }
              hint="Bấm để xem tồn ứng, lịch sử và biểu đồ 7 ngày"
              icon={CircleDollarSign}
              tone="warning"
              className="h-full transition hover:border-primary/50 hover:shadow-soft desktop:!p-2.5 desktop:[&>div:first-child>div:first-child]:!text-[10px] desktop:[&>div:first-child>div:last-child]:!h-6 desktop:[&>div:first-child>div:last-child]:!w-6 desktop:[&>div:first-child>div:last-child>svg]:!h-3 desktop:[&>div:first-child>div:last-child>svg]:!w-3 desktop:[&>div:nth-child(2)]:!mt-0.5 desktop:[&>div:nth-child(2)]:!text-sm desktop:[&>div:nth-child(2)>span]:!text-sm"
            />
          </button>
        )}
      </div>

      <FilterBar
        desktopSearchAfterChips
        search={search}
        onSearchChange={setSearch}
        placeholder="Tìm theo tên, mã NV…"
        chips={[
          { key: "pending", label: `Chờ duyệt (${stats.pending.count})` },
          {
            key: "recruiter_approved",
            label: `Đã chuyển admin (${stats.recruiter_approved.count})`,
          },
          { key: "accepted", label: `Đã duyệt (${stats.accepted.count})` },
          { key: "rejected", label: `Từ chối (${stats.rejected.count})` },
          { key: "all", label: "Tất cả" },
        ]}
        activeChip={tab}
        onChipChange={(v) => setTab(v as AdminTab)}
      />

      {loading && items.length > 0 && (
        <DataLoadingState variant="inline" label="Đang cập nhật danh sách ứng lương..." />
      )}
      {loading && items.length === 0 ? (
        <DataLoadingState variant="list" label="Đang tải danh sách ứng lương..." rows={3} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="Không có đơn ứng lương"
          description="Đơn ứng của NLĐ bạn tuyển sẽ hiển thị tại đây."
        />
      ) : (
        items.map((row) => {
          const status = (row.status || "pending") as AdvanceStatus;
          const payoutMethod = normalizeAdvancePayoutMethod(row.payout_method);
          return (
            <div
              key={row.id}
              className={cn(
                "list-card cursor-pointer px-3 py-2",
                toneBorder[STATUS_META[status].tone] || "",
              )}
              role="button"
              tabIndex={0}
              onClick={() => setAdvanceDetail(row)}
              onKeyDown={(event) => {
                if (event.currentTarget !== event.target) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setAdvanceDetail(row);
                }
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">
                    {row.employee_code || "-"} - {row.full_name || "-"}
                  </div>
                  <div className="text-sm font-bold text-primary">{formatMoney(row.amount)}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {new Date(row.created).toLocaleString("vi-VN")}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <StatusChip tone={STATUS_META[status].tone as ChipTone}>
                    {STATUS_META[status].label}
                  </StatusChip>
                  <StatusChip tone={payoutMethod === "cash" ? "warning" : "neutral"}>
                    {PAYOUT_METHOD_META[payoutMethod].label}
                  </StatusChip>
                  {status === "pending" && interactionAllowed && (
                    <div className="flex gap-1">
                      <Button
                        size="icon"
                        className="h-7 w-7"
                        title="Chấp nhận"
                        onClick={(e) => {
                          e.stopPropagation();
                          staffResolve(row, "recruiter_approved");
                        }}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="destructive"
                        className="h-7 w-7"
                        title="Từ chối"
                        onClick={(e) => {
                          e.stopPropagation();
                          staffResolve(row, "rejected");
                        }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                  {interactionAllowed &&
                    status === "recruiter_approved" &&
                    row.recruiter_id === user?.id && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 px-2 text-amber-700"
                        onClick={(event) => {
                          event.stopPropagation();
                          setWithdrawTarget(row);
                        }}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Thu hồi
                      </Button>
                    )}
                </div>
              </div>
              <p className="mt-1 truncate text-[12px] text-muted-foreground">{row.reason}</p>
            </div>
          );
        })
      )}

      {isStaff && !isAdmin && (
        <>
          <OutstandingWorkersDialog
            open={showOutstandingStats}
            tab={statisticsTab}
            onTabChange={setStatisticsTab}
            workers={outstandingWorkers}
            totalAmount={outstandingTotal}
            history={advanceHistory}
            days={advanceDaySummaries}
            loading={loadingOutstandingStats}
            onClose={() => {
              setShowOutstandingStats(false);
              setSelectedOutstandingWorkerId(null);
              setSelectedAdvanceDate(null);
            }}
            onSelectWorker={(workerId) => setSelectedOutstandingWorkerId(workerId)}
            onSelectDay={(dayKey) => setSelectedAdvanceDate(dayKey)}
          />
          <OutstandingWorkerDetailDialog
            worker={selectedOutstandingWorker}
            onClose={() => setSelectedOutstandingWorkerId(null)}
          />
          <AdvanceDateDetailDialog
            day={selectedAdvanceDay}
            onClose={() => setSelectedAdvanceDate(null)}
          />
        </>
      )}
      <AdvanceQuickDetail
        detail={advanceDetail}
        onClose={() => setAdvanceDetail(null)}
        canWithdraw={
          interactionAllowed &&
          advanceDetail?.status === "recruiter_approved" &&
          advanceDetail.recruiter_id === user?.id
        }
        onWithdraw={(advance) => {
          setAdvanceDetail(null);
          setWithdrawTarget(advance);
        }}
      />
      <WithdrawAdvanceDialog
        advance={withdrawTarget}
        withdrawing={withdrawing}
        interactionAllowed={interactionAllowed}
        onClose={() => !withdrawing && setWithdrawTarget(null)}
        onConfirm={withdrawAdvance}
      />
      <Button
        className="fixed bottom-20 right-4 z-30 h-12 w-12 rounded-full shadow-lg"
        disabled={!interactionAllowed}
        onClick={() => setShowCreateForm(true)}
        aria-label="Tạo ứng lương cho NLĐ"
        title="Tạo ứng lương cho NLĐ"
      >
        <Plus className="h-5 w-5" />
      </Button>
      <WorkerAdvanceCreateDialog
        open={showCreateForm}
        onOpenChange={(open) => {
          if (creatingAdvance) return;
          setShowCreateForm(open);
          if (!open) resetCreateForm();
        }}
        workers={filteredWorkers}
        loadingWorkers={loadingWorkers}
        search={workerSearch}
        setSearch={setWorkerSearch}
        selectedWorker={selectedWorker}
        selectWorker={(workerId) => {
          setSelectedWorkerId(workerId);
          setWorkerSearch("");
          setBankChoice("worker");
        }}
        payoutMethod={workerPayoutMethod}
        setPayoutMethod={setWorkerPayoutMethod}
        bankChoice={bankChoice}
        setBankChoice={setBankChoice}
        amountText={workerAmountText}
        setAmountText={setWorkerAmountText}
        reason={workerReason}
        setReason={setWorkerReason}
        limit={workerLimit}
        outstanding={workerOutstanding}
        available={workerAvailable}
        factoryName={workerPolicy?.factoryName || ""}
        policyError={workerPolicyError}
        loadingOutstanding={loadingWorkerPolicy}
        submitting={creatingAdvance}
        interactionAllowed={interactionAllowed}
        onSubmit={createWorkerAdvance}
      />
    </>
  );
}

function OutstandingWorkersDialog({
  open,
  tab,
  onTabChange,
  workers,
  totalAmount,
  history,
  days,
  loading,
  onClose,
  onSelectWorker,
  onSelectDay,
}: {
  open: boolean;
  tab: "outstanding" | "history" | "chart";
  onTabChange: (value: "outstanding" | "history" | "chart") => void;
  workers: OutstandingWorkerSummary[];
  totalAmount: number;
  history: OutstandingAdvance[];
  days: AdvanceDaySummary[];
  loading: boolean;
  onClose: () => void;
  onSelectWorker: (workerId: string) => void;
  onSelectDay: (dayKey: string) => void;
}) {
  const totalAdvances = workers.reduce((sum, worker) => sum + worker.count, 0);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        layout="raw"
        className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
      >
        <DialogHeader className="shrink-0 border-b border-border/60 p-5 pr-14 text-left">
          <DialogTitle>Thống kê báo ứng</DialogTitle>
          <DialogDescription>Thông tin báo ứng của NLĐ do bạn phụ trách.</DialogDescription>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-muted/50 p-2">
              <div className="text-lg font-semibold">{workers.length}</div>
              <div className="text-[11px] text-muted-foreground">NLĐ</div>
            </div>
            <div className="rounded-xl bg-muted/50 p-2">
              <div className="text-lg font-semibold">{totalAdvances}</div>
              <div className="text-[11px] text-muted-foreground">Lần ứng</div>
            </div>
            <div className="rounded-xl bg-warning/10 p-2 text-warning-foreground">
              <div className="text-lg font-semibold">{formatMoney(totalAmount)}đ</div>
              <div className="text-[11px]">Tổng tiền</div>
            </div>
          </div>
        </DialogHeader>
        <Tabs
          value={tab}
          onValueChange={(value) => onTabChange(value as "outstanding" | "history" | "chart")}
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabsList className="mx-4 mt-3 grid h-auto shrink-0 grid-cols-3 gap-1 p-1 sm:mx-5">
            <TabsTrigger
              value="outstanding"
              className="h-auto min-h-9 whitespace-normal px-2 py-2 text-xs leading-tight"
            >
              Tồn ứng chưa thu
            </TabsTrigger>
            <TabsTrigger
              value="history"
              className="h-auto min-h-9 whitespace-normal px-2 py-2 text-xs leading-tight"
            >
              Lịch sử ứng chi tiết
            </TabsTrigger>
            <TabsTrigger
              value="chart"
              className="h-auto min-h-9 whitespace-normal px-2 py-2 text-xs leading-tight"
            >
              Biểu đồ báo ứng 7 ngày
            </TabsTrigger>
          </TabsList>
          <TabsContent
            value="outstanding"
            className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 pb-5"
          >
            {loading ? (
              <DataLoadingState variant="list" label="Đang tải thống kê ứng lương..." rows={3} />
            ) : workers.length === 0 ? (
              <EmptyState
                icon={CircleDollarSign}
                title="Không có NLĐ tồn ứng"
                description="Hiện chưa có khoản ứng nào đang chờ thu hồi."
              />
            ) : (
              workers.map((worker, index) => (
                <div
                  key={worker.workerId}
                  className="rounded-2xl border border-border/60 bg-card p-3 shadow-soft"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">
                        {index + 1}. {worker.fullName}
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {worker.employeeCode || "Chưa có mã NV"} ·{" "}
                        {worker.company || "Chưa có nhà máy"}
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {worker.count} lần ứng chưa thu
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onSelectWorker(worker.workerId)}
                      className="flex shrink-0 items-center gap-1 rounded-xl border border-primary/30 bg-primary/5 px-2.5 py-2 text-right text-primary transition hover:bg-primary/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      aria-label={`Xem chi tiết tồn ứng của ${worker.fullName}`}
                    >
                      <span>
                        <span className="block text-sm font-bold">
                          {formatMoney(worker.total)}đ
                        </span>
                        <span className="block text-[10px] font-medium">Xem chi tiết</span>
                      </span>
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </TabsContent>
          <TabsContent value="history" className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
            {loading ? (
              <DataLoadingState variant="list" label="Đang tải lịch sử ứng lương..." rows={3} />
            ) : history.length === 0 ? (
              <EmptyState
                icon={Wallet}
                title="Chưa có lịch sử báo ứng"
                description="Các lần Staff báo ứng cho NLĐ sẽ hiển thị tại đây."
              />
            ) : (
              <div className="space-y-2">
                {history.map((advance, index) => (
                  <AdvanceHistoryCard key={advance.id} advance={advance} index={index} />
                ))}
              </div>
            )}
          </TabsContent>
          <TabsContent value="chart" className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
            {loading ? (
              <DataLoadingState variant="grid" label="Đang tải biểu đồ ứng lương..." rows={2} />
            ) : (
              <AdvanceSevenDayChart days={days} onSelectDay={onSelectDay} />
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function AdvanceHistoryCard({ advance, index }: { advance: OutstandingAdvance; index: number }) {
  const meta = advanceStatisticsStatusMeta(advance);
  const notes = [
    advance.recruiter_note && `Ghi chú người tuyển: ${advance.recruiter_note}`,
    advance.admin_note && `Ghi chú admin: ${advance.admin_note}`,
    advance.recovery_note && `Ghi chú thu hồi: ${advance.recovery_note}`,
  ].filter(Boolean);

  return (
    <div className={cn("rounded-2xl border bg-card p-3", toneBorder[meta.tone])}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold">
            {index + 1}. {advance.full_name || "Chưa có tên"}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {advance.employee_code || "Chưa có mã NV"} · {advance.company || "Chưa có nhà máy"}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {advance.created
              ? new Date(advance.created).toLocaleString("vi-VN")
              : "Chưa có thời gian"}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-base font-bold text-primary">{formatMoney(advance.amount)}đ</div>
          <StatusChip tone={meta.tone}>{meta.label}</StatusChip>
        </div>
      </div>
      <div className="mt-2 space-y-1 text-[12px]">
        <div>
          <span className="font-semibold">Lý do:</span> {advance.reason || "Không có lý do"}
        </div>
        <div className="text-muted-foreground">
          <span className="font-semibold">Người yêu cầu:</span>{" "}
          {getOutstandingRequesterName(advance)}
        </div>
        {notes.map((note) => (
          <div key={note} className="rounded-lg bg-muted/60 p-2 text-muted-foreground">
            {note}
          </div>
        ))}
      </div>
    </div>
  );
}

function AdvanceSevenDayTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: AdvanceDaySummary }>;
}) {
  const day = payload?.[0]?.payload;
  if (!active || !day) return null;

  return (
    <div className="min-w-36 rounded-lg border border-border/50 bg-background px-3 py-2 text-xs shadow-xl">
      <div className="font-semibold">{day.label}</div>
      <div className="mt-1 flex justify-between gap-4 text-muted-foreground">
        <span>Số lần ứng</span>
        <span className="font-medium text-foreground">{day.count}</span>
      </div>
      <div className="mt-1 flex justify-between gap-4 text-muted-foreground">
        <span>Tổng tiền</span>
        <span className="font-medium text-foreground">{formatMoney(day.total)}đ</span>
      </div>
    </div>
  );
}

function AdvanceSevenDayChart({
  days,
  onSelectDay,
}: {
  days: AdvanceDaySummary[];
  onSelectDay: (dayKey: string) => void;
}) {
  const hasAdvances = days.some((day) => day.count > 0);

  return (
    <div className="space-y-4 pt-3">
      <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
        <BarChart3 className="h-4 w-4 shrink-0 text-primary" />
        <span>Bấm vào cột hoặc ngày để xem các lần báo ứng, theo thứ tự mới nhất trước.</span>
      </div>

      <ChartContainer config={advanceSevenDayChartConfig} className="h-[240px] w-full">
        <BarChart data={days} margin={{ top: 16, right: 4, bottom: 0, left: -14 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={28}
          />
          <ChartTooltip content={<AdvanceSevenDayTooltip />} />
          <Bar
            dataKey="count"
            name="Số lần ứng"
            fill="var(--color-count)"
            radius={[5, 5, 0, 0]}
            cursor="pointer"
            onClick={(_: unknown, index: number) => {
              const day = days[index];
              if (day) onSelectDay(day.key);
            }}
          />
        </BarChart>
      </ChartContainer>

      {!hasAdvances ? (
        <p className="text-center text-sm text-muted-foreground">
          Chưa có lần báo ứng nào trong 7 ngày gần nhất.
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {days.map((day) => (
          <button
            key={day.key}
            type="button"
            onClick={() => onSelectDay(day.key)}
            className="rounded-xl border border-border/60 bg-card p-2.5 text-left transition hover:border-primary/50 hover:bg-primary/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label={`Xem báo ứng ngày ${day.label}`}
          >
            <div className="truncate text-xs font-semibold">{day.label}</div>
            <div className="mt-1 text-lg font-bold text-primary">{day.count}</div>
            <div className="truncate text-[11px] text-muted-foreground">
              {formatMoney(day.total)}đ
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function AdvanceDateDetailDialog({
  day,
  onClose,
}: {
  day: AdvanceDaySummary | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!day} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        layout="raw"
        className="flex max-h-[88dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
      >
        <DialogHeader className="shrink-0 border-b border-border/60 p-5 pr-14 text-left">
          <DialogTitle>Danh sách ứng – {day?.label || ""}</DialogTitle>
          <DialogDescription>
            Các lần báo ứng trong ngày, mới nhất hiển thị trước.
          </DialogDescription>
          {day ? (
            <div className="mt-3 rounded-xl bg-primary/5 p-3 text-sm text-primary">
              <span className="font-semibold">{day.count} lần ứng</span> · Tổng cộng{" "}
              {formatMoney(day.total)}đ
            </div>
          ) : null}
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto p-5">
          {day?.advances.length ? (
            <div className="space-y-2">
              {day.advances.map((advance, index) => (
                <AdvanceHistoryCard key={advance.id} advance={advance} index={index} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Wallet}
              title="Không có lần báo ứng"
              description="Ngày này chưa phát sinh báo ứng nào."
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function OutstandingWorkerDetailDialog({
  worker,
  onClose,
}: {
  worker: OutstandingWorkerSummary | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!worker} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        layout="raw"
        className="flex max-h-[88dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
      >
        <DialogHeader className="shrink-0 border-b border-border/60 p-5 pr-14 text-left">
          <DialogTitle>Chi tiết tồn ứng – {worker?.fullName || "NLĐ"}</DialogTitle>
          <DialogDescription>
            {worker?.employeeCode || "Chưa có mã NV"} · {worker?.company || "Chưa có nhà máy"}
          </DialogDescription>
          {worker && (
            <div className="mt-3 rounded-xl bg-warning/10 p-3 text-sm text-warning-foreground">
              <span className="font-semibold">{worker.count} lần ứng</span> · Tổng cộng{" "}
              {formatMoney(worker.total)}đ chưa thu
            </div>
          )}
        </DialogHeader>
        <div className="min-h-0 space-y-2 overflow-y-auto p-5">
          {worker?.advances.map((advance, index) => {
            const meta = outstandingStatusMeta(advance);
            const notes = [
              advance.recruiter_note && `Ghi chú người tuyển: ${advance.recruiter_note}`,
              advance.admin_note && `Ghi chú admin: ${advance.admin_note}`,
              advance.recovery_note && `Ghi chú thu hồi: ${advance.recovery_note}`,
            ].filter(Boolean);
            return (
              <div
                key={advance.id}
                className={cn("rounded-2xl border bg-card p-3", toneBorder[meta.tone])}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">
                      Lần ứng #{worker.advances.length - index}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {advance.created
                        ? new Date(advance.created).toLocaleString("vi-VN")
                        : "Chưa có thời gian"}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-base font-bold text-primary">
                      {formatMoney(advance.amount)}đ
                    </div>
                    <StatusChip tone={meta.tone}>{meta.label}</StatusChip>
                  </div>
                </div>
                <div className="mt-2 space-y-1 text-[12px]">
                  <div>
                    <span className="font-semibold">Lý do:</span>{" "}
                    {advance.reason || "Không có lý do"}
                  </div>
                  <div className="text-muted-foreground">
                    <span className="font-semibold">Người yêu cầu:</span>{" "}
                    {getOutstandingRequesterName(advance)}
                  </div>
                  {notes.map((note) => (
                    <div key={note} className="rounded-lg bg-muted/60 p-2 text-muted-foreground">
                      {note}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// PLACEHOLDER_MY_ADVANCES

function MyAdvancesView({ interactionAllowed }: { interactionAllowed: boolean }) {
  const { user } = useAuth();
  const [items, setItems] = useState<AdvanceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [sending, setSending] = useState(false);
  const [amountText, setAmountText] = useState("");
  const [reason, setReason] = useState("");
  const [payoutMethod, setPayoutMethod] = useState<AdvancePayoutMethod>("bank_transfer");
  const [bankForm, setBankForm] = useState({
    bank_name: "",
    bank_account_number: "",
    bank_account_name: "",
  });
  const [adminList, setAdminList] = useState<UserRecord[]>([]);
  const [selectedAdmins, setSelectedAdmins] = useState<string[]>([]);
  const [withdrawTarget, setWithdrawTarget] = useState<AdvanceRecord | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [showMobileStats, setShowMobileStats] = useState(false);
  const userId = user?.id;
  const bankName = user?.bank_name || "";
  const bankAccountNumber = user?.bank_account_number || "";
  const bankAccountName = user?.bank_account_name || "";

  useEffect(() => {
    if (!userId) return;
    setBankForm({
      bank_name: resolveBankName(bankName),
      bank_account_number: bankAccountNumber,
      bank_account_name: bankAccountName,
    });
  }, [bankAccountName, bankAccountNumber, bankName, userId]);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const filter = buildAdvanceFilter({
        isAdmin: false,
        isStaff: false,
        userId: user.id,
        staffSelfOnly: true,
      });
      const res = await pb.collection("advances").getList(1, 300, {
        filter,
        sort: "-created",
      });
      setItems(res.items as unknown as AdvanceRecord[]);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Lỗi tải danh sách ứng"));
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!showForm) return;
    pb.collection("users")
      .getFullList<UserRecord>({
        filter: `${companyFilter(user)} && role="admin"`,
        sort: "full_name",
      })
      .then(setAdminList)
      .catch(() => {});
  }, [showForm]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseMoneyInput(amountText);
    if (!amount) return toast.error("Số tiền không được để trống");
    if (!reason.trim()) return toast.error("Lý do không được để trống");
    if (!selectedAdmins.length) return toast.error("Vui lòng chọn ít nhất 1 admin duyệt");

    setSending(true);
    try {
      await assertAdvanceInteractionAllowed(user?.role);
      const created = await pb.collection("advances").create({
        ...companyPayload(user),
        requested_by: user!.id,
        recruiter_id: "",
        full_name: user!.full_name || "",
        employee_code: "",
        company: "",
        phone: user!.phone || "",
        bank_name: payoutMethod === "cash" ? "" : bankForm.bank_name,
        bank_account_number: payoutMethod === "cash" ? "" : bankForm.bank_account_number,
        bank_account_name: payoutMethod === "cash" ? "" : bankForm.bank_account_name,
        payout_method: payoutMethod,
        amount,
        reason: reason.trim(),
        status: "recruiter_approved",
        recovery_status: "none",
        target_admins: selectedAdmins,
      });
      await createStaffActionLog({
        actor: user,
        targetUserId: user!.id,
        targetCollection: "advances",
        targetRecord: created.id,
        action: "report_advance",
        after: created,
        note: "Staff tự báo ứng",
      });
      toast.success("Đã gửi yêu cầu ứng lương");
      setAmountText("");
      setReason("");
      setPayoutMethod("bank_transfer");
      setSelectedAdmins([]);
      setShowForm(false);
      load();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Lỗi gửi ứng lương"));
    } finally {
      setSending(false);
    }
  };

  const withdrawAdvance = async () => {
    if (!withdrawTarget || !user?.id) return;
    setWithdrawing(true);
    try {
      await withdrawStaffAdvance(user, withdrawTarget);
      toast.success("Đã thu hồi yêu cầu ứng lương");
      setWithdrawTarget(null);
      await load();
    } catch (error: unknown) {
      toast.error(getWithdrawErrorMessage(error));
      setWithdrawTarget(null);
      await load();
    } finally {
      setWithdrawing(false);
    }
  };

  const myStats = useMemo(() => {
    const result = emptyAdvanceSummaries();
    for (const row of items) {
      const status = (row.status || "recruiter_approved") as AdminTab;
      const amount = Number(row.amount || 0);
      if (result[status]) {
        result[status].count += 1;
        result[status].total += amount;
      }
      result.all.count += 1;
      result.all.total += amount;
    }
    return result;
  }, [items]);

  return (
    <>
      <button
        type="button"
        onClick={() => setShowMobileStats((current) => !current)}
        aria-expanded={showMobileStats}
        aria-controls="staff-own-advance-statistics"
        className="w-full text-right text-xs font-medium text-primary md:hidden"
      >
        {showMobileStats ? "Ẩn thống kê" : "Hiện thống kê"}
      </button>

      <div
        id="staff-own-advance-statistics"
        className={
          showMobileStats
            ? "grid grid-cols-2 gap-2 desktop:grid-cols-6"
            : "hidden grid-cols-2 gap-2 md:grid desktop:grid-cols-6"
        }
      >
        <StatCard
          label="Chờ admin duyệt"
          value={statValue(myStats.recruiter_approved)}
          icon={Clock}
          tone="warning"
          className="desktop:!p-2.5 desktop:[&>div:first-child>div:first-child]:!text-[10px] desktop:[&>div:first-child>div:last-child]:!h-6 desktop:[&>div:first-child>div:last-child]:!w-6 desktop:[&>div:first-child>div:last-child>svg]:!h-3 desktop:[&>div:first-child>div:last-child>svg]:!w-3 desktop:[&>div:nth-child(2)]:!mt-0.5 desktop:[&>div:nth-child(2)]:!text-sm desktop:[&>div:nth-child(2)>span]:!text-sm"
        />
        <StatCard
          label="Đã tiếp nhận"
          value={statValue(myStats.accepted)}
          icon={Check}
          tone="success"
          className="desktop:!p-2.5 desktop:[&>div:first-child>div:first-child]:!text-[10px] desktop:[&>div:first-child>div:last-child]:!h-6 desktop:[&>div:first-child>div:last-child]:!w-6 desktop:[&>div:first-child>div:last-child>svg]:!h-3 desktop:[&>div:first-child>div:last-child>svg]:!w-3 desktop:[&>div:nth-child(2)]:!mt-0.5 desktop:[&>div:nth-child(2)]:!text-sm desktop:[&>div:nth-child(2)>span]:!text-sm"
        />
        <StatCard
          label="Từ chối"
          value={statValue(myStats.rejected)}
          icon={X}
          tone="danger"
          className="desktop:!p-2.5 desktop:[&>div:first-child>div:first-child]:!text-[10px] desktop:[&>div:first-child>div:last-child]:!h-6 desktop:[&>div:first-child>div:last-child]:!w-6 desktop:[&>div:first-child>div:last-child>svg]:!h-3 desktop:[&>div:first-child>div:last-child>svg]:!w-3 desktop:[&>div:nth-child(2)]:!mt-0.5 desktop:[&>div:nth-child(2)]:!text-sm desktop:[&>div:nth-child(2)>span]:!text-sm"
        />
        <StatCard
          label="Tổng đơn"
          value={statValue(myStats.all)}
          icon={Wallet}
          tone="primary"
          className="desktop:!p-2.5 desktop:[&>div:first-child>div:first-child]:!text-[10px] desktop:[&>div:first-child>div:last-child]:!h-6 desktop:[&>div:first-child>div:last-child]:!w-6 desktop:[&>div:first-child>div:last-child>svg]:!h-3 desktop:[&>div:first-child>div:last-child>svg]:!w-3 desktop:[&>div:nth-child(2)]:!mt-0.5 desktop:[&>div:nth-child(2)]:!text-sm desktop:[&>div:nth-child(2)>span]:!text-sm"
        />
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="Chưa có đơn ứng"
          description="Nhấn nút + để tạo yêu cầu ứng lương."
        />
      ) : (
        items.map((row) => {
          const status = (row.status || "recruiter_approved") as AdvanceStatus;
          const payoutMethod = normalizeAdvancePayoutMethod(row.payout_method);
          return (
            <div
              key={row.id}
              className={cn("list-card px-3 py-2", toneBorder[STATUS_META[status].tone] || "")}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-primary">{formatMoney(row.amount)}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {new Date(row.created).toLocaleString("vi-VN")}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <StatusChip tone={STATUS_META[status].tone as ChipTone}>
                    {STATUS_META[status].label}
                  </StatusChip>
                  <StatusChip tone={payoutMethod === "cash" ? "warning" : "neutral"}>
                    {PAYOUT_METHOD_META[payoutMethod].label}
                  </StatusChip>
                  {interactionAllowed &&
                    status === "recruiter_approved" &&
                    row.requested_by === user?.id && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 px-2 text-amber-700"
                        onClick={() => setWithdrawTarget(row)}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Thu hồi
                      </Button>
                    )}
                </div>
              </div>
              <p className="mt-1 truncate text-[12px] text-muted-foreground">{row.reason}</p>
            </div>
          );
        })
      )}

      <Button
        className="fixed bottom-20 right-4 z-30 h-12 w-12 rounded-full shadow-lg"
        disabled={!interactionAllowed}
        title={interactionAllowed ? "Tạo yêu cầu ứng lương" : "Đang ở chế độ chỉ xem"}
        onClick={() => {
          setPayoutMethod("bank_transfer");
          setShowForm(true);
        }}
      >
        <Plus className="h-5 w-5" />
      </Button>

      <StaffAdvanceFormDialog
        open={showForm}
        onOpenChange={setShowForm}
        amountText={amountText}
        setAmountText={setAmountText}
        reason={reason}
        setReason={setReason}
        payoutMethod={payoutMethod}
        setPayoutMethod={setPayoutMethod}
        bankForm={bankForm}
        setBankForm={setBankForm}
        adminList={adminList}
        selectedAdmins={selectedAdmins}
        setSelectedAdmins={setSelectedAdmins}
        sending={sending}
        interactionAllowed={interactionAllowed}
        onSubmit={submit}
      />
      <WithdrawAdvanceDialog
        advance={withdrawTarget}
        withdrawing={withdrawing}
        interactionAllowed={interactionAllowed}
        onClose={() => !withdrawing && setWithdrawTarget(null)}
        onConfirm={withdrawAdvance}
      />
    </>
  );
}

// PLACEHOLDER_FORM_DIALOG

function StaffAdvanceFormDialog({
  open,
  onOpenChange,
  amountText,
  setAmountText,
  reason,
  setReason,
  payoutMethod,
  setPayoutMethod,
  bankForm,
  setBankForm,
  adminList,
  selectedAdmins,
  setSelectedAdmins,
  sending,
  interactionAllowed,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  amountText: string;
  setAmountText: (v: string) => void;
  reason: string;
  setReason: (v: string) => void;
  payoutMethod: AdvancePayoutMethod;
  setPayoutMethod: (value: AdvancePayoutMethod) => void;
  bankForm: { bank_name: string; bank_account_number: string; bank_account_name: string };
  setBankForm: (v: {
    bank_name: string;
    bank_account_number: string;
    bank_account_name: string;
  }) => void;
  adminList: UserRecord[];
  selectedAdmins: string[];
  setSelectedAdmins: (v: string[]) => void;
  sending: boolean;
  interactionAllowed: boolean;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-3xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Xin ứng lương</DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          {!interactionAllowed && <AdvanceReadOnlyNotice />}
          <div className="space-y-1.5">
            <Label>Số tiền *</Label>
            <Input
              inputMode="numeric"
              value={amountText}
              onChange={(e) => setAmountText(formatMoneyInput(e.target.value))}
              placeholder="Nhập số tiền ứng"
              className="rounded-xl"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Lý do *</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Lý do xin ứng"
              className="min-h-16 rounded-xl"
            />
          </div>
          <AdvancePayoutMethodPicker value={payoutMethod} onChange={setPayoutMethod} />
          {payoutMethod === "bank_transfer" && (
            <>
              <div className="space-y-1.5">
                <Label>Ngân hàng</Label>
                <BankPicker
                  value={bankForm.bank_name}
                  onChange={(value) => setBankForm({ ...bankForm, bank_name: value })}
                  triggerClassName="rounded-xl"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label>Số tài khoản</Label>
                  <Input
                    value={bankForm.bank_account_number}
                    onChange={(e) =>
                      setBankForm({ ...bankForm, bank_account_number: e.target.value })
                    }
                    placeholder="Số TK"
                    className="rounded-xl"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Chủ tài khoản</Label>
                  <Input
                    value={bankForm.bank_account_name}
                    onChange={(e) =>
                      setBankForm({ ...bankForm, bank_account_name: e.target.value })
                    }
                    placeholder="Tên chủ TK"
                    className="rounded-xl"
                  />
                </div>
              </div>
            </>
          )}
          <div className="space-y-1.5">
            <Label>Gửi tới admin duyệt * ({selectedAdmins.length} đã chọn)</Label>
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-xl border p-2">
              {adminList.map((admin) => (
                <label
                  key={admin.id}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted/50"
                >
                  <Checkbox
                    checked={selectedAdmins.includes(admin.id)}
                    onCheckedChange={() =>
                      setSelectedAdmins(
                        selectedAdmins.includes(admin.id)
                          ? selectedAdmins.filter((a) => a !== admin.id)
                          : [...selectedAdmins, admin.id],
                      )
                    }
                  />
                  <span>{admin.full_name || admin.username || admin.email}</span>
                </label>
              ))}
              {!adminList.length && (
                <div className="py-2 text-center text-xs text-muted-foreground">
                  Không tìm thấy admin
                </div>
              )}
            </div>
          </div>
          <Button
            type="submit"
            disabled={sending || !interactionAllowed}
            className="w-full gap-2 rounded-xl"
          >
            <Send className="h-4 w-4" />
            {sending ? "Đang gửi…" : "Gửi yêu cầu"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AdvanceQuickDetail({
  detail,
  onClose,
  canWithdraw = false,
  onWithdraw,
}: {
  detail: AdvanceRecord | null;
  onClose: () => void;
  canWithdraw?: boolean;
  onWithdraw?: (advance: AdvanceRecord) => void;
}) {
  if (!detail) return null;
  const status = (detail.status || "pending") as AdvanceStatus;
  const payoutMethod = normalizeAdvancePayoutMethod(detail.payout_method);

  return (
    <Dialog open={!!detail} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Chi tiết ứng lương</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-xl border bg-muted/30 p-3">
            <div className="text-sm font-semibold">{detail.full_name || "-"}</div>
            <div className="text-[11px] text-muted-foreground">
              {[detail.employee_code, detail.company].filter(Boolean).join(" - ") || "-"}
            </div>
            <div className="mt-2 text-2xl font-bold text-primary">{formatMoney(detail.amount)}</div>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <DetailCell label="Trạng thái" value={STATUS_META[status].label} />
            <DetailCell
              label="Ngày gửi"
              value={new Date(detail.created).toLocaleDateString("vi-VN")}
            />
            <DetailCell label="Hình thức nhận" value={PAYOUT_METHOD_META[payoutMethod].label} />
            {payoutMethod === "bank_transfer" && (
              <>
                <DetailCell label="Ngân hàng" value={detail.bank_name} />
                <DetailCell label="Số TK" value={detail.bank_account_number} />
              </>
            )}
          </div>
          <div className="rounded-xl border bg-card p-3 text-sm">
            <div className="text-[10px] text-muted-foreground">Lý do</div>
            <div className="mt-0.5 whitespace-pre-wrap text-xs">{detail.reason || "-"}</div>
          </div>
          {detail.admin_note && (
            <div className="rounded-xl border bg-card p-3 text-sm">
              <div className="text-[10px] text-muted-foreground">Ghi chú admin</div>
              <div className="mt-0.5 whitespace-pre-wrap text-xs">{detail.admin_note}</div>
            </div>
          )}
          {canWithdraw && onWithdraw && (
            <Button
              type="button"
              variant="destructive"
              className="w-full"
              onClick={() => onWithdraw(detail)}
            >
              <RotateCcw className="h-4 w-4" />
              Thu hồi yêu cầu
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DetailCell({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="rounded-lg bg-muted/40 px-2.5 py-1.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="break-words text-xs font-medium">{value || "-"}</div>
    </div>
  );
}

function WorkerAdvanceCreateDialog({
  open,
  onOpenChange,
  workers,
  loadingWorkers,
  search,
  setSearch,
  selectedWorker,
  selectWorker,
  payoutMethod,
  setPayoutMethod,
  bankChoice,
  setBankChoice,
  amountText,
  setAmountText,
  reason,
  setReason,
  limit,
  outstanding,
  available,
  factoryName,
  policyError,
  loadingOutstanding,
  submitting,
  interactionAllowed,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workers: StaffWorkerRecord[];
  loadingWorkers: boolean;
  search: string;
  setSearch: (value: string) => void;
  selectedWorker: StaffWorkerRecord | null;
  selectWorker: (workerId: string) => void;
  payoutMethod: AdvancePayoutMethod;
  setPayoutMethod: (value: AdvancePayoutMethod) => void;
  bankChoice: "worker" | "staff";
  setBankChoice: (value: "worker" | "staff") => void;
  amountText: string;
  setAmountText: (value: string) => void;
  reason: string;
  setReason: (value: string) => void;
  limit: number;
  outstanding: number;
  available: number;
  factoryName: string;
  policyError: string;
  loadingOutstanding: boolean;
  submitting: boolean;
  interactionAllowed: boolean;
  onSubmit: (event: React.FormEvent) => void;
}) {
  const activeHistory = selectedWorker ? getAdvanceHistory(selectedWorker, true) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Tạo ứng lương cho NLĐ</DialogTitle>
          <DialogDescription>
            Chọn người lao động đang làm và gửi yêu cầu trực tiếp tới admin.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-3">
          {!interactionAllowed && <AdvanceReadOnlyNotice />}
          <div className="space-y-2">
            <Label>Người lao động *</Label>
            {selectedWorker ? (
              <div className="rounded-xl border bg-muted/30 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">
                      {selectedWorker.user.full_name || selectedWorker.user.username || "NLĐ"}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {[activeHistory?.employee_code, activeHistory?.expand?.factory?.name]
                        .filter(Boolean)
                        .join(" · ") || "Chưa có thông tin nhà máy"}
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => selectWorker("")}
                  >
                    Đổi NLĐ
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Tìm tên, mã NV, nhà máy, SĐT..."
                    className="rounded-xl pl-9"
                  />
                </div>
                <div className="max-h-52 space-y-1 overflow-y-auto rounded-xl border p-1.5">
                  {loadingWorkers ? (
                    <div className="p-3">
                      <DataLoadingState variant="inline" label="Đang tải danh sách NLĐ..." />
                    </div>
                  ) : workers.length === 0 ? (
                    <div className="py-6 text-center text-xs text-muted-foreground">
                      Không tìm thấy NLĐ đang làm mà bạn có quyền báo ứng.
                    </div>
                  ) : (
                    workers.map((worker) => {
                      const history = getAdvanceHistory(worker, true);
                      return (
                        <button
                          key={worker.user.id}
                          type="button"
                          onClick={() => selectWorker(worker.user.id)}
                          className="w-full rounded-lg px-2.5 py-2 text-left transition hover:bg-muted"
                        >
                          <div className="truncate text-sm font-medium">
                            {worker.user.full_name || worker.user.username || "NLĐ"}
                          </div>
                          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            {[
                              history?.employee_code,
                              history?.expand?.factory?.name,
                              worker.user.phone,
                            ]
                              .filter(Boolean)
                              .join(" · ") || "Chưa có thông tin"}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </div>

          {selectedWorker && (
            <>
              {policyError && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  {policyError}
                </div>
              )}
              {factoryName && (
                <div className="rounded-xl border bg-primary/5 p-3 text-xs">
                  <span className="text-muted-foreground">Nhà máy áp dụng: </span>
                  <span className="font-semibold">{factoryName}</span>
                </div>
              )}
              <div className="grid grid-cols-3 gap-1.5">
                <DetailCell
                  label="Hạn mức"
                  value={limit > 0 ? `${formatMoney(limit)}đ` : "Chưa cài"}
                />
                <DetailCell
                  label="Chưa thu hồi"
                  value={loadingOutstanding ? "Đang tải..." : `${formatMoney(outstanding)}đ`}
                />
                <DetailCell
                  label="Còn có thể ứng"
                  value={limit > 0 ? `${formatMoney(available)}đ` : "—"}
                />
              </div>

              <AdvancePayoutMethodPicker value={payoutMethod} onChange={setPayoutMethod} />

              {payoutMethod === "bank_transfer" && (
                <div className="space-y-2">
                  <Label>Tài khoản nhận tiền *</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setBankChoice("worker")}
                      className={cn(
                        "rounded-xl border p-2.5 text-left",
                        bankChoice === "worker"
                          ? "border-primary bg-primary/5"
                          : "border-border bg-card",
                      )}
                    >
                      <div className="text-xs font-semibold">Tài khoản NLĐ</div>
                      <div className="mt-1 truncate text-[11px] text-muted-foreground">
                        {selectedWorker.user.bank_account_number
                          ? `${selectedWorker.user.bank_name || "NH"} · ${selectedWorker.user.bank_account_number}`
                          : "Chưa có tài khoản"}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setBankChoice("staff")}
                      className={cn(
                        "rounded-xl border p-2.5 text-left",
                        bankChoice === "staff"
                          ? "border-primary bg-primary/5"
                          : "border-border bg-card",
                      )}
                    >
                      <div className="flex items-center gap-1 text-xs font-semibold">
                        <Landmark className="h-3.5 w-3.5" />
                        Tài khoản staff
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        Dùng tài khoản ngân hàng của bạn
                      </div>
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <Label>Số tiền ứng *</Label>
                <Input
                  value={amountText}
                  onChange={(event) => setAmountText(formatMoneyInput(event.target.value))}
                  inputMode="numeric"
                  placeholder="Nhập số tiền ứng"
                  className="rounded-xl"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Lý do ứng *</Label>
                <Textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Nhập lý do ứng lương"
                  className="min-h-20 rounded-xl"
                />
              </div>

              <Button
                type="submit"
                className="w-full rounded-xl"
                disabled={
                  submitting ||
                  loadingOutstanding ||
                  Boolean(policyError) ||
                  !factoryName ||
                  !interactionAllowed
                }
              >
                <Send className="h-4 w-4" />
                {submitting ? "Đang gửi..." : "Gửi yêu cầu tới admin"}
              </Button>
            </>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}

function getActiveWorkerHistory(worker: StaffWorkerRecord) {
  return worker.histories.find((history) => isCurrentlyWorking(history)) || null;
}

function getAdvanceHistory(worker: StaffWorkerRecord, allowAfterLeave: boolean) {
  return allowAfterLeave ? worker.latestHistory : getActiveWorkerHistory(worker);
}

function removeVietnameseTone(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

async function withdrawStaffAdvance(user: UserRecord, advance: AdvanceRecord) {
  await assertAdvanceInteractionAllowed(user.role);
  const current = (await pb.collection("advances").getOne(advance.id)) as unknown as AdvanceRecord;
  const ownedByStaff = current.requested_by === user.id || current.recruiter_id === user.id;

  if (current.status !== "recruiter_approved" || !ownedByStaff) {
    throw new Error("ADVANCE_NOT_WITHDRAWABLE");
  }

  await createStaffActionLog({
    actor: user,
    targetUserId: current.worker,
    targetCollection: "advances",
    targetRecord: current.id,
    action: "delete",
    before: current,
    note: "Staff thu hồi yêu cầu ứng lương trước khi admin phê duyệt",
  });
  await pb.collection("advances").delete(current.id);
}

function getWithdrawErrorMessage(error: unknown) {
  if (error instanceof Error && error.message === "ADVANCE_NOT_WITHDRAWABLE") {
    return "Admin đã xử lý hoặc bạn không còn quyền thu hồi đơn này";
  }
  const status = (error as { status?: number })?.status;
  if (status === 404 || status === 403) {
    return "Admin đã xử lý hoặc đơn không còn khả dụng";
  }
  return (error as { message?: string })?.message || "Không thể thu hồi yêu cầu ứng lương";
}

function WithdrawAdvanceDialog({
  advance,
  withdrawing,
  interactionAllowed,
  onClose,
  onConfirm,
}: {
  advance: AdvanceRecord | null;
  withdrawing: boolean;
  interactionAllowed: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={!!advance} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="rounded-2xl sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Thu hồi yêu cầu ứng lương?</DialogTitle>
          <DialogDescription>
            Yêu cầu sẽ không còn hiển thị cho admin và không thể khôi phục.
          </DialogDescription>
        </DialogHeader>

        {!interactionAllowed && <AdvanceReadOnlyNotice />}
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-950">
          <div className="text-sm font-semibold">{advance?.full_name || "Staff"}</div>
          <div className="mt-1 text-xl font-bold">{formatMoney(Number(advance?.amount || 0))}đ</div>
          <div className="mt-1 text-xs text-amber-800">
            Lịch sử thao tác vẫn được lưu để đối soát.
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={withdrawing} onClick={onClose}>
            Giữ yêu cầu
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={withdrawing || !interactionAllowed}
            onClick={onConfirm}
          >
            <RotateCcw className="h-4 w-4" />
            {withdrawing ? "Đang thu hồi…" : "Xác nhận thu hồi"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
