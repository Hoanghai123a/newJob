import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { pb, type UserRecord } from "@/lib/pocketbase";
import { useAuth } from "@/lib/auth";
import { companyPayload, joinTenantFilters } from "@/lib/tenant";
import { useDebouncedSearch } from "@/hooks/use-debounced-search";
import { useAppSettings, type AppSettings } from "@/lib/app-settings";
import {
  type AdvanceRecord,
  type AdvanceStatus,
  type RecoveryStatus,
  type AdminTab,
  type AdminAdvanceSegment,
  type AdvancePayoutMethod,
  ADVANCE_TAB_FILTERS,
  LEGACY_STAFF_REQUESTED_PENDING_FILTER,
  STATUS_META,
  RECOVERY_META,
  PAYOUT_METHOD_META,
  normalizeAdvancePayoutMethod,
  joinPbFilters,
  buildAdminAdvanceSegmentFilter,
  buildAdvanceFilter,
  formatMoney,
} from "@/lib/advances";
import { PageContainer } from "@/components/layout/PageContainer";
import { ResponsiveOverlay } from "@/components/layout/ResponsiveOverlay";
import { FilterBar } from "@/components/ui/filter-bar";
import { StatCard } from "@/components/ui/stat-card";
import { StatusChip, toneBorder } from "@/components/ui/status-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { DataLoadingState } from "@/components/ui/data-loading-state";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { BankPicker } from "@/components/staff/BankNameInput";
import { DateInput } from "@/components/ui/date-input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { exportToExcel, formatDateOnly } from "@/lib/excel";
import { escapePb } from "@/lib/delegations";
import { markSeen } from "@/lib/seen";
import { formatMoneyInput, parseMoneyInput } from "@/lib/money";
import { createStaffActionLog } from "@/lib/staff-log";
import { fetchFactories, type FactoryRecord } from "@/lib/factories";
import {
  assertAdvanceInteractionAllowed,
  isAdvanceInteractionAllowed,
  resolveAdvancePolicy,
  validateAdvanceAmount,
  type AdvancePolicy,
} from "@/lib/advance-policy";
import { buildVietQrUrl, resolveBankName } from "@/lib/vn-banks";
import { toast } from "@/lib/toast";
import {
  Banknote,
  Check,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Clock,
  FileDown,
  History,
  Loader2,
  Pencil,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  TriangleAlert,
  Wallet,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AdvancePayoutMethodPicker } from "@/components/advances/AdvancePayoutMethodPicker";
import { AdvanceReadOnlyNotice } from "@/components/advances/AdvanceReadOnlyNotice";
import { getUserErrorMessage } from "@/lib/toast";

export const Route = createFileRoute("/_authenticated/advances")({
  component: AdvancesPage,
});

const TRANSFER_DESCRIPTION_STORAGE_KEY = "jobconnect.advanceTransferDescriptionTemplate";
const ADVANCE_FILTERS_STORAGE_KEY = "jobconnect.advanceFilters";
const DEFAULT_TRANSFER_DESCRIPTION_TEMPLATE = "Giải ngân ứng + tên";

type DisbursementFilter = "all" | "yes" | "no";
type AdvanceUndoKind = "recovery" | "rejection";
type BulkAction = "accepted" | "rejected" | "recovered" | "unrecoverable";
type AdvanceUndoRequest = {
  row: AdvanceRecord;
  kind: AdvanceUndoKind;
};

type StoredAdvanceFilters = {
  search?: string;
  tab?: AdminTab;
  dateFrom?: string;
  dateTo?: string;
  factoryFilter?: string;
  disbursementFilter?: DisbursementFilter;
  showFilters?: boolean;
};

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

function removeVietnameseTone(value: string) {
  return value
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function buildTransferDescription(template: string, fullName?: string) {
  const name = fullName?.trim() || "";
  const withName = template.replace(/\+\s*(?:tên|ten)/gi, name);
  const normalized = removeVietnameseTone(withName).replace(/\s+/g, " ").trim();
  return normalized || "Giai ngan ung";
}

function readStoredAdvanceFilters(): StoredAdvanceFilters {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(ADVANCE_FILTERS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredAdvanceFilters;
    const validTab = parsed.tab && parsed.tab in ADVANCE_TAB_FILTERS ? parsed.tab : undefined;
    const validDisbursement: DisbursementFilter =
      parsed.disbursementFilter === "yes" || parsed.disbursementFilter === "no"
        ? parsed.disbursementFilter
        : "all";
    return {
      search: parsed.search || "",
      tab: validTab,
      dateFrom: parsed.dateFrom || "",
      dateTo: parsed.dateTo || "",
      factoryFilter: parsed.factoryFilter || "all",
      disbursementFilter: validDisbursement,
      showFilters: Boolean(parsed.showFilters),
    };
  } catch {
    return {};
  }
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

function AdvancesPage() {
  const { user, isAdmin, isStaff } = useAuth();
  const queryClient = useQueryClient();
  const { data: settings } = useAppSettings();
  const [storedFilters] = useState(readStoredAdvanceFilters);

  const [items, setItems] = useState<AdvanceRecord[]>([]);
  const [search, setSearch] = useState(storedFilters.search || "");
  const debouncedSearch = useDebouncedSearch(search);
  const [tab, setTab] = useState<AdminTab>(storedFilters.tab || "pending");
  const [showProfile, setShowProfile] = useState(false);
  const [sending, setSending] = useState(false);
  const [amountText, setAmountText] = useState("");
  const [reason, setReason] = useState("");
  const [payoutMethod, setPayoutMethod] = useState<AdvancePayoutMethod>("bank_transfer");
  const [bankForm, setBankForm] = useState({
    bank_name: "",
    bank_account_number: "",
    bank_account_name: "",
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<BulkAction | null>(null);
  const [editingAmountId, setEditingAmountId] = useState<string | null>(null);
  const [editAmountText, setEditAmountText] = useState("");
  const [dateFrom, setDateFrom] = useState(storedFilters.dateFrom || "");
  const [dateTo, setDateTo] = useState(storedFilters.dateTo || "");
  const [factoryFilter, setFactoryFilter] = useState(storedFilters.factoryFilter || "all");
  const [disbursementFilter, setDisbursementFilter] = useState<DisbursementFilter>(
    storedFilters.disbursementFilter || "all",
  );
  const [factories, setFactories] = useState<FactoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [advanceDetail, setAdvanceDetail] = useState<AdvanceRecord | null>(null);
  const [adminNoteDraft, setAdminNoteDraft] = useState("");
  const [recoveryNoteDraft, setRecoveryNoteDraft] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [advancePolicy, setAdvancePolicy] = useState<AdvancePolicy | null>(null);
  const [advancePolicyError, setAdvancePolicyError] = useState("");
  const [advancePolicyLoading, setAdvancePolicyLoading] = useState(false);
  const [stats, setStats] = useState<Record<AdminTab, AdvanceSummary>>(emptyAdvanceSummaries);
  const [adminSegment, setAdminSegment] = useState<AdminAdvanceSegment>("workers");
  const [transferDescriptionTemplate, setTransferDescriptionTemplate] = useState(
    DEFAULT_TRANSFER_DESCRIPTION_TEMPLATE,
  );
  const [showMobileStats, setShowMobileStats] = useState(false);
  const [showFilters, setShowFilters] = useState(Boolean(storedFilters.showFilters));
  const [undoRequest, setUndoRequest] = useState<AdvanceUndoRequest | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [advanceSettingOpen, setAdvanceSettingOpen] = useState(false);
  const [disableConfirmationOpen, setDisableConfirmationOpen] = useState(false);
  const [advanceSettingSaving, setAdvanceSettingSaving] = useState(false);

  const advanceReportingEnabled = settings.advance_reporting_enabled !== false;
  const interactionAllowed = isAdvanceInteractionAllowed(settings, user?.role);
  const selectedAdvanceUser = user as UserRecord | null;
  const selectedFactoryName = useMemo(
    () => factories.find((factory) => factory.id === factoryFilter)?.name || "",
    [factories, factoryFilter],
  );

  useEffect(() => {
    setAdminNoteDraft(advanceDetail?.admin_note || "");
    setRecoveryNoteDraft(advanceDetail?.recovery_note || "");
  }, [advanceDetail?.id]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(TRANSFER_DESCRIPTION_STORAGE_KEY);
      if (stored) setTransferDescriptionTemplate(stored);
    } catch {
      // localStorage can be unavailable in some browser modes; keep the default template.
    }
  }, []);

  const updateTransferDescriptionTemplate = useCallback((value: string) => {
    setTransferDescriptionTemplate(value);
    try {
      window.localStorage.setItem(TRANSFER_DESCRIPTION_STORAGE_KEY, value);
    } catch {
      // The current input state is still enough to build QR content.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        ADVANCE_FILTERS_STORAGE_KEY,
        JSON.stringify({
          search,
          tab,
          dateFrom,
          dateTo,
          factoryFilter,
          disbursementFilter,
          showFilters,
        } satisfies StoredAdvanceFilters),
      );
    } catch {
      // Filters still work for the current session when localStorage is unavailable.
    }
  }, [dateFrom, dateTo, disbursementFilter, factoryFilter, search, showFilters, tab]);

  useEffect(() => {
    if (!selectedAdvanceUser) return;
    setBankForm({
      bank_name: resolveBankName(selectedAdvanceUser.bank_name || ""),
      bank_account_number: selectedAdvanceUser.bank_account_number || "",
      bank_account_name: selectedAdvanceUser.bank_account_name || "",
    });
  }, [
    selectedAdvanceUser?.id,
    selectedAdvanceUser?.bank_name,
    selectedAdvanceUser?.bank_account_number,
    selectedAdvanceUser?.bank_account_name,
  ]);

  useEffect(() => {
    if (!isAdmin) {
      setFactories([]);
      setFactoryFilter("all");
      return;
    }

    let active = true;
    fetchFactories()
      .then((rows) => {
        if (active) setFactories(rows);
      })
      .catch((error: unknown) => {
        toast.error((error as any)?.message || "Lỗi tải danh sách nhà máy");
      });

    return () => {
      active = false;
    };
  }, [isAdmin]);

  const handleAdvancesFilterError = useCallback(
    (error: unknown) => {
      if ((error as any)?.status === 400 && isAdmin && disbursementFilter !== "all") {
        setDisbursementFilter("all");
        toast.info("Bộ lọc 'giải ngân' không khả dụng trên máy chủ, đã đặt lại mặc định.");
        return true;
      }
      return false;
    },
    [isAdmin, disbursementFilter],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const baseFilter = buildAdvanceFilter({
        isAdmin,
        isStaff,
        userId: user?.id,
        tab: isAdmin || isStaff ? tab : undefined,
        dateFrom,
        dateTo,
        search: debouncedSearch,
        factoryName: isAdmin ? selectedFactoryName : "",
        disbursed: isAdmin ? disbursementFilter : "all",
      });
      const segmentFilter = joinTenantFilters(
        user,
        isAdmin
          ? joinPbFilters([baseFilter, buildAdminAdvanceSegmentFilter(adminSegment)])
          : baseFilter,
      );
      const listOptions = {
        filter: segmentFilter,
        sort: "-created",
        expand: "requested_by",
      };
      const rows =
        isAdmin && tab === "pending"
          ? await pb.collection("advances").getFullList<AdvanceRecord>(listOptions)
          : (await pb.collection("advances").getList<AdvanceRecord>(1, 300, listOptions)).items;
      setItems(rows);
      if (!isAdmin) {
        const latestResolved = rows.reduce(
          (max, row) => Math.max(max, row.resolved_at ? new Date(row.resolved_at).getTime() : 0),
          0,
        );
        markSeen("advances", user?.id, latestResolved || Date.now());
      }
    } catch (error: unknown) {
      if (handleAdvancesFilterError(error)) return;
      toast.error((error as any)?.message || "Lỗi tải Ứng lương");
    } finally {
      setLoading(false);
    }
  }, [
    adminSegment,
    dateFrom,
    dateTo,
    disbursementFilter,
    handleAdvancesFilterError,
    isAdmin,
    isStaff,
    debouncedSearch,
    selectedFactoryName,
    tab,
    user?.id,
  ]);

  const loadStats = useCallback(async () => {
    const base = buildAdvanceFilter({
      isAdmin,
      isStaff,
      userId: user?.id,
      dateFrom,
      dateTo,
      search: debouncedSearch,
      factoryName: isAdmin ? selectedFactoryName : "",
      disbursed: isAdmin ? disbursementFilter : "all",
    });
    const segmentBase = joinTenantFilters(
      user,
      isAdmin ? joinPbFilters([base, buildAdminAdvanceSegmentFilter(adminSegment)]) : base,
    );
    const withBase = (statusFilter: string) => joinPbFilters([segmentBase, statusFilter]);
    const adminPendingFilter = `(status="recruiter_approved" || ${LEGACY_STAFF_REQUESTED_PENDING_FILTER})`;
    try {
      const [pending, recruiter_approved, accepted, recovered, unrecoverable, rejected, all] =
        await Promise.all([
          loadAdvanceSummary(withBase(ADVANCE_TAB_FILTERS.pending)),
          loadAdvanceSummary(
            withBase(isAdmin ? adminPendingFilter : ADVANCE_TAB_FILTERS.recruiter_approved),
          ),
          loadAdvanceSummary(withBase(ADVANCE_TAB_FILTERS.accepted)),
          loadAdvanceSummary(withBase(ADVANCE_TAB_FILTERS.recovered)),
          loadAdvanceSummary(withBase(ADVANCE_TAB_FILTERS.unrecoverable)),
          loadAdvanceSummary(withBase(ADVANCE_TAB_FILTERS.rejected)),
          loadAdvanceSummary(segmentBase),
        ]);
      setStats({ pending, recruiter_approved, accepted, recovered, unrecoverable, rejected, all });
    } catch (error: unknown) {
      if (handleAdvancesFilterError(error)) return;
      throw error;
    }
  }, [
    adminSegment,
    dateFrom,
    dateTo,
    disbursementFilter,
    handleAdvancesFilterError,
    isAdmin,
    isStaff,
    debouncedSearch,
    selectedFactoryName,
    user?.id,
  ]);

  useEffect(() => {
    load();
    loadStats().catch(() => {});
  }, [load, loadStats]);

  useEffect(() => {
    if (!selectedAdvanceUser?.id || isAdmin || isStaff) {
      setAdvancePolicy(null);
      setAdvancePolicyError("");
      return;
    }
    let active = true;
    setAdvancePolicyLoading(true);
    resolveAdvancePolicy(selectedAdvanceUser.id, {
      allowAfterLeave: Boolean(settings.allow_advance_after_leave),
      actorRole: user?.role,
    })
      .then((policy) => {
        if (!active) return;
        setAdvancePolicy(policy);
        setAdvancePolicyError("");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setAdvancePolicy(null);
        setAdvancePolicyError(getUserErrorMessage(error, "Không thể kiểm tra hạn mức ứng tiền"));
      })
      .finally(() => active && setAdvancePolicyLoading(false));
    return () => {
      active = false;
    };
  }, [isAdmin, isStaff, selectedAdvanceUser?.id, settings.allow_advance_after_leave, user?.role]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [dateFrom, dateTo, disbursementFilter, factoryFilter, debouncedSearch, tab]);

  const limit = advancePolicy?.limit || 0;
  const outstanding = advancePolicy?.outstanding || 0;
  const available = advancePolicy?.available || 0;

  const filtered = items;
  const isActionable = (row: AdvanceRecord) => {
    const status = row.status || "pending";
    const recovery = row.recovery_status || "none";
    if (isAdmin) {
      return (
        status === "pending" ||
        status === "recruiter_approved" ||
        (status === "accepted" && recovery === "none")
      );
    }
    return status === "pending" || (status === "accepted" && recovery === "none");
  };
  const selectableFiltered = useMemo(() => filtered.filter(isActionable), [filtered]);
  const selectedPendingCount = filtered.filter(
    (row) =>
      selectedIds.has(row.id) &&
      (isAdmin
        ? (row.status || "pending") === "pending" || row.status === "recruiter_approved"
        : (row.status || "pending") === "pending"),
  ).length;
  const selectedRecoverableCount = filtered.filter(
    (row) =>
      selectedIds.has(row.id) &&
      row.status === "accepted" &&
      (row.recovery_status || "none") === "none",
  ).length;
  const selectedActionableCount = selectedPendingCount + selectedRecoverableCount;

  const saveAdvanceReportingEnabled = async (enabled: boolean) => {
    setAdvanceSettingSaving(true);
    try {
      const saved = settings.id
        ? await pb.collection("app_settings").update<AppSettings>(settings.id, {
            advance_reporting_enabled: enabled,
          })
        : await pb.collection("app_settings").create<AppSettings>({
            advance_reporting_enabled: enabled,
          });
      queryClient.setQueryData<AppSettings>(["app_settings"], (current) => ({
        ...current,
        ...saved,
        advance_reporting_enabled: enabled,
      }));
      toast.success(
        enabled
          ? "Đã cho phép User và Staff thao tác báo ứng"
          : "Đã chuyển User và Staff sang chế độ chỉ xem",
      );
      if (!enabled) setDisableConfirmationOpen(false);
    } catch (error: unknown) {
      toast.error(getUserErrorMessage(error, "Không thể lưu trạng thái chức năng báo ứng"));
    } finally {
      setAdvanceSettingSaving(false);
    }
  };

  const submit = async (e: React.FormEvent): Promise<boolean> => {
    e.preventDefault();
    const amount = parseMoneyInput(amountText);
    if (!amount) {
      toast.error("Số tiền xin ứng không được để trống");
      return false;
    }
    if (!reason.trim()) {
      toast.error("Lý do ứng không được để trống");
      return false;
    }
    if (!selectedAdvanceUser?.id) {
      toast.error("Chọn người báo ứng");
      return false;
    }
    setSending(true);
    try {
      await assertAdvanceInteractionAllowed(user?.role);
      const policy = await resolveAdvancePolicy(selectedAdvanceUser.id, {
        allowAfterLeave: Boolean(settings.allow_advance_after_leave),
        actorRole: user?.role,
      });
      validateAdvanceAmount(policy, amount);
      const employment = policy.employment;
      const created = await pb.collection("advances").create({
        ...companyPayload(user),
        worker: selectedAdvanceUser.id,
        requested_by: user?.id || selectedAdvanceUser.id,
        recruiter_id: employment.recruiter_staff || "",
        employee_code: employment.employee_code || "",
        full_name: employment.worker_name_snapshot || selectedAdvanceUser.full_name || "",
        company: policy.factoryName,
        phone: selectedAdvanceUser.phone || "",
        join_date: employment.join_date || "",
        bank_name: payoutMethod === "cash" ? "" : bankForm.bank_name || "",
        bank_account_number: payoutMethod === "cash" ? "" : bankForm.bank_account_number || "",
        bank_account_name: payoutMethod === "cash" ? "" : bankForm.bank_account_name || "",
        payout_method: payoutMethod,
        amount,
        reason: reason.trim(),
        status: "pending",
        recovery_status: "none",
      });
      await createStaffActionLog({
        actor: user,
        targetUserId: selectedAdvanceUser.id,
        targetCollection: "advances",
        targetRecord: created.id,
        action: "report_advance",
        after: created,
        note:
          user?.id === selectedAdvanceUser.id ? "NLĐ tự báo ứng" : "Tạo yêu cầu ứng lương cho NLĐ",
      });
      toast.success("Đã gửi Ứng lương");
      setAmountText("");
      setReason("");
      setPayoutMethod("bank_transfer");
      load();
      setAdvancePolicy({
        ...policy,
        outstanding: policy.outstanding + amount,
        available: Math.max(0, policy.limit - policy.outstanding - amount),
      });
      return true;
    } catch (error: unknown) {
      toast.error((error as any)?.message || "Lỗi gửi Ứng lương");
      return false;
    } finally {
      setSending(false);
    }
  };

  const updateRow = async (id: string, payload: Partial<AdvanceRecord>) => {
    await pb.collection("advances").update(id, payload);
  };

  const runBulkAction = async (action: BulkAction, operation: () => Promise<void>) => {
    if (bulkAction) return;
    setBulkAction(action);
    try {
      await operation();
    } finally {
      setBulkAction(null);
    }
  };

  const bulkUpdate = async (status: Exclude<AdvanceStatus, "pending" | "recruiter_approved">) => {
    const rows = filtered.filter(
      (row) =>
        selectedIds.has(row.id) &&
        (isAdmin
          ? (row.status || "pending") === "pending" || row.status === "recruiter_approved"
          : (row.status || "pending") === "pending"),
    );
    if (!rows.length || bulkAction) return;
    await runBulkAction(status, async () => {
      try {
        for (const row of rows) {
          const after = {
            status,
            resolved_at: new Date().toISOString(),
            admin_note: row.admin_note || "",
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
            note: status === "accepted" ? "Admin duyệt báo ứng" : "Admin từ chối báo ứng",
          });
        }
        toast.success(status === "accepted" ? "Đã duyệt" : "Đã từ chối");
        setSelectedIds(new Set());
        await load();
        loadStats().catch(() => {});
      } catch (error: unknown) {
        toast.error((error as any)?.message || "Lỗi xử lý hàng loạt");
      }
    });
  };

  const bulkResolveRecovery = async (recoveryStatus: Exclude<RecoveryStatus, "none">) => {
    const rows = filtered.filter(
      (row) =>
        selectedIds.has(row.id) &&
        row.status === "accepted" &&
        (row.recovery_status || "none") === "none",
    );
    if (!rows.length || bulkAction) return;
    await runBulkAction(recoveryStatus, async () => {
      try {
        for (const row of rows) {
          const after = {
            recovery_status: recoveryStatus,
            recovered_at: recoveryStatus === "recovered" ? new Date().toISOString() : "",
          };
          await updateRow(row.id, after);
          await createStaffActionLog({
            actor: user,
            targetUserId: row.worker,
            targetCollection: "advances",
            targetRecord: row.id,
            action: "update",
            before: { recovery_status: row.recovery_status || "none" },
            after,
            note:
              recoveryStatus === "recovered"
                ? "Admin đánh dấu đã thu hồi"
                : "Admin đánh dấu không thu hồi",
          });
        }
        toast.success(
          recoveryStatus === "recovered" ? "Đã đánh dấu thu hồi" : "Đã đánh dấu không thu hồi",
        );
        setSelectedIds(new Set());
        await load();
        loadStats().catch(() => {});
      } catch (error: unknown) {
        toast.error((error as any)?.message || "Lỗi xử lý hàng loạt");
      }
    });
  };

  const resolveRecovery = async (
    row: AdvanceRecord,
    recoveryStatus: Exclude<RecoveryStatus, "none">,
  ) => {
    try {
      const after = {
        recovery_status: recoveryStatus,
        recovered_at: recoveryStatus === "recovered" ? new Date().toISOString() : "",
      };
      await updateRow(row.id, after);
      await createStaffActionLog({
        actor: user,
        targetUserId: row.worker,
        targetCollection: "advances",
        targetRecord: row.id,
        action: "update",
        before: { recovery_status: row.recovery_status || "none" },
        after,
        note:
          recoveryStatus === "recovered"
            ? "Admin đánh dấu đã thu hồi"
            : "Admin đánh dấu không thể thu hồi",
      });
      toast.success(
        recoveryStatus === "recovered" ? "Đã đánh dấu thu hồi" : "Đã đánh dấu không thể thu hồi",
      );
      load();
    } catch (error: unknown) {
      toast.error((error as any)?.message || "Lỗi");
    }
  };

  const setDisbursed = async (row: AdvanceRecord, disbursed: boolean) => {
    try {
      const after = {
        disbursed,
        disbursed_at: disbursed ? new Date().toISOString() : "",
      };
      await updateRow(row.id, after);
      setAdvanceDetail((current) =>
        current && current.id === row.id ? { ...current, ...after } : current,
      );
      load();

      try {
        await createStaffActionLog({
          actor: user,
          targetUserId: row.worker,
          targetCollection: "advances",
          targetRecord: row.id,
          action: "update",
          before: { disbursed: Boolean(row.disbursed) },
          after,
          note: disbursed ? "Admin đánh dấu đã giải ngân" : "Admin hoàn tác giải ngân",
        });
      } catch {
        toast.warning(
          disbursed
            ? "Đã cập nhật giải ngân nhưng chưa ghi được nhật ký"
            : "Đã hoàn tác giải ngân nhưng chưa ghi được nhật ký",
        );
        return false;
      }

      toast.success(disbursed ? "Đã đánh dấu giải ngân" : "Đã hoàn tác giải ngân");
      return true;
    } catch (error: unknown) {
      toast.error((error as any)?.message || "Lỗi");
      return false;
    }
  };

  const saveEditedAmount = async (row: AdvanceRecord) => {
    const newAmount = parseMoneyInput(editAmountText);
    if (!newAmount || newAmount <= 0) {
      toast.error("Số tiền không hợp lệ");
      return;
    }
    if (newAmount === row.amount) {
      setEditingAmountId(null);
      return;
    }
    try {
      const payload: Partial<AdvanceRecord> = {
        amount: newAmount,
        original_amount: row.original_amount || row.amount,
      };
      await updateRow(row.id, payload);
      await createStaffActionLog({
        actor: user,
        targetUserId: row.worker,
        targetCollection: "advances",
        targetRecord: row.id,
        action: "update",
        before: { amount: row.amount },
        after: { amount: newAmount, original_amount: row.original_amount || row.amount },
        note: `Admin sửa số tiền ứng: ${formatMoney(row.amount)} → ${formatMoney(newAmount)}`,
      });
      toast.success("Đã cập nhật số tiền");
      setEditingAmountId(null);
      load();
    } catch (error: unknown) {
      toast.error((error as any)?.message || "Lỗi cập nhật số tiền");
    }
  };

  const adminResolve = async (row: AdvanceRecord, newStatus: "accepted" | "rejected") => {
    try {
      const after = {
        status: newStatus,
        resolved_at: new Date().toISOString(),
      };
      await updateRow(row.id, after);
      await createStaffActionLog({
        actor: user,
        targetUserId: row.worker,
        targetCollection: "advances",
        targetRecord: row.id,
        action: "update",
        before: { status: row.status || "recruiter_approved" },
        after,
        note: newStatus === "accepted" ? "Admin tiếp nhận ứng lương" : "Admin từ chối ứng lương",
      });
      toast.success(newStatus === "accepted" ? "Đã tiếp nhận" : "Đã từ chối");
      load();
    } catch (error: unknown) {
      toast.error((error as any)?.message || "Lỗi xử lý");
    }
  };

  const requestAdvanceUndo = (row: AdvanceRecord, kind: AdvanceUndoKind) => {
    if (!isAdmin) return;
    setUndoRequest({ row, kind });
  };

  const confirmAdvanceUndo = async () => {
    if (!undoRequest || !isAdmin) return;
    const { row, kind } = undoRequest;
    setUndoing(true);
    try {
      if (kind === "recovery") {
        const previousRecovery = (row.recovery_status || "none") as RecoveryStatus;
        const after: Partial<AdvanceRecord> = {
          status: "accepted",
          recovery_status: "none",
          recovered_at: "",
        };
        await updateRow(row.id, after);
        await createStaffActionLog({
          actor: user,
          targetUserId: row.worker,
          targetCollection: "advances",
          targetRecord: row.id,
          action: "update",
          before: {
            status: row.status || "accepted",
            recovery_status: previousRecovery,
            recovered_at: row.recovered_at || "",
          },
          after,
          note:
            previousRecovery === "recovered"
              ? "Admin hoàn tác đã thu hồi về đã tiếp nhận"
              : "Admin hoàn tác không thể thu hồi về đã tiếp nhận",
        });
        toast.success("Đã hoàn tác về trạng thái Đã tiếp nhận");
      } else {
        const after: Partial<AdvanceRecord> = {
          status: "recruiter_approved",
          resolved_at: "",
        };
        await updateRow(row.id, after);
        await createStaffActionLog({
          actor: user,
          targetUserId: row.worker,
          targetCollection: "advances",
          targetRecord: row.id,
          action: "update",
          before: { status: row.status || "rejected", resolved_at: row.resolved_at || "" },
          after,
          note: "Admin hoàn tác từ chối ứng lương về chờ duyệt",
        });
        toast.success("Đã đưa yêu cầu về trạng thái Chờ duyệt");
      }
      setUndoRequest(null);
      setAdvanceDetail((current) => (current?.id === row.id ? null : current));
      await load();
      loadStats().catch(() => {});
    } catch (error: unknown) {
      toast.error(getUserErrorMessage(error, "Không thể hoàn tác trạng thái"));
    } finally {
      setUndoing(false);
    }
  };

  const exportCurrent = () => {
    const rows = filtered.map((row) => ({
      "Họ tên": row.full_name,
      "Mã nhân viên": row.employee_code,
      "Nhà máy": row.company,
      "Ngày vào làm": formatDateOnly(row.join_date),
      "Số điện thoại": row.phone,
      "Người báo ứng": getAdvanceRequesterName(row),
      "Mã nhân viên người báo": getAdvanceRequesterField(row, "employee_code"),
      "Nhà máy người báo": getAdvanceRequesterField(row, "company"),
      "Số điện thoại người báo": getAdvanceRequesterField(row, "phone"),
      "Ngân hàng": row.bank_name || "",
      "Số tài khoản": row.bank_account_number || "",
      "Tên chủ tài khoản": row.bank_account_name || "",
      "Hình thức nhận tiền":
        PAYOUT_METHOD_META[normalizeAdvancePayoutMethod(row.payout_method)].label,
      "Số tiền": row.amount,
      "Số tiền ban đầu":
        row.original_amount && row.original_amount !== row.amount ? row.original_amount : "",
      "Lý do": row.reason,
      "Trạng thái": STATUS_META[(row.status || "pending") as AdvanceStatus].label,
      "Đã giải ngân": row.status === "accepted" ? (row.disbursed ? "Có" : "Không") : "",
      "Thu hồi": RECOVERY_META[(row.recovery_status || "none") as RecoveryStatus].label,
      "Ghi chú admin": row.admin_note || "",
      "Ghi chú người tuyển": row.recruiter_note || "",
      "Ghi chú thu hồi": row.recovery_note || "",
      "Ngày gửi": formatDateOnly(row.created),
      "Ngày duyệt": formatDateOnly(row.resolved_at),
      "Ngày giải ngân": formatDateOnly(row.disbursed_at),
      "Ngày thu hồi": formatDateOnly(row.recovered_at),
    }));
    exportToExcel(`ung_luong_${Date.now()}`, { "Ứng lương": rows });
  };

  if (!isAdmin && !isStaff) {
    return (
      <PageContainer title="Ứng lương" subtitle="Xin ứng lương & xem lịch sử">
        <AdvanceRulesCard rules={settings.advance_rules} />
        {!interactionAllowed && <AdvanceReadOnlyNotice />}

        <Button
          className="w-full"
          disabled={!interactionAllowed}
          onClick={() => {
            setPayoutMethod("bank_transfer");
            setShowProfile(true);
          }}
        >
          <Send className="h-4 w-4" /> Báo ứng mới
        </Button>

        <ResponsiveOverlay
          open={showProfile}
          onOpenChange={setShowProfile}
          title="Báo ứng mới"
          description="Nhập thông tin và gửi yêu cầu ứng lương."
          presentation="full"
        >
          <form
            onSubmit={async (e) => {
              const ok = await submit(e);
              if (ok) setShowProfile(false);
            }}
            className="min-w-0 space-y-3"
          >
            <div className="min-w-0 space-y-3">
              <UserProfileCollapsible user={selectedAdvanceUser} policy={advancePolicy} />
              {!interactionAllowed && <AdvanceReadOnlyNotice />}

              {advancePolicyLoading && (
                <div className="rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
                  Đang kiểm tra nhà máy và hạn mức ứng tiền...
                </div>
              )}
              {!advancePolicyLoading && advancePolicyError && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  {advancePolicyError}
                </div>
              )}
              {advancePolicyError.includes("chưa có mã nhân viên") && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  <div className="font-semibold">Chưa đủ thông tin để báo ứng</div>
                  <div className="mt-1">{advancePolicyError}</div>
                </div>
              )}
              {advancePolicy && (
                <div className="flex flex-wrap items-center gap-1.5 rounded-xl border bg-primary/5 p-3 text-xs">
                  <span className="text-muted-foreground">Nhà máy áp dụng:</span>
                  <span className="font-semibold">{advancePolicy.factoryName}</span>
                  <span className="text-muted-foreground">Mã NV:</span>
                  <span className="font-semibold">{advancePolicy.employment.employee_code}</span>
                  {!advancePolicy.isWorking && <StatusChip tone="warning">Đã nghỉ</StatusChip>}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <StatCard
                  label="Hạn mức"
                  value={limit > 0 ? formatMoney(limit) : "Chưa cài"}
                  icon={Wallet}
                  tone="primary"
                />
                <StatCard
                  label="Đã báo ứng chưa thu hồi"
                  value={formatMoney(outstanding)}
                  icon={Banknote}
                  tone="warning"
                />
              </div>
              <div className="rounded-xl border border-dashed border-border bg-muted/30 p-2 text-xs text-muted-foreground">
                Còn có thể báo ứng:{" "}
                <span className="font-semibold text-foreground">
                  {limit > 0 ? formatMoney(available) : "—"}
                </span>
              </div>

              <AdvancePayoutMethodPicker value={payoutMethod} onChange={setPayoutMethod} />

              {payoutMethod === "bank_transfer" && (
                <div className="space-y-2 rounded-xl border bg-muted/30 p-3">
                  <div className="text-xs font-semibold text-muted-foreground">
                    Tài khoản nhận tiền
                  </div>
                  <div className="space-y-1">
                    <Label>Ngân hàng</Label>
                    <BankPicker
                      value={bankForm.bank_name || ""}
                      onChange={(value) => setBankForm({ ...bankForm, bank_name: value })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="min-w-0 space-y-1">
                      <Label>Số TK</Label>
                      <Input
                        value={bankForm.bank_account_number}
                        inputMode="numeric"
                        onChange={(e) =>
                          setBankForm({
                            ...bankForm,
                            bank_account_number: e.target.value.replace(/\D/g, ""),
                          })
                        }
                      />
                    </div>
                    <div className="min-w-0 space-y-1">
                      <Label>Tên TK</Label>
                      <Input
                        value={bankForm.bank_account_name}
                        onChange={(e) =>
                          setBankForm({ ...bankForm, bank_account_name: e.target.value })
                        }
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-1">
                <Label>Số tiền xin ứng</Label>
                <Input
                  value={amountText}
                  onChange={(e) => setAmountText(formatMoneyInput(e.target.value))}
                  inputMode="numeric"
                  placeholder="0"
                />
              </div>
              <div className="space-y-1">
                <Label>Lý do ứng</Label>
                <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={sending || advancePolicyLoading || !advancePolicy || !interactionAllowed}
              >
                <Send className="h-4 w-4" /> {sending ? "Đang gửi…" : "Gửi Ứng lương"}
              </Button>
            </div>
          </form>
        </ResponsiveOverlay>

        <div className="flex items-center gap-2 px-1 pt-2">
          <History className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Lịch sử của bạn ({items.length})</span>
        </div>
        {loading && items.length > 0 && (
          <DataLoadingState variant="inline" label="Đang cập nhật lịch sử ứng lương..." />
        )}
        {loading && items.length === 0 ? (
          <DataLoadingState variant="list" label="Đang tải lịch sử ứng lương..." rows={2} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title="Chưa có Ứng lương"
            description="Yêu cầu của bạn sẽ hiển thị tại đây."
          />
        ) : (
          items.map((row) => (
            <div
              key={row.id}
              role="button"
              tabIndex={0}
              onClick={() => setAdvanceDetail(row)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setAdvanceDetail(row);
                }
              }}
              className={cn(
                "list-card cursor-pointer",
                toneBorder[STATUS_META[(row.status || "pending") as AdvanceStatus].tone],
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-primary">{formatMoney(row.amount)}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {new Date(row.created).toLocaleString("vi-VN")}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <StatusChip
                    tone={STATUS_META[(row.status || "pending") as AdvanceStatus].tone as any}
                  >
                    {STATUS_META[(row.status || "pending") as AdvanceStatus].label}
                  </StatusChip>
                  <StatusChip
                    tone={
                      normalizeAdvancePayoutMethod(row.payout_method) === "cash"
                        ? "warning"
                        : "neutral"
                    }
                  >
                    {PAYOUT_METHOD_META[normalizeAdvancePayoutMethod(row.payout_method)].label}
                  </StatusChip>
                </div>
              </div>
            </div>
          ))
        )}

        <AdvanceDetailDialog
          advanceDetail={advanceDetail}
          setAdvanceDetail={setAdvanceDetail}
          items={items}
          isAdmin={false}
          actor={user}
          adminNoteDraft={adminNoteDraft}
          setAdminNoteDraft={setAdminNoteDraft}
          recoveryNoteDraft={recoveryNoteDraft}
          setRecoveryNoteDraft={setRecoveryNoteDraft}
          transferDescriptionTemplate={transferDescriptionTemplate}
          savingNotes={savingNotes}
          setSavingNotes={setSavingNotes}
          updateRow={updateRow}
          setDisbursed={setDisbursed}
          requestAdvanceUndo={requestAdvanceUndo}
          load={load}
        />
      </PageContainer>
    );
  }

  if (isStaff && !isAdmin) {
    return <Navigate to="/staff/advances" />;
  }

  return (
    <PageContainer
      title="Ứng lương"
      subtitle={loading && items.length === 0 ? "Đang tải dữ liệu..." : `${items.length} mục`}
      right={
        <button
          onClick={exportCurrent}
          disabled={loading}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:bg-muted"
          aria-label="Xuất Excel"
        >
          <FileDown className="h-4 w-4" />
        </button>
      }
    >
      <div className="flex gap-1 rounded-lg bg-muted p-1">
        <button
          type="button"
          className={cn(
            "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            adminSegment === "workers"
              ? "bg-background shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => setAdminSegment("workers")}
        >
          Ứng NLĐ
        </button>
        <button
          type="button"
          className={cn(
            "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            adminSegment === "staff"
              ? "bg-background shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => setAdminSegment("staff")}
        >
          Ứng Staff
        </button>
      </div>
      <button
        type="button"
        onClick={() => setShowMobileStats((current) => !current)}
        aria-expanded={showMobileStats}
        aria-controls="admin-advance-statistics"
        className="w-full text-right text-xs font-medium text-primary md:hidden"
      >
        {showMobileStats ? "Ẩn thống kê" : "Hiện thống kê"}
      </button>
      <div
        id="admin-advance-statistics"
        className={showMobileStats ? "space-y-2" : "hidden space-y-2 md:block"}
      >
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 desktop:grid-cols-6">
            <StatCard
              label="Chờ duyệt"
              value={statValue(stats.recruiter_approved)}
              icon={Clock}
              tone="warning"
              className="desktop:!p-2.5 desktop:[&>div:first-child>div:first-child]:!text-[10px] desktop:[&>div:first-child>div:last-child]:!h-6 desktop:[&>div:first-child>div:last-child]:!w-6 desktop:[&>div:first-child>div:last-child>svg]:!h-3 desktop:[&>div:first-child>div:last-child>svg]:!w-3 desktop:[&>div:nth-child(2)]:!mt-0.5 desktop:[&>div:nth-child(2)]:!text-sm desktop:[&>div:nth-child(2)>span]:!text-sm"
            />
            <StatCard
              label="Đã tiếp nhận"
              value={statValue(stats.accepted)}
              icon={Check}
              tone="success"
              className="desktop:!p-2.5 desktop:[&>div:first-child>div:first-child]:!text-[10px] desktop:[&>div:first-child>div:last-child]:!h-6 desktop:[&>div:first-child>div:last-child]:!w-6 desktop:[&>div:first-child>div:last-child>svg]:!h-3 desktop:[&>div:first-child>div:last-child>svg]:!w-3 desktop:[&>div:nth-child(2)]:!mt-0.5 desktop:[&>div:nth-child(2)]:!text-sm desktop:[&>div:nth-child(2)>span]:!text-sm"
            />
            <div className={showMobileStats ? "contents" : "hidden desktop:contents"}>
              <StatCard
                label="Từ chối"
                value={statValue(stats.rejected)}
                icon={X}
                tone="danger"
                className="desktop:!p-2.5 desktop:[&>div:first-child>div:first-child]:!text-[10px] desktop:[&>div:first-child>div:last-child]:!h-6 desktop:[&>div:first-child>div:last-child]:!w-6 desktop:[&>div:first-child>div:last-child>svg]:!h-3 desktop:[&>div:first-child>div:last-child>svg]:!w-3 desktop:[&>div:nth-child(2)]:!mt-0.5 desktop:[&>div:nth-child(2)]:!text-sm desktop:[&>div:nth-child(2)>span]:!text-sm"
              />
              <StatCard
                label="Đã thu hồi"
                value={statValue(stats.recovered)}
                icon={ShieldCheck}
                tone="primary"
                className="desktop:!p-2.5 desktop:[&>div:first-child>div:first-child]:!text-[10px] desktop:[&>div:first-child>div:last-child]:!h-6 desktop:[&>div:first-child>div:last-child]:!w-6 desktop:[&>div:first-child>div:last-child>svg]:!h-3 desktop:[&>div:first-child>div:last-child>svg]:!w-3 desktop:[&>div:nth-child(2)]:!mt-0.5 desktop:[&>div:nth-child(2)]:!text-sm desktop:[&>div:nth-child(2)>span]:!text-sm"
              />
              <StatCard
                label="Không thu hồi"
                value={statValue(stats.unrecoverable)}
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
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <AdvanceRulesCard rules={settings.advance_rules} compact />
        <button
          type="button"
          onClick={() => setAdvanceSettingOpen(true)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-soft transition active:scale-[0.98]",
            advanceReportingEnabled
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-amber-300 bg-amber-50 text-amber-800",
          )}
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          {advanceReportingEnabled ? "Cho ứng: Đang bật" : "Cho ứng: Chỉ xem"}
        </button>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-soft transition",
            showFilters
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-card text-primary",
          )}
          onClick={() => setShowFilters((value) => !value)}
          aria-expanded={showFilters}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Bộ lọc
        </button>
      </div>

      <FilterBar
        desktopSearchAfterChips
        searchClassName="hidden desktop:flex"
        search={search}
        onSearchChange={setSearch}
        placeholder="Tìm theo tên, mã NV, số tiền?"
        chips={[
          { key: "pending", label: `Chờ duyệt (${stats.recruiter_approved.count})` },
          { key: "accepted", label: `Đã tiếp nhận (${stats.accepted.count})` },
          { key: "recovered", label: `Đã thu hồi (${stats.recovered.count})` },
          { key: "unrecoverable", label: `Không thu hồi (${stats.unrecoverable.count})` },
          { key: "rejected", label: `Từ chối (${stats.rejected.count})` },
          { key: "all", label: "Tất cả" },
        ]}
        activeChip={tab}
        onChipChange={(v) => setTab(v as AdminTab)}
        className="static -mx-1 bg-transparent px-0 py-0 backdrop-blur-0"
      />

      <div className="space-y-2">
        {showFilters && (
          <div className="space-y-3 rounded-xl border bg-card p-3">
            <FilterBar
              search={search}
              onSearchChange={setSearch}
              placeholder="Tìm theo tên, mã NV, số tiền…"
              className="static -mx-0 bg-transparent px-0 py-0 backdrop-blur-0 desktop:hidden"
            />

            <div className="space-y-1">
              <Label className="text-xs">Nội dung chuyển khoản</Label>
              <Input
                value={transferDescriptionTemplate}
                onChange={(e) => updateTransferDescriptionTemplate(e.target.value)}
                placeholder="Ví dụ: Giải ngân ứng + tên"
                className="h-10"
              />
              <div className="text-[11px] text-muted-foreground">
                Dùng + tên để tự lấy họ tên trong từng card.
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="space-y-1 sm:col-span-1">
                <Label className="text-xs">Nhà máy</Label>
                <Select value={factoryFilter} onValueChange={setFactoryFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Tất cả nhà máy" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tất cả nhà máy</SelectItem>
                    {factories.map((factory) => (
                      <SelectItem key={factory.id} value={factory.id}>
                        {[factory.code, factory.name].filter(Boolean).join(" - ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Trạng thái giải ngân</Label>
                <Select
                  value={disbursementFilter}
                  onValueChange={(v) => setDisbursementFilter(v as DisbursementFilter)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Tất cả" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tất cả</SelectItem>
                    <SelectItem value="yes">Đã giải ngân</SelectItem>
                    <SelectItem value="no">Chưa giải ngân</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Từ ngày</Label>
                <DateInput value={dateFrom} onChange={(v) => setDateFrom(v)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Đến ngày</Label>
                <DateInput value={dateTo} onChange={(v) => setDateTo(v)} />
              </div>
            </div>
          </div>
        )}
      </div>

      {selectedActionableCount > 0 && (
        <div
          aria-busy={Boolean(bulkAction)}
          className="sticky top-[var(--header-h,3.25rem)] z-20 -mx-4 flex items-center justify-between gap-2 bg-primary/10 px-4 py-2 backdrop-blur"
        >
          <span className="text-xs font-medium text-primary">
            {selectedActionableCount} đã chọn
          </span>
          <div className="flex flex-wrap justify-end gap-2">
            {selectedPendingCount > 0 && (
              <>
                <Button
                  size="sm"
                  disabled={Boolean(bulkAction)}
                  onClick={() => bulkUpdate("accepted")}
                >
                  {bulkAction === "accepted" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  {bulkAction === "accepted" ? "Đang duyệt..." : "Duyệt"}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={Boolean(bulkAction)}
                  onClick={() => bulkUpdate("rejected")}
                >
                  {bulkAction === "rejected" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <X className="h-3.5 w-3.5" />
                  )}
                  {bulkAction === "rejected" ? "Đang từ chối..." : "Từ chối"}
                </Button>
              </>
            )}
            {selectedRecoverableCount > 0 && (
              <>
                <Button
                  size="sm"
                  disabled={Boolean(bulkAction)}
                  onClick={() => bulkResolveRecovery("recovered")}
                >
                  {bulkAction === "recovered" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-3.5 w-3.5" />
                  )}
                  {bulkAction === "recovered" ? "Đang thu hồi..." : "Thu hồi"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={Boolean(bulkAction)}
                  onClick={() => bulkResolveRecovery("unrecoverable")}
                >
                  {bulkAction === "unrecoverable" && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  )}
                  {bulkAction === "unrecoverable" ? "Đang xử lý..." : "Không thu hồi"}
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {selectableFiltered.length > 0 && (
        <label className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
          <Checkbox
            checked={selectableFiltered.every((row) => selectedIds.has(row.id))}
            disabled={Boolean(bulkAction)}
            onCheckedChange={(checked) =>
              setSelectedIds((current) => {
                if (!checked) return new Set();
                return new Set([...current, ...selectableFiltered.map((row) => row.id)]);
              })
            }
          />
          Chọn tất cả ({selectableFiltered.length})
        </label>
      )}

      {loading && items.length > 0 && (
        <DataLoadingState variant="inline" label="Đang cập nhật danh sách ứng lương..." />
      )}
      {loading && items.length === 0 ? (
        <DataLoadingState variant="list" label="Đang tải danh sách ứng lương..." rows={3} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="Không có Ứng lương"
          description={
            search || dateFrom || dateTo || factoryFilter !== "all"
              ? "Không có kết quả phù hợp."
              : "Dữ liệu sẽ hiển thị ở đây."
          }
        />
      ) : (
        filtered.map((row) => {
          const status = (row.status || "pending") as AdvanceStatus;
          const recovery = (row.recovery_status || "none") as RecoveryStatus;
          const payoutMethod = normalizeAdvancePayoutMethod(row.payout_method);
          const selectable = isActionable(row);
          const canRecover = status === "accepted" && recovery === "none";
          const canAdminResolve = status === "pending" || status === "recruiter_approved";
          const canUndoRecovery = status === "accepted" && recovery !== "none";
          const canUndoRejection = status === "rejected";
          const requesterName = getAdvanceRequesterName(row);
          return (
            <div
              key={row.id}
              className={cn(
                "list-card flex cursor-pointer items-center gap-2 px-3 py-2",
                toneBorder[STATUS_META[status].tone],
                !selectable && "opacity-95",
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
              {selectable && (
                <Checkbox
                  checked={selectedIds.has(row.id)}
                  disabled={Boolean(bulkAction)}
                  onCheckedChange={(checked) =>
                    setSelectedIds((current) => {
                      const next = new Set(current);
                      if (checked) next.add(row.id);
                      else next.delete(row.id);
                      return next;
                    })
                  }
                  className="h-5 w-5 shrink-0 rounded-full [&_svg]:h-3.5 [&_svg]:w-3.5"
                  onClick={(event) => event.stopPropagation()}
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold leading-tight">
                    {row.employee_code || "-"} · {row.company || "Chưa có nhà máy"} - {row.full_name || "-"}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1">
                    {editingAmountId === row.id ? (
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <Input
                          value={editAmountText}
                          onChange={(e) => setEditAmountText(formatMoneyInput(e.target.value))}
                          inputMode="numeric"
                          className="h-7 w-28 text-sm font-bold"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveEditedAmount(row);
                            if (e.key === "Escape") setEditingAmountId(null);
                          }}
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          onClick={() => saveEditedAmount(row)}
                        >
                          <Check className="h-3.5 w-3.5 text-green-600" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          onClick={() => setEditingAmountId(null)}
                        >
                          <X className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    ) : (
                      <>
                        <span className="text-sm font-bold leading-tight text-primary">
                          {formatMoney(row.amount)}
                        </span>
                        {row.original_amount && row.original_amount !== row.amount && (
                          <span className="text-[11px] text-muted-foreground line-through">
                            {formatMoney(row.original_amount)}
                          </span>
                        )}
                        {canAdminResolve && (
                          <button
                            type="button"
                            className="ml-0.5 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                            title="Sửa số tiền"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingAmountId(row.id);
                              setEditAmountText(formatMoneyInput(String(row.amount)));
                            }}
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  <div className="truncate text-[11px] leading-tight text-muted-foreground">
                    Báo ứng: {requesterName}
                  </div>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground">
                    {new Date(row.created).toLocaleString("vi-VN")}
                  </span>
                  <StatusChip tone={STATUS_META[status].tone}>
                    {STATUS_META[status].label}
                  </StatusChip>
                  <StatusChip tone={payoutMethod === "cash" ? "warning" : "neutral"}>
                    {PAYOUT_METHOD_META[payoutMethod].label}
                  </StatusChip>
                  {status === "accepted" && (
                    <StatusChip tone={row.disbursed ? "success" : "warning"}>
                      {row.disbursed ? "Đã giải ngân" : "Chưa giải ngân"}
                    </StatusChip>
                  )}
                  {recovery !== "none" && (
                    <StatusChip tone={RECOVERY_META[recovery].tone as any}>
                      {RECOVERY_META[recovery].label}
                    </StatusChip>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {canAdminResolve && (
                  <>
                    <Button
                      size="icon"
                      className="h-8 w-8"
                      title="Tiếp nhận"
                      aria-label="Tiếp nhận ứng lương"
                      onClick={(event) => {
                        event.stopPropagation();
                        adminResolve(row, "accepted");
                      }}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="destructive"
                      className="h-8 w-8"
                      title="Từ chối"
                      aria-label="Từ chối ứng lương"
                      onClick={(event) => {
                        event.stopPropagation();
                        adminResolve(row, "rejected");
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
                {canRecover && (
                  <>
                    <Button
                      size="icon"
                      className="h-8 w-8"
                      title="Thu hồi"
                      aria-label="Đánh dấu đã thu hồi"
                      onClick={(event) => {
                        event.stopPropagation();
                        resolveRecovery(row, "recovered");
                      }}
                    >
                      <ShieldCheck className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-8 w-8"
                      title="Không thu hồi"
                      aria-label="Đánh dấu không thu hồi"
                      onClick={(event) => {
                        event.stopPropagation();
                        resolveRecovery(row, "unrecoverable");
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
                {canUndoRecovery && (
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-8 w-8 border-amber-300 text-amber-700 hover:bg-amber-50 hover:text-amber-800"
                    title="Hoàn tác về Đã tiếp nhận"
                    aria-label="Hoàn tác trạng thái thu hồi về Đã tiếp nhận"
                    onClick={(event) => {
                      event.stopPropagation();
                      requestAdvanceUndo(row, "recovery");
                    }}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                )}
                {canUndoRejection && (
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-8 w-8 border-amber-300 text-amber-700 hover:bg-amber-50 hover:text-amber-800"
                    title="Hoàn tác về Chờ duyệt"
                    aria-label="Hoàn tác từ chối về Chờ duyệt"
                    onClick={(event) => {
                      event.stopPropagation();
                      requestAdvanceUndo(row, "rejection");
                    }}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          );
        })
      )}

      <AdvanceDetailDialog
        advanceDetail={advanceDetail}
        setAdvanceDetail={setAdvanceDetail}
        items={filtered}
        isAdmin={isAdmin}
        actor={user}
        adminNoteDraft={adminNoteDraft}
        setAdminNoteDraft={setAdminNoteDraft}
        recoveryNoteDraft={recoveryNoteDraft}
        setRecoveryNoteDraft={setRecoveryNoteDraft}
        transferDescriptionTemplate={transferDescriptionTemplate}
        savingNotes={savingNotes}
        setSavingNotes={setSavingNotes}
        updateRow={updateRow}
        setDisbursed={setDisbursed}
        requestAdvanceUndo={requestAdvanceUndo}
        load={load}
      />

      <Dialog
        open={advanceSettingOpen}
        onOpenChange={(open) => {
          if (!advanceSettingSaving) setAdvanceSettingOpen(open);
        }}
      >
        <DialogContent layout="raw" className="w-[calc(100%-2rem)] max-w-md rounded-2xl">
          <DialogHeader>
            <div
              className={cn(
                "flex h-11 w-11 items-center justify-center rounded-full",
                advanceReportingEnabled
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-amber-100 text-amber-700",
              )}
            >
              <ShieldCheck className="h-5 w-5" />
            </div>
            <DialogTitle>Cho phép User/Staff thao tác báo ứng</DialogTitle>
            <DialogDescription>
              Bật hoặc chuyển toàn bộ chức năng báo ứng của User và Staff sang chế độ chỉ xem.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between gap-3 rounded-xl border bg-muted/30 p-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold">
                {advanceReportingEnabled ? "Đang cho phép thao tác" : "Đang ở chế độ chỉ xem"}
              </div>
              <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {advanceReportingEnabled
                  ? "User và Staff có thể tạo, duyệt hoặc thu hồi yêu cầu theo quyền."
                  : "User và Staff chỉ có thể xem, tìm kiếm và lọc dữ liệu báo ứng."}
              </div>
            </div>
            <Switch
              checked={advanceReportingEnabled}
              disabled={advanceSettingSaving}
              onCheckedChange={(checked) => {
                if (checked) void saveAdvanceReportingEnabled(true);
                else setDisableConfirmationOpen(true);
              }}
              aria-label="Cho phép User và Staff thao tác báo ứng"
            />
          </div>

          <div className="rounded-xl border border-primary/15 bg-primary/5 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            Admin luôn có đầy đủ quyền tạo, duyệt, chỉnh sửa, giải ngân và thu hồi báo ứng.
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={disableConfirmationOpen}
        onOpenChange={(open) => {
          if (!advanceSettingSaving) setDisableConfirmationOpen(open);
        }}
      >
        <AlertDialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-2xl">
          <AlertDialogHeader>
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-amber-100 text-amber-700 sm:mx-0">
              <TriangleAlert className="h-5 w-5" />
            </div>
            <AlertDialogTitle>Chuyển User và Staff sang chế độ chỉ xem?</AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed">
              User và Staff sẽ không thể tạo, duyệt, từ chối hoặc thu hồi yêu cầu báo ứng. Dữ liệu
              hiện có vẫn được giữ nguyên và Admin vẫn có toàn quyền xử lý.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={advanceSettingSaving}>Hủy</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 text-white hover:bg-amber-700"
              disabled={advanceSettingSaving}
              onClick={(event) => {
                event.preventDefault();
                void saveAdvanceReportingEnabled(false);
              }}
            >
              {advanceSettingSaving ? "Đang lưu…" : "Xác nhận tắt thao tác"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!undoRequest}
        onOpenChange={(open) => {
          if (!open && !undoing) setUndoRequest(null);
        }}
      >
        <AlertDialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-2xl">
          <AlertDialogHeader>
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-amber-100 text-amber-700 sm:mx-0">
              <TriangleAlert className="h-5 w-5" />
            </div>
            <AlertDialogTitle>Xác nhận hoàn tác</AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed">
              {undoRequest?.kind === "recovery" ? (
                <>
                  Bạn đang đưa yêu cầu của{" "}
                  <strong>{undoRequest.row.full_name || "người lao động"}</strong> từ “
                  {undoRequest.row.recovery_status === "recovered"
                    ? "Đã thu hồi"
                    : "Không thể thu hồi"}
                  ” về “Đã tiếp nhận”. Ngày thu hồi sẽ được xóa, các thông tin giải ngân và ghi chú
                  vẫn được giữ nguyên.
                </>
              ) : (
                <>
                  Bạn đang đưa yêu cầu đã từ chối của{" "}
                  <strong>{undoRequest?.row.full_name || "người lao động"}</strong> về “Chờ duyệt”.
                  Admin có thể tiếp nhận hoặc từ chối lại yêu cầu này.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={undoing}>Hủy</AlertDialogCancel>
            <AlertDialogAction
              className="gap-2 bg-amber-600 text-white hover:bg-amber-700"
              disabled={undoing}
              onClick={(event) => {
                event.preventDefault();
                void confirmAdvanceUndo();
              }}
            >
              <RotateCcw className="h-4 w-4" />
              {undoing ? "Đang hoàn tác…" : "Xác nhận hoàn tác"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}

function AdvanceDetailDialog({
  advanceDetail,
  setAdvanceDetail,
  items,
  isAdmin,
  actor,
  adminNoteDraft,
  setAdminNoteDraft,
  recoveryNoteDraft,
  setRecoveryNoteDraft,
  transferDescriptionTemplate,
  savingNotes,
  setSavingNotes,
  updateRow,
  setDisbursed,
  requestAdvanceUndo,
  load,
}: {
  advanceDetail: AdvanceRecord | null;
  setAdvanceDetail: (v: AdvanceRecord | null) => void;
  items: AdvanceRecord[];
  isAdmin: boolean;
  actor: UserRecord | null;
  adminNoteDraft: string;
  setAdminNoteDraft: (v: string) => void;
  recoveryNoteDraft: string;
  setRecoveryNoteDraft: (v: string) => void;
  transferDescriptionTemplate: string;
  savingNotes: boolean;
  setSavingNotes: (v: boolean) => void;
  updateRow: (id: string, payload: Partial<AdvanceRecord>) => Promise<void>;
  setDisbursed: (row: AdvanceRecord, disbursed: boolean) => Promise<boolean>;
  requestAdvanceUndo: (row: AdvanceRecord, kind: AdvanceUndoKind) => void;
  load: () => void;
}) {
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);
  const advanceDetailIdRef = useRef<string | null>(null);
  const activeQrKeyRef = useRef<string | null>(null);
  const disbursingIdRef = useRef<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [loadedQrKey, setLoadedQrKey] = useState<string | null>(null);
  const [failedQrKey, setFailedQrKey] = useState<string | null>(null);
  const [qrRetry, setQrRetry] = useState(0);
  const [disbursingId, setDisbursingId] = useState<string | null>(null);
  const [bankEditOpen, setBankEditOpen] = useState(false);
  const [savingBank, setSavingBank] = useState(false);
  const [bankDraft, setBankDraft] = useState({
    bank_name: "",
    bank_account_number: "",
    bank_account_name: "",
  });

  useLayoutEffect(() => {
    advanceDetailIdRef.current = advanceDetail?.id || null;
    setShowQr(false);
    setLoadedQrKey(null);
    setFailedQrKey(null);
    setQrRetry(0);
    setBankEditOpen(false);
    setSavingBank(false);
  }, [advanceDetail?.id]);

  const status = advanceDetail?.status;
  const recovery = (advanceDetail?.recovery_status || "none") as RecoveryStatus;
  const payoutMethod = normalizeAdvancePayoutMethod(advanceDetail?.payout_method);
  const disbursed = Boolean(advanceDetail?.disbursed);
  const isAcceptedTabStatus = status === "accepted" && recovery === "none";
  const canDisburse = isAdmin && isAcceptedTabStatus && !disbursed;
  const canUndoRecovery = isAdmin && status === "accepted" && recovery !== "none";
  const canUndoRejection = isAdmin && status === "rejected";
  const qrUrl = useMemo(() => {
    if (!advanceDetail || payoutMethod !== "bank_transfer" || !isAcceptedTabStatus) return null;
    return buildVietQrUrl({
      bankName: advanceDetail.bank_name || "",
      accountNumber: advanceDetail.bank_account_number || "",
      accountName: advanceDetail.bank_account_name,
      amount: advanceDetail.amount,
      description: buildTransferDescription(transferDescriptionTemplate, advanceDetail.full_name),
    });
  }, [advanceDetail, isAcceptedTabStatus, payoutMethod, transferDescriptionTemplate]);
  const qrKey =
    advanceDetail && qrUrl
      ? [
          advanceDetail.id,
          qrUrl,
          advanceDetail.bank_name || "",
          advanceDetail.bank_account_number || "",
          advanceDetail.amount,
          buildTransferDescription(transferDescriptionTemplate, advanceDetail.full_name),
          qrRetry,
        ].join(":")
      : null;
  advanceDetailIdRef.current = advanceDetail?.id || null;
  activeQrKeyRef.current = qrKey;
  const qrImageUrl =
    qrUrl && qrRetry > 0 ? `${qrUrl}${qrUrl.includes("?") ? "&" : "?"}_retry=${qrRetry}` : qrUrl;
  const qrReady = Boolean(qrKey && loadedQrKey === qrKey);
  const qrFailed = Boolean(qrKey && failedQrKey === qrKey);
  const isDisbursing = Boolean(advanceDetail && disbursingId === advanceDetail.id);
  const canSubmitDisbursement = canDisburse && !isDisbursing;

  const currentIndex = useMemo(() => {
    if (!advanceDetail) return -1;
    return items.findIndex((row) => row.id === advanceDetail.id);
  }, [advanceDetail, items]);

  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < items.length - 1;

  const resetQrState = useCallback(() => {
    activeQrKeyRef.current = null;
    setShowQr(false);
    setLoadedQrKey(null);
    setFailedQrKey(null);
    setQrRetry(0);
    setBankEditOpen(false);
  }, []);

  const goPrev = useCallback(() => {
    if (!hasPrev) return;
    resetQrState();
    setAdvanceDetail(items[currentIndex - 1]);
  }, [hasPrev, items, currentIndex, resetQrState, setAdvanceDetail]);

  const goNext = useCallback(() => {
    if (!hasNext) return;
    resetQrState();
    setAdvanceDetail(items[currentIndex + 1]);
  }, [hasNext, items, currentIndex, resetQrState, setAdvanceDetail]);

  const disburseAndGoNext = useCallback(async () => {
    const row = advanceDetail;
    if (!row || !canDisburse || disbursingIdRef.current) return;

    disbursingIdRef.current = row.id;
    setDisbursingId(row.id);
    try {
      const succeeded = await setDisbursed(row, true);
      if (succeeded && advanceDetailIdRef.current === row.id) {
        goNext();
      }
    } finally {
      if (disbursingIdRef.current === row.id) disbursingIdRef.current = null;
      setDisbursingId((current) => (current === row.id ? null : current));
    }
  }, [advanceDetail, canDisburse, goNext, setDisbursed]);

  useEffect(() => {
    if (!advanceDetail) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (bankEditOpen) return;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      ) {
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (e.repeat || isDisbursing) return;
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (e.repeat || isDisbursing) return;
        if (canDisburse && advanceDetail) {
          void disburseAndGoNext();
        } else {
          goNext();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [advanceDetail, bankEditOpen, canDisburse, disburseAndGoNext, goPrev, goNext, isDisbursing]);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchEndX.current = e.touches[0].clientX;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    touchEndX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = () => {
    if (isDisbursing) return;
    const diff = touchStartX.current - touchEndX.current;
    const threshold = 50;
    if (diff > threshold) goNext();
    else if (diff < -threshold) goPrev();
  };

  const openBankEditor = useCallback(() => {
    if (!advanceDetail) return;
    setBankDraft({
      bank_name: advanceDetail.bank_name || "",
      bank_account_number: advanceDetail.bank_account_number || "",
      bank_account_name: advanceDetail.bank_account_name || "",
    });
    setBankEditOpen(true);
  }, [advanceDetail]);

  const saveBankDetails = useCallback(async () => {
    const row = advanceDetail;
    if (!row || !isAdmin || savingBank) return;

    const payload: Partial<AdvanceRecord> = {
      bank_name: bankDraft.bank_name.trim(),
      bank_account_number: bankDraft.bank_account_number.trim(),
      bank_account_name: bankDraft.bank_account_name.trim(),
    };
    setSavingBank(true);
    try {
      await updateRow(row.id, payload);
      try {
        await createStaffActionLog({
          actor,
          targetUserId: row.worker,
          targetCollection: "advances",
          targetRecord: row.id,
          action: "update",
          before: {
            bank_name: row.bank_name || "",
            bank_account_number: row.bank_account_number || "",
            bank_account_name: row.bank_account_name || "",
          },
          after: payload,
          note: "Admin sửa tài khoản nhận báo ứng",
        });
      } catch {
        toast.warning("Đã cập nhật STK nhưng chưa ghi được nhật ký");
      }
      if (advanceDetailIdRef.current === row.id) {
        resetQrState();
        setAdvanceDetail({ ...row, ...payload });
        setBankEditOpen(false);
      }
      toast.success("Đã cập nhật STK nhận tiền của card");
      load();
    } catch (error: unknown) {
      toast.error(getUserErrorMessage(error, "Lỗi cập nhật STK nhận tiền"));
    } finally {
      setSavingBank(false);
    }
  }, [
    actor,
    advanceDetail,
    bankDraft,
    isAdmin,
    load,
    resetQrState,
    savingBank,
    setAdvanceDetail,
    updateRow,
  ]);

  const disbursementHint =
    canDisburse || isDisbursing
      ? isDisbursing
        ? "Đang xác nhận giải ngân..."
        : payoutMethod === "bank_transfer" && (!qrUrl || qrFailed)
          ? "QR lỗi · Bấm → để vẫn đánh dấu đã giải ngân"
          : payoutMethod === "bank_transfer" && !qrReady
            ? "Đang tải QR · Bấm → để đánh dấu đã giải ngân"
            : "Bấm → để đánh dấu đã giải ngân"
      : "Vuốt hoặc bấm mũi tên để chuyển";

  const qrBlock =
    qrUrl && qrKey ? (
      <div
        key={`${advanceDetail.id}:${qrKey}`}
        className="mt-3 flex flex-col items-center gap-2 rounded-xl border border-dashed border-primary/30 bg-primary/5 p-3"
      >
        <div className="text-[11px] font-semibold text-primary">Mã QR chuyển khoản</div>
        <div className="relative flex h-52 w-52 items-center justify-center overflow-hidden rounded-lg bg-background">
          {!qrReady && !qrFailed && (
            <div
              className="flex flex-col items-center gap-2 px-4 text-center text-xs text-muted-foreground"
              role="status"
              aria-live="polite"
            >
              <RotateCcw className="h-5 w-5 animate-spin text-primary" />
              Đang tải mã QR của record hiện tại...
            </div>
          )}
          {qrFailed && (
            <div
              className="flex flex-col items-center gap-2 px-4 text-center text-xs text-destructive"
              role="alert"
            >
              <TriangleAlert className="h-5 w-5" />
              Không tải được mã QR. Hãy kiểm tra lại thông tin nhận tiền trước khi chuyển khoản.
              {isAdmin && (
                <Button type="button" size="sm" variant="outline" onClick={openBankEditor}>
                  <Pencil className="h-3.5 w-3.5" /> Sửa STK nhận tiền
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setLoadedQrKey(null);
                  setFailedQrKey(null);
                  setQrRetry((current) => current + 1);
                }}
              >
                <RotateCcw className="h-3.5 w-3.5" /> Tải lại mã QR
              </Button>
            </div>
          )}
          <img
            key={qrKey}
            src={qrImageUrl || qrUrl}
            alt={`Mã QR chuyển khoản cho ${advanceDetail?.full_name || "người lao động"}`}
            className={cn(
              "h-52 w-52 rounded-lg transition-opacity",
              qrReady ? "opacity-100" : "pointer-events-none absolute inset-0 opacity-0",
            )}
            loading="eager"
            fetchPriority="high"
            onLoad={() => {
              if (
                advanceDetailIdRef.current !== advanceDetail?.id ||
                activeQrKeyRef.current !== qrKey
              ) {
                return;
              }
              setFailedQrKey(null);
              setLoadedQrKey(qrKey);
            }}
            onError={() => {
              if (
                advanceDetailIdRef.current !== advanceDetail?.id ||
                activeQrKeyRef.current !== qrKey
              ) {
                return;
              }
              setLoadedQrKey(null);
              setFailedQrKey(qrKey);
            }}
          />
        </div>
        <div className="text-center text-[11px] text-muted-foreground">
          Record hiện tại: {advanceDetail?.full_name || "-"} ·{" "}
          {formatMoney(advanceDetail?.amount || 0)} VND
        </div>
      </div>
    ) : null;

  return (
    <Dialog open={!!advanceDetail} onOpenChange={(open) => !open && setAdvanceDetail(null)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle>Chi tiết ứng lương</DialogTitle>
          <DialogDescription>
            {currentIndex >= 0 && items.length > 1
              ? `${currentIndex + 1} / ${items.length}`
              : "Thông tin đầy đủ của yêu cầu ứng lương."}
          </DialogDescription>
        </DialogHeader>

        {(items.length > 1 || canDisburse || isDisbursing) && (
          <div className="flex items-center justify-between gap-2">
            <Button
              size="icon"
              variant="outline"
              className="h-9 w-9 shrink-0 rounded-full"
              disabled={!hasPrev || isDisbursing}
              onClick={goPrev}
              aria-label="Card trước"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-center text-xs text-muted-foreground">{disbursementHint}</span>
            {canDisburse || isDisbursing ? (
              <Button
                size="icon"
                className="h-9 w-9 shrink-0 rounded-full"
                disabled={!canSubmitDisbursement}
                onClick={() => void disburseAndGoNext()}
                aria-label="Đánh dấu đã giải ngân và sang card tiếp"
                title="Đánh dấu đã giải ngân và sang card tiếp"
              >
                {isDisbursing ? (
                  <RotateCcw className="h-4 w-4 animate-spin" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </Button>
            ) : (
              <Button
                size="icon"
                variant="outline"
                className="h-9 w-9 shrink-0 rounded-full"
                disabled={!hasNext}
                onClick={goNext}
                aria-label="Card tiếp theo"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        )}

        {advanceDetail && (
          <div
            className="space-y-3"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            {" "}
            <div className="rounded-xl border bg-muted/30 p-3">
              <div className="text-sm font-semibold">{advanceDetail.full_name || "-"}</div>
              <div className="text-[11px] text-muted-foreground">
                {[advanceDetail.employee_code, advanceDetail.company].filter(Boolean).join(" - ") ||
                  "-"}
                {advanceDetail.phone && (
                  <>
                    {" - "}
                    <a
                      href={`tel:${advanceDetail.phone.replace(/\s/g, "")}`}
                      className="font-medium text-primary underline-offset-2 hover:underline"
                    >
                      {advanceDetail.phone}
                    </a>
                  </>
                )}
              </div>
              <div className="mt-2 text-2xl font-bold text-primary">
                {formatMoney(advanceDetail.amount)}
                {advanceDetail.original_amount &&
                  advanceDetail.original_amount !== advanceDetail.amount && (
                    <span className="ml-2 text-sm font-normal text-muted-foreground line-through">
                      {formatMoney(advanceDetail.original_amount)}
                    </span>
                  )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5 text-sm">
              <AdvanceDetailCell
                label="Người báo ứng"
                value={getAdvanceRequesterName(advanceDetail)}
              />
              <AdvanceDetailCell
                label="TT người báo"
                value={getAdvanceRequesterMeta(advanceDetail)}
              />
              <AdvanceDetailCell
                label="Trạng thái"
                value={STATUS_META[(advanceDetail.status || "pending") as AdvanceStatus].label}
              />
              <AdvanceDetailCell
                label="Thu hồi"
                value={
                  RECOVERY_META[(advanceDetail.recovery_status || "none") as RecoveryStatus].label
                }
              />
              <AdvanceDetailCell label="Ngày gửi" value={formatDateTime(advanceDetail.created)} />
              <AdvanceDetailCell
                label="Ngày xử lý"
                value={formatDateTime(advanceDetail.resolved_at)}
              />
              {advanceDetail.status === "accepted" && (
                <AdvanceDetailCell
                  label="Ngày giải ngân"
                  value={formatDateTime(advanceDetail.disbursed_at)}
                />
              )}
              <AdvanceDetailCell
                label="Ngày thu hồi"
                value={formatDateTime(advanceDetail.recovered_at)}
              />
            </div>
            {isAdmin && (canUndoRecovery || canUndoRejection) && (
              <Button
                type="button"
                variant="outline"
                className="w-full gap-2 border-amber-300 text-amber-700 hover:bg-amber-50 hover:text-amber-800"
                onClick={() =>
                  requestAdvanceUndo(advanceDetail, canUndoRecovery ? "recovery" : "rejection")
                }
              >
                <RotateCcw className="h-4 w-4" />
                {canUndoRecovery ? "Hoàn tác về Đã tiếp nhận" : "Hoàn tác về Chờ duyệt"}
              </Button>
            )}
            <div className="rounded-xl border bg-card p-3 text-sm">
              <div className="text-[11px] text-muted-foreground">Hình thức nhận tiền</div>
              <div className="mt-1 font-medium">{PAYOUT_METHOD_META[payoutMethod].label}</div>
              {payoutMethod === "cash" ? (
                <div className="mt-0.5 text-muted-foreground">
                  Nhận tiền trực tiếp, không tạo mã QR.
                </div>
              ) : (
                <>
                  <div className="mt-1 font-medium">{advanceDetail.bank_name || "-"}</div>
                  <div className="mt-0.5 text-muted-foreground">
                    {advanceDetail.bank_account_number || "-"} -{" "}
                    {advanceDetail.bank_account_name || "-"}
                  </div>
                </>
              )}
              {payoutMethod === "bank_transfer" && isAcceptedTabStatus && !qrUrl && (
                <div className="mt-3 space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                  <div className="flex items-start gap-2">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    Không nhận diện được mã ngân hàng. Bạn có thể sửa STK hoặc vẫn đánh dấu đã giải
                    ngân.
                  </div>
                  {isAdmin && (
                    <Button type="button" size="sm" variant="outline" onClick={openBankEditor}>
                      <Pencil className="h-3.5 w-3.5" /> Sửa STK nhận tiền
                    </Button>
                  )}
                </div>
              )}
              {payoutMethod === "bank_transfer" &&
                isAcceptedTabStatus &&
                qrUrl &&
                (!disbursed ? (
                  qrBlock
                ) : (
                  <>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => setShowQr((v) => !v)}>
                        {showQr ? "Ẩn mã QR" : "Xem mã QR"}
                      </Button>
                      {isAdmin && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-amber-600 hover:text-amber-700"
                          onClick={async () => {
                            await setDisbursed(advanceDetail, false);
                          }}
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> Hoàn tác giải ngân
                        </Button>
                      )}
                    </div>
                    {showQr && qrBlock}
                  </>
                ))}
            </div>
            <AdvanceTextBlock label="Lý do ứng" value={advanceDetail.reason} />
            {isAdmin ? (
              <form
                className="space-y-0"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!advanceDetail) return;
                  setSavingNotes(true);
                  (async () => {
                    try {
                      const payload: Partial<AdvanceRecord> = {
                        admin_note: adminNoteDraft,
                      };
                      if (advanceDetail.status === "accepted") {
                        payload.recovery_note = recoveryNoteDraft;
                      }
                      await updateRow(advanceDetail.id, payload);
                      toast.success("Đã lưu ghi chú");
                      setAdvanceDetail({ ...advanceDetail, ...payload });
                      load();
                    } catch (error: unknown) {
                      toast.error(getUserErrorMessage(error, "Lỗi lưu ghi chú"));
                    } finally {
                      setSavingNotes(false);
                    }
                  })();
                }}
              >
                <div className="rounded-xl border bg-card p-3 text-sm">
                  <Label className="text-[11px] text-muted-foreground">Ghi chú admin</Label>
                  <Textarea
                    rows={3}
                    value={adminNoteDraft}
                    onChange={(e) => setAdminNoteDraft(e.target.value)}
                    className="mt-1"
                    placeholder="Lý do duyệt/từ chối, ghi chú nội bộ…"
                  />
                </div>
                {advanceDetail.status === "accepted" && (
                  <div className="rounded-xl border bg-card p-3 text-sm">
                    <Label className="text-[11px] text-muted-foreground">Ghi chú thu hồi</Label>
                    <Textarea
                      rows={3}
                      value={recoveryNoteDraft}
                      onChange={(e) => setRecoveryNoteDraft(e.target.value)}
                      className="mt-1"
                      placeholder="Tình trạng thu hồi, lý do không thu hồi…"
                    />
                  </div>
                )}
                <Button
                  type="submit"
                  className="mt-3 w-full"
                  disabled={
                    savingNotes ||
                    (adminNoteDraft === (advanceDetail.admin_note || "") &&
                      recoveryNoteDraft === (advanceDetail.recovery_note || ""))
                  }
                >
                  {savingNotes ? "Đang lưu…" : "Lưu ghi chú"}
                </Button>
              </form>
            ) : (
              <>
                <AdvanceTextBlock label="Ghi chú admin" value={advanceDetail.admin_note} />
                <AdvanceTextBlock label="Ghi chú thu hồi" value={advanceDetail.recovery_note} />
              </>
            )}
          </div>
        )}
        <Dialog open={bankEditOpen} onOpenChange={setBankEditOpen}>
          <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl">
            <DialogHeader>
              <DialogTitle>Sửa STK nhận tiền</DialogTitle>
              <DialogDescription>
                Chỉ thay đổi thông tin của card báo ứng hiện tại, không sửa hồ sơ người dùng.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Ngân hàng hoặc mã ngân hàng</Label>
                <BankPicker
                  value={bankDraft.bank_name}
                  onChange={(value) =>
                    setBankDraft((current) => ({ ...current, bank_name: value }))
                  }
                  disabled={savingBank}
                />
                <p className="text-[11px] text-muted-foreground">
                  Chỉ dùng mã chính xác, ví dụ ICB hoặc MB.
                </p>
              </div>
              <div className="space-y-1">
                <Label>Số tài khoản</Label>
                <Input
                  value={bankDraft.bank_account_number}
                  inputMode="numeric"
                  onChange={(e) =>
                    setBankDraft((current) => ({
                      ...current,
                      bank_account_number: e.target.value.replace(/\D/g, ""),
                    }))
                  }
                  disabled={savingBank}
                />
              </div>
              <div className="space-y-1">
                <Label>Tên chủ tài khoản</Label>
                <Input
                  value={bankDraft.bank_account_name}
                  onChange={(e) =>
                    setBankDraft((current) => ({ ...current, bank_account_name: e.target.value }))
                  }
                  disabled={savingBank}
                />
              </div>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => setBankEditOpen(false)}
                disabled={savingBank}
              >
                Huỷ
              </Button>
              <Button type="button" onClick={() => void saveBankDetails()} disabled={savingBank}>
                {savingBank ? "Đang lưu…" : "Lưu STK"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

function AdvanceDetailCell({ label, value }: { label: string; value?: ReactNode }) {
  return (
    <div className="rounded-lg bg-muted/40 px-2.5 py-1.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="break-words text-xs font-medium">{value || "-"}</div>
    </div>
  );
}

function AdvanceTextBlock({ label, value }: { label: string; value?: string }) {
  if (!value?.trim()) return null;
  return (
    <div className="rounded-xl border bg-card p-3 text-sm">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-1 whitespace-pre-wrap leading-relaxed">{value}</div>
    </div>
  );
}

function formatDateTime(value?: string) {
  return value ? new Date(value).toLocaleString("vi-VN") : "-";
}

function getAdvanceRequesterName(row: AdvanceRecord) {
  const requester = row.expand?.requested_by;
  if (requester) {
    return requester.full_name || requester.username || requester.phone || row.requested_by || "-";
  }
  if (row.requested_by && row.worker && row.requested_by === row.worker) {
    return row.full_name || row.employee_code || row.phone || "-";
  }
  return row.requested_by || "-";
}

function getAdvanceRequesterMeta(row: AdvanceRecord) {
  const requester = row.expand?.requested_by;
  if (requester) {
    return [requester.phone].filter(Boolean).join(" - ") || "-";
  }
  if (row.requested_by && row.worker && row.requested_by === row.worker) {
    return [row.employee_code, row.company, row.phone].filter(Boolean).join(" - ") || "-";
  }
  return row.requested_by || "-";
}

function getAdvanceRequesterField(
  row: AdvanceRecord,
  field: "employee_code" | "company" | "phone",
) {
  if (row.requested_by && row.worker && row.requested_by === row.worker) return row[field] || "";
  return field === "phone" ? row.expand?.requested_by?.phone || "" : "";
}

function AdvanceRulesCard({ rules, compact = false }: { rules?: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const content = rules?.trim();
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "border border-amber-300 bg-amber-50 text-amber-900 shadow-soft transition active:scale-[0.98]",
          compact
            ? "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold"
            : "flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-left",
        )}
      >
        {compact ? (
          <>
            <TriangleAlert className="h-3.5 w-3.5" />
            Nội quy ứng lương
          </>
        ) : (
          <>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-200 text-amber-800">
              <TriangleAlert className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold leading-tight">Nội quy Ứng lương</span>
              <span className="block truncate text-[11px] leading-tight text-amber-800/80">
                Bấm để xem quy định từ admin
              </span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0" />
          </>
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent layout="raw" className="max-h-[80dvh] overflow-hidden rounded-2xl">
          <DialogHeader>
            <DialogTitle>Nội quy Ứng lương</DialogTitle>
            <DialogDescription>Quy định do admin thiết lập.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[55dvh] overflow-y-auto whitespace-pre-wrap rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-relaxed text-amber-950">
            {content || "Admin chưa thiết lập nội quy Ứng lương."}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ReadOnlyField({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div className="rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-sm text-foreground">
        {value?.trim() || "—"}
      </div>
    </div>
  );
}

function UserProfileCollapsible({
  user,
  policy,
}: {
  user: UserRecord | null;
  policy: AdvancePolicy | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-medium"
      >
        <span>Thông tin người báo ứng</span>
        <span className="text-xs text-muted-foreground">{open ? "Thu gọn" : "Xem"}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t px-3 pb-3 pt-2">
          <ReadOnlyField label="Họ và tên" value={user?.full_name} />
          <ReadOnlyField
            label="Nhà máy theo lịch sử gần nhất"
            value={policy?.factoryName || "Chưa xác định được nhà máy"}
          />
          <ReadOnlyField label="Mã nhân viên" value={policy?.employment.employee_code} />
          <ReadOnlyField label="Số điện thoại liên hệ" value={user?.phone} />
        </div>
      )}
    </div>
  );
}
