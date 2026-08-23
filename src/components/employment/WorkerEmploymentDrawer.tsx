import { useEffect, useMemo, useState } from "react";
import { WorkerPayrollDialog } from "@/components/payroll/WorkerPayrollView";
import {
  CalendarRange,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock3,
  Hash,
  IdCard,
  Landmark,
  Plus,
  ZoomIn,
  RotateCcw,
  Trash2,
  Wallet,
} from "lucide-react";
import { companyPayload } from "@/lib/tenant";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { StatusChip } from "@/components/ui/status-chip";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fileUrl, pb, type UserRecord } from "@/lib/pocketbase";
import { useAppSettings } from "@/lib/app-settings";
import { formatMoneyInput, parseMoneyInput } from "@/lib/money";
import {
  assertAdvanceInteractionAllowed,
  isAdvanceInteractionAllowed,
  resolveAdvancePolicy,
  validateAdvanceAmount,
  type AdvancePolicy,
} from "@/lib/advance-policy";
import {
  createEmploymentHistory,
  fetchEmploymentHistories,
  getCurrentEmploymentHistory,
  getLatestEmploymentHistory,
  getStaleWorkingEmploymentHistories,
  isEmploymentUserUniqueError,
  getMissingEmploymentEditFields,
  getMissingEmploymentSnapshotFields,
  getEmploymentPersonalSnapshot,
  isCurrentlyWorking,
  maskCccd,
  restoreEmploymentHistoryToWorking,
  updateEmploymentHistory,
  updateUserAndCache,
  type EmploymentHistoryRecord,
} from "@/lib/employment";
import type { FactoryRecord } from "@/lib/factories";
import type { MainHouseRecord } from "@/lib/main-houses";
import { canReportJoin, canViewHistoryInStaffScope } from "@/lib/staff-permissions";
import {
  createStaffActionLog,
  fetchWorkerActionHistory,
  type WorkerActionHistoryRecord,
} from "@/lib/staff-log";
import { StaffActionHistoryPanel } from "@/components/employment/StaffActionHistoryPanel";
import { CccdManager } from "@/components/cccd/CccdManager";
import { JoinCccdSection } from "@/components/employment/JoinCccdSection";
import { BankPicker } from "@/components/staff/BankNameInput";
import {
  findOrCreateCccdVersion,
  getCccdVersionByNumber,
  getCurrentCccdVersion,
  updateCccdVersionImages,
  type CccdVersionRecord,
} from "@/lib/cccd-versions";
import { compressImage } from "@/lib/image-compress";
import { AdvancePayoutMethodPicker } from "@/components/advances/AdvancePayoutMethodPicker";
import { AdvanceReadOnlyNotice } from "@/components/advances/AdvanceReadOnlyNotice";
import { RecruiterPicker } from "@/components/employment/RecruiterPicker";
import { FactoryPicker, MainHousePicker } from "@/components/workforce/UserPicker";
import {
  buildRecruiterPayload,
  encodeInternalRecruiter,
  getRecruiterDisplay,
  recruiterSelectionFromHistory,
  type RecruiterSelectionValue,
} from "@/lib/recruiters";
import type { AdvancePayoutMethod } from "@/lib/advances";
import { getUserErrorMessage } from "@/lib/toast";
import { filterEmploymentFactories } from "@/lib/staff-employment-scope";

type RestoreRequest = {
  history: EmploymentHistoryRecord;
  source: "action" | "edit";
};

export type WorkerEmploymentPermissions = {
  /** Cho phép sửa từng lịch sử đi làm (mở form edit khi click card). */
  canEditHistory: boolean;
  /** Cho phép bổ sung lịch sử cũ (nút "+"). Hiện chỉ admin. */
  canAddOldHistory: boolean;
  /** Cho phép báo ứng lương cho NLĐ đang đi làm. */
  canReportAdvance: boolean;
  /** Cho phép cập nhật STK ngân hàng của NLĐ. */
  canUpdateBank: boolean;
  /** Cho phép báo nghỉ nhà máy hiện tại. */
  canReportLeave: boolean;
  /** Cho phép báo đi làm nhà máy mới. */
  canReportJoin: boolean;
  /** Cho phép xem công lương của NLĐ. */
  canViewPayroll: boolean;
};

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function formatDate(value?: string) {
  if (!value) return "—";
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : value;
}

function getErrorMessage(error: unknown, fallback: string) {
  return getUserErrorMessage(error, fallback);
}

function versionedCccdUrl(version: CccdVersionRecord | undefined, filename?: string) {
  const url = fileUrl(version, filename);
  if (!url || !version) return "";
  const cacheKey = version.updated || version.id;
  return `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(cacheKey)}`;
}

function normalizeCccdNumber(value?: string) {
  return String(value || "").replace(/\D/g, "");
}

function hasWorkingEmploymentStatus(history: EmploymentHistoryRecord) {
  return isCurrentlyWorking(history);
}

function HistoryCccdImageSlot({
  label,
  url,
  onPreview,
}: {
  label: string;
  url: string;
  onPreview: () => void;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      {url ? (
        <button
          type="button"
          onClick={onPreview}
          className="group relative block aspect-[1.586/1] w-full overflow-hidden rounded-xl border bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label={`Xem ảnh CCCD ${label.toLowerCase()}`}
        >
          <img
            src={url}
            alt={`CCCD ${label.toLowerCase()}`}
            className="h-full w-full object-contain"
          />
          <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-gradient-to-t from-black/65 to-transparent px-2 pb-2 pt-5 text-[11px] font-medium text-white">
            <ZoomIn className="h-3.5 w-3.5" /> Nhấn để xem
          </span>
        </button>
      ) : (
        <div className="flex aspect-[1.586/1] w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border bg-muted/20 text-muted-foreground">
          <IdCard className="h-5 w-5" />
          <span className="text-[11px]">Chưa có ảnh</span>
        </div>
      )}
    </div>
  );
}

function HistoryCccdSnapshot({
  history,
  version,
  loading,
  onPreview,
}: {
  history: EmploymentHistoryRecord;
  version?: CccdVersionRecord;
  loading: boolean;
  onPreview: (src: string, label: string) => void;
}) {
  const frontUrl = versionedCccdUrl(version, version?.front_image);
  const backUrl = versionedCccdUrl(version, version?.back_image);
  return (
    <div className="space-y-2 rounded-xl border border-border/60 p-3">
      <div>
        <div className="text-sm font-semibold">Ảnh CCCD 2 mặt</div>
        <div className="text-[11px] text-muted-foreground">
          {loading
            ? "Đang tìm ảnh theo số CCCD của lịch sử..."
            : "Nhấn vào ảnh để xem kích thước lớn."}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        <HistoryCccdImageSlot
          label="Mặt trước"
          url={frontUrl}
          onPreview={() => onPreview(frontUrl, "CCCD mặt trước")}
        />
        <HistoryCccdImageSlot
          label="Mặt sau"
          url={backUrl}
          onPreview={() => onPreview(backUrl, "CCCD mặt sau")}
        />
      </div>
      {!loading && !frontUrl && !backUrl && (
        <div className="text-[11px] text-muted-foreground">
          Chưa có ảnh CCCD phù hợp với lịch sử này.
        </div>
      )}
    </div>
  );
}

function validateRestoreRequest(histories: EmploymentHistoryRecord[], historyId: string) {
  const target = histories.find((history) => history.id === historyId);
  if (!target) throw new Error("Không tìm thấy bản ghi lịch sử cần khôi phục");

  const otherActive = histories.find(
    (history) => history.id !== historyId && isCurrentlyWorking(history),
  );
  if (otherActive) {
    throw new Error("NLĐ đã có một bản ghi đang làm khác. Vui lòng kiểm tra lại lịch sử đi làm.");
  }

  const latest = getLatestEmploymentHistory(histories);
  if (latest?.id !== historyId) {
    throw new Error("Chỉ được khôi phục bản ghi lịch sử đi làm gần nhất");
  }
  return target;
}

function getPocketBaseFieldErrors(error: unknown) {
  const data =
    typeof error === "object" && error !== null && "data" in error
      ? (error.data as { data?: Record<string, unknown> }).data
      : undefined;
  if (!data) return "";
  const fieldLabels: Record<string, string> = {
    user: "Người lao động",
    front_image: "Ảnh CCCD mặt trước",
    back_image: "Ảnh CCCD mặt sau",
  };
  return Object.entries(data)
    .map(([field, value]) => {
      const message =
        typeof value === "object" && value !== null && "message" in value
          ? String(value.message)
          : String(value);
      return `${fieldLabels[field] || field}: ${message}`;
    })
    .join("; ");
}

type ActionButtonTone = "primary" | "success" | "warning" | "danger" | "info";

const actionButtonToneClasses: Record<ActionButtonTone, { button: string; icon: string }> = {
  primary: {
    button: "border-primary/25 bg-primary/5 hover:bg-primary/10",
    icon: "bg-primary/15 text-primary",
  },
  success: {
    button: "border-success/25 bg-success/5 hover:bg-success/10",
    icon: "bg-success/15 text-success",
  },
  warning: {
    button: "border-warning/25 bg-warning/5 hover:bg-warning/10",
    icon: "bg-warning/15 text-warning",
  },
  danger: {
    button: "border-destructive/25 bg-destructive/5 hover:bg-destructive/10",
    icon: "bg-destructive/15 text-destructive",
  },
  info: {
    button: "border-border/70 bg-card hover:bg-muted/60",
    icon: "bg-primary/10 text-primary",
  },
};

function ActionButton({
  icon: Icon,
  label,
  tone = "info",
  disabled = false,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  tone?: ActionButtonTone;
  disabled?: boolean;
  onClick: () => void;
}) {
  const colors = actionButtonToneClasses[tone];
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex min-h-[64px] min-w-0 disabled:cursor-not-allowed disabled:opacity-50 flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border px-2 py-2 text-center shadow-soft transition-colors active:scale-[0.98] desktop:min-h-9 desktop:w-full desktop:flex-row desktop:justify-start desktop:gap-1.5 desktop:rounded-lg desktop:px-2.5 desktop:py-1.5 desktop:text-left ${colors.button}`}
    >
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg desktop:h-6 desktop:w-6 desktop:rounded-md ${colors.icon}`}
      >
        <Icon className="h-4 w-4 desktop:h-3.5 desktop:w-3.5" />
      </div>
      <div className="break-words text-[11px] font-medium leading-tight [overflow-wrap:anywhere] desktop:overflow-hidden desktop:text-ellipsis desktop:whitespace-nowrap desktop:text-xs">
        {label}
      </div>
    </button>
  );
}

function CompactInfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div title={value || "—"} className="min-w-0 px-1 py-0.5">
      <div className="text-[10px] font-medium text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-xs font-semibold text-foreground">{value || "—"}</div>
    </div>
  );
}

export function WorkerEmploymentDrawer({
  user,
  actor,
  histories,
  factories,
  mainHouses,
  users,
  managedFactoryIds,
  permissions,
  open,
  initialJoinOpen = false,
  factoryScope,
  onClose,
  onDataChanged,
}: {
  user: UserRecord | null;
  actor: UserRecord | null;
  histories: EmploymentHistoryRecord[];
  factories: FactoryRecord[];
  mainHouses: MainHouseRecord[];
  users: UserRecord[];
  managedFactoryIds?: Set<string>;
  permissions: WorkerEmploymentPermissions;
  open: boolean;
  initialJoinOpen?: boolean;
  factoryScope?: "assigned" | "all";
  onClose: () => void;
  onDataChanged: () => void | Promise<void>;
}) {
  const [payrollOpen, setPayrollOpen] = useState(false);
  const { data: settings } = useAppSettings();
  const [infoOpen, setInfoOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveDate, setLeaveDate] = useState(todayIso());
  const [leaveNote, setLeaveNote] = useState("");
  const [leaveSaving, setLeaveSaving] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinSaving, setJoinSaving] = useState(false);
  const [joinForm, setJoinForm] = useState({
    factory: "",
    main_house: "",
    employee_code: "",
    worker_name_snapshot: "",
    worker_cccd_snapshot: "",
    worker_date_of_birth_snapshot: "",
    worker_address_snapshot: "",
    cccd_issue_date: "",
    hometown_snapshot: "",
    worker_tax_code_snapshot: "",
    recruiter_staff: "",
    join_date: todayIso(),
    note: "",
  });
  const [joinCccdFront, setJoinCccdFront] = useState<File | null>(null);
  const [joinCccdBack, setJoinCccdBack] = useState<File | null>(null);
  const [editCccdFront, setEditCccdFront] = useState<File | null>(null);
  const [editCccdBack, setEditCccdBack] = useState<File | null>(null);
  const [oldHistoryCccdFront, setOldHistoryCccdFront] = useState<File | null>(null);
  const [oldHistoryCccdBack, setOldHistoryCccdBack] = useState<File | null>(null);
  const [employeeCodeOpen, setEmployeeCodeOpen] = useState(false);
  const [employeeCodeForm, setEmployeeCodeForm] = useState("");
  const [employeeCodeSaving, setEmployeeCodeSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedHistory, setSelectedHistory] = useState<EmploymentHistoryRecord | null>(null);
  const [selectedHistoryCccdVersion, setSelectedHistoryCccdVersion] =
    useState<CccdVersionRecord | null>(null);
  const [selectedHistoryCccdLoading, setSelectedHistoryCccdLoading] = useState(false);
  const [historyCccdPreview, setHistoryCccdPreview] = useState<{
    src: string;
    label: string;
  } | null>(null);
  const [restoreRequest, setRestoreRequest] = useState<RestoreRequest | null>(null);
  const [restoreSaving, setRestoreSaving] = useState(false);
  const [oldHistoryOpen, setOldHistoryOpen] = useState(false);
  const [oldHistorySaving, setOldHistorySaving] = useState(false);
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [advanceAmount, setAdvanceAmount] = useState("");
  const [advanceReason, setAdvanceReason] = useState("");
  const [advancePayoutMethod, setAdvancePayoutMethod] =
    useState<AdvancePayoutMethod>("bank_transfer");
  const [advancePolicy, setAdvancePolicy] = useState<AdvancePolicy | null>(null);
  const [advancePolicyError, setAdvancePolicyError] = useState("");
  const [advanceOutstandingLoading, setAdvanceOutstandingLoading] = useState(false);
  const [advanceBankChoice, setAdvanceBankChoice] = useState<"worker" | "actor">("worker");
  const [form, setForm] = useState({
    factory: "",
    employee_code: "",
    worker_name_snapshot: "",
    worker_cccd_snapshot: "",
    worker_date_of_birth_snapshot: "",
    worker_address_snapshot: "",
    cccd_issue_date: "",
    worker_tax_code_snapshot: "",
    recruiter_staff: "",
    main_house: "",
    join_date: "",
    leave_date: "",
    note: "",
  });
  const [oldHistoryForm, setOldHistoryForm] = useState({
    factory: "",
    main_house: "",
    employee_code: "",
    worker_name_snapshot: "",
    worker_cccd_snapshot: "",
    worker_date_of_birth_snapshot: "",
    worker_address_snapshot: "",
    cccd_issue_date: "",
    hometown_snapshot: "",
    worker_tax_code_snapshot: "",
    recruiter_staff: "",
    join_date: "",
    leave_date: "",
    note: "",
  });
  const [saving, setSaving] = useState(false);
  const [submittingAdvance, setSubmittingAdvance] = useState(false);
  const [bankEditing, setBankEditing] = useState(false);
  const [actionLogs, setActionLogs] = useState<WorkerActionHistoryRecord[]>([]);
  const [actionLogsLoading, setActionLogsLoading] = useState(false);
  const [actionLogsError, setActionLogsError] = useState("");
  const [actionLogsRefreshKey, setActionLogsRefreshKey] = useState(0);
  useEffect(() => {
    if (!advanceOpen || !user?.id) return;

    let active = true;
    setAdvanceOutstandingLoading(true);
    resolveAdvancePolicy(user.id, {
      allowAfterLeave: Boolean(settings?.allow_advance_after_leave),
      actorRole: actor?.role,
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
      .finally(() => active && setAdvanceOutstandingLoading(false));

    return () => {
      active = false;
    };
  }, [actor?.role, advanceOpen, settings?.allow_advance_after_leave, user?.id]);

  const [bankForm, setBankForm] = useState({
    bank_name: "",
    bank_account_number: "",
    bank_account_name: "",
    bank_account_note: "",
  });
  const [bankSaving, setBankSaving] = useState(false);
  const [bankDeleteOpen, setBankDeleteOpen] = useState(false);
  const [bankDeleting, setBankDeleting] = useState(false);

  const staffUsers = useMemo(
    () => users.filter((u) => u.role === "staff" || u.role === "admin"),
    [users],
  );

  const managedIds = useMemo(() => managedFactoryIds ?? new Set<string>(), [managedFactoryIds]);

  const canViewActionLogs = useMemo(
    () =>
      actor?.role === "admin" ||
      (actor?.role === "staff" &&
        histories.some((history) =>
          canViewHistoryInStaffScope(actor, history, histories, managedIds),
        )),
    [actor, histories, managedIds],
  );

  useEffect(() => {
    let active = true;
    if (!open || !user?.id || !canViewActionLogs) {
      setActionLogs([]);
      setActionLogsError("");
      setActionLogsLoading(false);
      return () => {
        active = false;
      };
    }

    setActionLogsLoading(true);
    setActionLogsError("");
    fetchWorkerActionHistory(user.id)
      .then((logs) => {
        if (active) setActionLogs(logs);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setActionLogs([]);
        setActionLogsError(getErrorMessage(error, "Không tải được lịch sử chỉnh sửa"));
      })
      .finally(() => {
        if (active) setActionLogsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [actionLogsRefreshKey, canViewActionLogs, open, user?.id]);

  const notifyDataChanged = async () => {
    await onDataChanged();
    setActionLogsRefreshKey((current) => current + 1);
  };

  const joinableFactories = useMemo(
    () => filterEmploymentFactories(actor, factories, managedIds, factoryScope),
    [actor, factories, factoryScope, managedIds],
  );
  const latestForFormReset = useMemo(() => getLatestEmploymentHistory(histories), [histories]);

  useEffect(() => {
    if (user) {
      setBankEditing(false);
      setBankDeleteOpen(false);
      setBankForm({
        bank_name: user.bank_name || "",
        bank_account_number: user.bank_account_number || "",
        bank_account_name: user.bank_account_name || "",
        bank_account_note: user.bank_account_note || "",
      });
      setLeaveOpen(false);
      setLeaveDate(todayIso());
      setLeaveNote("");
      setJoinOpen(false);
      setJoinCccdFront(null);
      setJoinCccdBack(null);
      setEditCccdFront(null);
      setEditCccdBack(null);
      setOldHistoryCccdFront(null);
      setOldHistoryCccdBack(null);
      setEmployeeCodeOpen(false);
      setSelectedHistory(null);
      setRestoreRequest(null);
      setRestoreSaving(false);
      const latest = latestForFormReset;
      const personalSnapshot = getEmploymentPersonalSnapshot(latest, user);
      setJoinForm({
        factory: "",
        main_house: "",
        employee_code: "",
        ...personalSnapshot,
        hometown_snapshot: personalSnapshot.worker_address_snapshot,
        worker_tax_code_snapshot: latest?.worker_tax_code_snapshot || "",
        recruiter_staff: encodeInternalRecruiter(actor?.id),
        join_date: todayIso(),
        note: "",
      });
      if (initialJoinOpen && (!latest || !isCurrentlyWorking(latest))) setJoinOpen(true);
      setEmployeeCodeForm(latest?.employee_code || "");
    }
  }, [actor?.id, initialJoinOpen, latestForFormReset, user]);

  useEffect(() => {
    if (!selectedHistory || !user?.id) {
      setSelectedHistoryCccdVersion(null);
      setSelectedHistoryCccdLoading(false);
      setHistoryCccdPreview(null);
      return;
    }

    const expandedVersion = selectedHistory.expand?.cccd_version;
    setSelectedHistoryCccdVersion(expandedVersion || null);
    if (expandedVersion) {
      setSelectedHistoryCccdLoading(false);
      return;
    }

    const cccdNumber = selectedHistory.worker_cccd_snapshot.trim();
    if (!cccdNumber) {
      setSelectedHistoryCccdLoading(false);
      return;
    }

    let active = true;
    setSelectedHistoryCccdLoading(true);
    getCccdVersionByNumber(user.id, cccdNumber)
      .then((version) => {
        if (active) setSelectedHistoryCccdVersion(version);
      })
      .catch(() => {
        if (active) setSelectedHistoryCccdVersion(null);
      })
      .finally(() => {
        if (active) setSelectedHistoryCccdLoading(false);
      });

    return () => {
      active = false;
    };
  }, [selectedHistory, user?.id]);

  const latestHistory = useMemo(() => getLatestEmploymentHistory(histories), [histories]);
  const joinCccdVersion = useMemo(() => {
    const cccdNumber = normalizeCccdNumber(joinForm.worker_cccd_snapshot);
    if (!cccdNumber) return undefined;
    return histories.find(
      (history) =>
        normalizeCccdNumber(history.worker_cccd_snapshot) === cccdNumber &&
        history.expand?.cccd_version,
    )?.expand?.cccd_version;
  }, [histories, joinForm.worker_cccd_snapshot]);
  const joinCccdFrontUrl = versionedCccdUrl(joinCccdVersion, joinCccdVersion?.front_image);
  const joinCccdBackUrl = versionedCccdUrl(joinCccdVersion, joinCccdVersion?.back_image);
  const editingHistory = useMemo(
    () => histories.find((history) => history.id === editingId),
    [editingId, histories],
  );
  const editingCccdVersion = editingHistory?.expand?.cccd_version;
  const editCccdFrontUrl = versionedCccdUrl(editingCccdVersion, editingCccdVersion?.front_image);
  const editCccdBackUrl = versionedCccdUrl(editingCccdVersion, editingCccdVersion?.back_image);
  const isEditingOldHistory = Boolean(editingHistory && editingHistory.id !== latestHistory?.id);
  const canEditHistoryRecord = (history: EmploymentHistoryRecord) =>
    actor?.role === "admin" ||
    (actor?.role === "staff" &&
      permissions.canEditHistory &&
      history.id === latestHistory?.id &&
      canViewHistoryInStaffScope(actor, history, histories, managedIds));
  const restorableHistory =
    latestHistory?.leave_date && canEditHistoryRecord(latestHistory) ? latestHistory : null;

  const startEdit = (h: EmploymentHistoryRecord) => {
    if (!canEditHistoryRecord(h)) return;
    setEditingId(h.id);
    setEditCccdFront(null);
    setEditCccdBack(null);
    const personalSnapshot = getEmploymentPersonalSnapshot(h);
    setForm({
      factory: h.factory || "",
      ...personalSnapshot,
      employee_code: h.employee_code || "",
      worker_tax_code_snapshot: h.worker_tax_code_snapshot || "",
      recruiter_staff: recruiterSelectionFromHistory(h),
      main_house: h.main_house || "",
      join_date: h.join_date?.slice(0, 10) || "",
      leave_date: h.leave_date?.slice(0, 10) || "",
      note: h.note || "",
    });
  };

  const openRestoreDialog = (history: EmploymentHistoryRecord) => {
    if (!canEditHistoryRecord(history) || !history.leave_date) {
      return;
    }
    setRestoreRequest({ history, source: "action" });
  };

  const submitLeave = async () => {
    if (!user || !actor) return;
    const active = histories.find((item) => isCurrentlyWorking(item));
    if (!active) {
      toast.error("Không có bản ghi đang làm để báo nghỉ");
      return;
    }
    if (!leaveDate) {
      toast.warning("Chọn ngày nghỉ");
      return;
    }
    setLeaveSaving(true);
    try {
      await updateEmploymentHistory(
        active.id,
        { leave_date: leaveDate, note: leaveNote.trim() },
        { actor, action: "report_leave", source: "Hồ sơ lao động", note: "Báo nghỉ" },
      );
      toast.success("Đã cập nhật ngày nghỉ");
      setLeaveOpen(false);
      await notifyDataChanged();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Lỗi báo nghỉ"));
    } finally {
      setLeaveSaving(false);
    }
  };

  const submitJoin = async () => {
    if (!user || !actor) return;
    if (!joinForm.factory) return toast.warning("Chọn nhà máy");
    if (!joinForm.join_date) return toast.warning("Nhập ngày vào làm");
    if (!joinForm.recruiter_staff) return toast.warning("Chọn Người tuyển");
    if (!joinForm.main_house) return toast.warning("Chọn nhà chính");
    const missingSnapshotFields = getMissingEmploymentSnapshotFields(joinForm);
    if (missingSnapshotFields.length) {
      return toast.warning(`Thiếu thông tin cá nhân: ${missingSnapshotFields.join(", ")}`);
    }
    if (
      !canReportJoin(
        actor,
        histories,
        managedFactoryIds ?? new Set(),
        joinForm.factory,
        factoryScope,
      )
    ) {
      toast.error("Bạn không có quyền báo đi làm tại nhà máy đã chọn");
      return;
    }
    setJoinSaving(true);
    try {
      const latestHistories = await fetchEmploymentHistories([user.id]);
      const active = getCurrentEmploymentHistory(latestHistories);
      if (active) {
        toast.error("Cần báo nghỉ nhà máy cũ trước");
        return;
      }

      const staleWorkingHistories = getStaleWorkingEmploymentHistories(latestHistories);
      for (const history of staleWorkingHistories) {
        await updateEmploymentHistory(
          history.id,
          { status: "left" },
          {
            actor,
            source: "Hồ sơ lao động",
            note: "Báo đi làm mới: đồng bộ lịch sử đã có ngày nghỉ",
            before: history,
          },
        );
      }

      let cccdVersionId: string | undefined;
      const cccdNumber = joinForm.worker_cccd_snapshot.trim() || user.cccd || "";
      if (joinCccdFront || joinCccdBack) {
        if (!cccdNumber) {
          toast.warning("Cần có số CCCD để lưu ảnh");
          return;
        }
        const [compressedFront, compressedBack] = await Promise.all([
          joinCccdFront ? compressImage(joinCccdFront) : Promise.resolve(null),
          joinCccdBack ? compressImage(joinCccdBack) : Promise.resolve(null),
        ]);
        const version = await findOrCreateCccdVersion(user.id, cccdNumber);
        await updateCccdVersionImages(
          version.id,
          compressedFront || undefined,
          compressedBack || undefined,
        );
        cccdVersionId = version.id;
      } else {
        const reusableVersion =
          joinCccdVersion ||
          (cccdNumber ? await getCccdVersionByNumber(user.id, cccdNumber) : null);
        cccdVersionId = reusableVersion?.id;
        if (!cccdVersionId) {
          const currentVersion = await getCurrentCccdVersion(user.id);
          if (
            currentVersion &&
            normalizeCccdNumber(currentVersion.cccd_number) === normalizeCccdNumber(cccdNumber)
          ) {
            cccdVersionId = currentVersion.id;
          }
        }
      }
      const created = await createEmploymentHistory({
        worker: user.id,
        factory: joinForm.factory,
        main_house: joinForm.main_house,
        employee_code: joinForm.employee_code.trim(),
        worker_name_snapshot: joinForm.worker_name_snapshot.trim(),
        worker_cccd_snapshot: joinForm.worker_cccd_snapshot.trim(),
        worker_date_of_birth_snapshot: joinForm.worker_date_of_birth_snapshot,
        worker_address_snapshot: joinForm.worker_address_snapshot.trim(),
        hometown_snapshot: joinForm.worker_address_snapshot.trim(),
        cccd_issue_date: joinForm.cccd_issue_date,
        worker_tax_code_snapshot: joinForm.worker_tax_code_snapshot.trim(),
        ...buildRecruiterPayload(joinForm.recruiter_staff),
        cccd_version: cccdVersionId,
        join_date: joinForm.join_date,
        note: joinForm.note.trim(),
      });
      await createStaffActionLog({
        actor,
        targetUserId: user.id,
        targetCollection: "employment_histories",
        targetRecord: created.id,
        action: "report_join",
        note: "Báo đi làm mới từ hồ sơ lao động",
      });
      toast.success("Đã tạo bản ghi đi làm mới");
      setJoinOpen(false);
      setJoinCccdFront(null);
      setJoinCccdBack(null);
      await notifyDataChanged();
    } catch (error: unknown) {
      const fieldErrors = getPocketBaseFieldErrors(error);
      toast.error(
        isEmploymentUserUniqueError(error)
          ? "Người lao động này đã có một lịch sử đi làm đang hoạt động. Hãy kiểm tra ngày nghỉ hoặc tải lại dữ liệu trước khi tạo mới."
          : fieldErrors || getErrorMessage(error, "Lỗi báo đi làm"),
      );
    } finally {
      setJoinSaving(false);
    }
  };

  const submitEmployeeCode = async () => {
    if (!user || !actor) return;
    const code = employeeCodeForm.trim();
    if (!code) {
      toast.warning("Nhập mã nhân viên");
      return;
    }
    setEmployeeCodeSaving(true);
    try {
      const latest = getLatestEmploymentHistory(histories);
      if (!latest) {
        toast.error("Người lao động chưa có lịch sử đi làm để cập nhật mã NV");
        return;
      }
      await updateEmploymentHistory(
        latest.id,
        { employee_code: code },
        { actor, source: "Hồ sơ lao động", note: `Cập nhật mã NV: ${code}`, before: latest },
      );
      toast.success("Đã cập nhật mã nhân viên");
      setEmployeeCodeOpen(false);
      await notifyDataChanged();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Lỗi cập nhật mã NV"));
    } finally {
      setEmployeeCodeSaving(false);
    }
  };
  const openOldHistory = () => {
    if (!user || !permissions.canAddOldHistory) return;
    const latest = getLatestEmploymentHistory(histories);
    const personalSnapshot = getEmploymentPersonalSnapshot(latest, user);
    setOldHistoryForm({
      factory: "",
      main_house: latest?.main_house || "",
      employee_code: latest?.employee_code || "",
      ...personalSnapshot,
      hometown_snapshot: personalSnapshot.worker_address_snapshot,
      worker_tax_code_snapshot: latest?.worker_tax_code_snapshot || "",
      recruiter_staff: recruiterSelectionFromHistory(latest) || encodeInternalRecruiter(actor?.id),
      join_date: "",
      leave_date: "",
      note: "",
    });
    setOldHistoryCccdFront(null);
    setOldHistoryCccdBack(null);
    setOldHistoryOpen(true);
  };

  const saveOldHistory = async () => {
    if (!user || !permissions.canAddOldHistory) {
      toast.error("Không có quyền bổ sung lịch sử cũ");
      return;
    }
    if (!oldHistoryForm.factory) return toast.warning("Chọn nhà máy");
    if (!oldHistoryForm.main_house) return toast.warning("Chọn nhà chính");
    if (!oldHistoryForm.recruiter_staff) return toast.warning("Chọn Người tuyển");
    if (!oldHistoryForm.join_date) return toast.warning("Chọn ngày vào");
    if (!oldHistoryForm.leave_date) return toast.warning("Chọn ngày nghỉ");
    const missingSnapshotFields = getMissingEmploymentSnapshotFields(oldHistoryForm);
    if (missingSnapshotFields.length) {
      return toast.warning(`Thiếu thông tin cá nhân: ${missingSnapshotFields.join(", ")}`);
    }
    if (oldHistoryForm.leave_date < oldHistoryForm.join_date) {
      return toast.warning("Ngày nghỉ không được trước ngày vào");
    }
    if (oldHistoryForm.leave_date > todayIso()) {
      return toast.warning("Ngày nghỉ không được lớn hơn ngày hiện tại");
    }

    setOldHistorySaving(true);
    try {
      const latestRows = await fetchEmploymentHistories([user.id]);
      const overlaps = latestRows.some((history) => {
        const existingStart = history.join_date?.slice(0, 10);
        const existingEnd = history.leave_date?.slice(0, 10) || "9999-12-31";
        if (!existingStart) return false;
        return (
          oldHistoryForm.join_date <= existingEnd && oldHistoryForm.leave_date >= existingStart
        );
      });
      if (overlaps) {
        toast.error("Khoảng thời gian này bị trùng với một lịch sử đã có");
        return;
      }

      let cccdVersionId: string | undefined;
      if (oldHistoryCccdFront || oldHistoryCccdBack) {
        const cccdNumber = oldHistoryForm.worker_cccd_snapshot.trim();
        if (!cccdNumber) {
          toast.warning("Cần có số CCCD để lưu ảnh");
          return;
        }
        const [compressedFront, compressedBack] = await Promise.all([
          oldHistoryCccdFront ? compressImage(oldHistoryCccdFront) : Promise.resolve(null),
          oldHistoryCccdBack ? compressImage(oldHistoryCccdBack) : Promise.resolve(null),
        ]);
        const version = await findOrCreateCccdVersion(user.id, cccdNumber);
        await updateCccdVersionImages(
          version.id,
          compressedFront || undefined,
          compressedBack || undefined,
        );
        cccdVersionId = version.id;
      }

      const created = await createEmploymentHistory({
        worker: user.id,
        factory: oldHistoryForm.factory,
        main_house: oldHistoryForm.main_house,
        employee_code: oldHistoryForm.employee_code.trim(),
        worker_name_snapshot: oldHistoryForm.worker_name_snapshot.trim(),
        worker_cccd_snapshot: oldHistoryForm.worker_cccd_snapshot.trim(),
        worker_date_of_birth_snapshot: oldHistoryForm.worker_date_of_birth_snapshot,
        worker_address_snapshot: oldHistoryForm.worker_address_snapshot.trim(),
        hometown_snapshot: oldHistoryForm.worker_address_snapshot.trim(),
        cccd_issue_date: oldHistoryForm.cccd_issue_date,
        worker_tax_code_snapshot: oldHistoryForm.worker_tax_code_snapshot.trim(),
        ...buildRecruiterPayload(oldHistoryForm.recruiter_staff),
        cccd_version: cccdVersionId,
        join_date: oldHistoryForm.join_date,
        leave_date: oldHistoryForm.leave_date,
        note: oldHistoryForm.note.trim(),
      });
      await createStaffActionLog({
        actor,
        targetUserId: user.id,
        targetCollection: "employment_histories",
        targetRecord: created.id,
        action: "create",
        after: created,
        note: "Bổ sung lịch sử đi làm cũ",
      });
      setOldHistoryOpen(false);
      setOldHistoryCccdFront(null);
      setOldHistoryCccdBack(null);
      await notifyDataChanged();
      toast.success("Đã bổ sung lịch sử đi làm cũ");
    } catch (error: unknown) {
      const fieldErrors = getPocketBaseFieldErrors(error);
      toast.error(fieldErrors || getErrorMessage(error, "Không thể bổ sung lịch sử cũ"));
    } finally {
      setOldHistorySaving(false);
    }
  };

  const saveEdit = async (restoreConfirmed = false) => {
    if (!editingId || !user?.id) return;
    if (!form.factory) {
      toast.warning("Chọn nhà máy");
      return;
    }
    const missingEditFields = getMissingEmploymentEditFields(form);
    if (missingEditFields.length) {
      toast.warning(`Thiếu thông tin bắt buộc: ${missingEditFields.join(", ")}`);
      return;
    }
    setSaving(true);
    try {
      const latestHistories = await fetchEmploymentHistories([user.id]);
      const before = latestHistories.find((item) => item.id === editingId);
      if (!before) throw new Error("Không tìm thấy lịch sử đi làm cần cập nhật");

      const latest = getLatestEmploymentHistory(latestHistories);
      if (actor?.role === "staff" && latest?.id !== editingId) {
        toast.error("Staff chỉ được sửa lịch sử đi làm gần nhất");
        setEditingId(null);
        await notifyDataChanged();
        return;
      }

      const isOldHistory = latest?.id !== editingId;
      const originalLeaveDate = before.leave_date || "";
      if (isOldHistory && form.leave_date !== originalLeaveDate) {
        toast.error(
          "Không được sửa ngày nghỉ của lịch sử cũ để tránh chồng chéo thời gian làm việc",
        );
        setForm((current) => ({ ...current, leave_date: originalLeaveDate }));
        return;
      }

      const isRestoring = Boolean(before.leave_date && !form.leave_date);
      if (isRestoring && !restoreConfirmed) {
        setRestoreRequest({ history: before, source: "edit" });
        return;
      }
      if (isRestoring) validateRestoreRequest(latestHistories, editingId);

      let cccdVersionId = before.cccd_version;
      const cccdNumber = form.worker_cccd_snapshot.trim() || user.cccd || "";
      if (editCccdFront || editCccdBack) {
        if (!cccdNumber) {
          toast.warning("Cần có số CCCD để lưu ảnh");
          return;
        }
        const [compressedFront, compressedBack] = await Promise.all([
          editCccdFront ? compressImage(editCccdFront) : Promise.resolve(null),
          editCccdBack ? compressImage(editCccdBack) : Promise.resolve(null),
        ]);
        const version = await findOrCreateCccdVersion(user.id, cccdNumber);
        await updateCccdVersionImages(
          version.id,
          compressedFront || undefined,
          compressedBack || undefined,
        );
        cccdVersionId = version.id;
      }

      const normalizedAddress = form.worker_address_snapshot.trim();
      const historyPayload = {
        factory: form.factory,
        employee_code: form.employee_code.trim(),
        worker_name_snapshot: form.worker_name_snapshot.trim(),
        worker_cccd_snapshot: form.worker_cccd_snapshot.trim(),
        worker_date_of_birth_snapshot: form.worker_date_of_birth_snapshot,
        worker_address_snapshot: normalizedAddress,
        cccd_issue_date: form.cccd_issue_date,
        hometown_snapshot: normalizedAddress,
        worker_tax_code_snapshot: form.worker_tax_code_snapshot.trim(),
        cccd_version: cccdVersionId || undefined,
        ...buildRecruiterPayload(form.recruiter_staff),
        main_house: form.main_house || undefined,
        join_date: form.join_date || undefined,
        leave_date: isOldHistory ? originalLeaveDate : form.leave_date,
        note: form.note.trim(),
      };
      const audit = {
        actor,
        source: "Biểu mẫu sửa lịch sử đi làm",
        note: isRestoring
          ? "Xóa ngày nghỉ, khôi phục trạng thái đang làm"
          : "Cập nhật lịch sử đi làm",
        before,
      };
      if (isRestoring) {
        await restoreEmploymentHistoryToWorking(editingId, historyPayload, audit);
      } else {
        await updateEmploymentHistory(editingId, historyPayload, audit);
      }
      toast.success(isRestoring ? "Đã khôi phục trạng thái đang làm" : "Đã lưu thay đổi");
      setRestoreRequest(null);
      setEditCccdFront(null);
      setEditCccdBack(null);
      setEditingId(null);
      await notifyDataChanged();
    } catch (error: unknown) {
      const fieldErrors = getPocketBaseFieldErrors(error);
      if (fieldErrors) {
        toast.error(fieldErrors);
      } else {
        toast.error(getErrorMessage(error, "Lỗi lưu"));
      }
    } finally {
      setSaving(false);
    }
  };

  const confirmRestore = async () => {
    if (!restoreRequest || !user?.id) return;
    if (restoreRequest.source === "edit") {
      await saveEdit(true);
      return;
    }

    setRestoreSaving(true);
    try {
      const latestHistories = await fetchEmploymentHistories([user.id]);
      const before = validateRestoreRequest(latestHistories, restoreRequest.history.id);
      await restoreEmploymentHistoryToWorking(
        restoreRequest.history.id,
        {},
        {
          actor,
          source: "Hồ sơ lao động",
          note: "Xóa ngày nghỉ, khôi phục trạng thái đang làm",
          before,
        },
      );
      toast.success("Đã khôi phục trạng thái đang làm");
      setRestoreRequest(null);
      await notifyDataChanged();
    } catch (error: unknown) {
      const fieldErrors = getPocketBaseFieldErrors(error);
      toast.error(fieldErrors || getErrorMessage(error, "Không thể khôi phục trạng thái đang làm"));
    } finally {
      setRestoreSaving(false);
    }
  };

  const submitAdvance = async () => {
    if (!user || !actor) return;

    const amount = parseMoneyInput(advanceAmount);
    if (!amount) {
      toast.warning("Nhập số tiền ứng");
      return;
    }
    if (!advanceReason.trim()) {
      toast.warning("Nhập lý do ứng");
      return;
    }
    const bankSource = advanceBankChoice === "actor" ? actor : user;
    if (advancePayoutMethod === "bank_transfer" && !bankSource.bank_account_number) {
      toast.warning(
        advanceBankChoice === "actor"
          ? "Tài khoản của người thao tác chưa có số tài khoản ngân hàng"
          : "Người lao động chưa có số tài khoản ngân hàng",
      );
      return;
    }

    setSubmittingAdvance(true);
    try {
      await assertAdvanceInteractionAllowed(actor.role);
      const policy = await resolveAdvancePolicy(user.id, {
        allowAfterLeave: Boolean(settings?.allow_advance_after_leave),
        actorRole: actor.role,
      });
      validateAdvanceAmount(policy, amount);
      const employment = policy.employment;

      const created = await pb.collection("advances").create({
        ...companyPayload(pb.authStore.record as UserRecord),
        worker: user.id,
        requested_by: actor.id,
        recruiter_id: employment.recruiter_staff || "",
        employee_code: employment.employee_code || "",
        full_name: employment.worker_name_snapshot || user.full_name || "",
        company: policy.factoryName,
        phone: user.phone || "",
        join_date: employment.join_date || "",
        bank_name: advancePayoutMethod === "cash" ? "" : bankSource.bank_name || "",
        bank_account_number:
          advancePayoutMethod === "cash" ? "" : bankSource.bank_account_number || "",
        bank_account_name: advancePayoutMethod === "cash" ? "" : bankSource.bank_account_name || "",
        payout_method: advancePayoutMethod,
        amount,
        reason: advanceReason.trim(),
        status: "recruiter_approved",
        recovery_status: "none",
      });
      await createStaffActionLog({
        actor,
        targetUserId: user.id,
        targetCollection: "advances",
        targetRecord: created.id,
        action: "report_advance",
        after: created,
        note: "Báo ứng cho người lao động đang đi làm",
      });
      toast.success("Đã tạo yêu cầu ứng lương");
      setAdvanceAmount("");
      setAdvanceReason("");
      setAdvancePayoutMethod("bank_transfer");
      setAdvanceOpen(false);
      void notifyDataChanged();
    } catch (error: unknown) {
      const fieldErrors = getPocketBaseFieldErrors(error);
      toast.error(fieldErrors || getErrorMessage(error, "Lỗi báo ứng"));
    } finally {
      setSubmittingAdvance(false);
    }
  };

  const saveBankInfo = async () => {
    if (!user || !actor) return;
    setBankSaving(true);
    try {
      await updateUserAndCache(user.id, bankForm);
      await createStaffActionLog({
        actor,
        targetUserId: user.id,
        targetCollection: "users",
        targetRecord: user.id,
        action: "update_bank",
        before: {
          bank_name: user.bank_name || "",
          bank_account_number: user.bank_account_number || "",
          bank_account_name: user.bank_account_name || "",
          bank_account_note: user.bank_account_note || "",
        },
        after: bankForm,
        note: "Cập nhật STK ngân hàng cho NLĐ",
      });
      setBankEditing(false);
      toast.success("Đã cập nhật STK ngân hàng");
      void notifyDataChanged();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Không cập nhật được STK"));
    } finally {
      setBankSaving(false);
    }
  };

  const deleteBankInfo = async () => {
    if (!user || !actor || !permissions.canUpdateBank) return;

    const before = {
      bank_name: user.bank_name || "",
      bank_account_number: user.bank_account_number || "",
      bank_account_name: user.bank_account_name || "",
      bank_account_note: user.bank_account_note || "",
    };
    const clearedBankInfo = {
      bank_name: "",
      bank_account_number: "",
      bank_account_name: "",
      bank_account_note: "",
    };

    setBankDeleting(true);
    try {
      await updateUserAndCache(user.id, clearedBankInfo);
      await createStaffActionLog({
        actor,
        targetUserId: user.id,
        targetCollection: "users",
        targetRecord: user.id,
        action: "update_bank",
        before,
        after: clearedBankInfo,
        note: "Xóa thông tin tài khoản ngân hàng của NLĐ",
      });
      setBankForm(clearedBankInfo);
      setBankDeleteOpen(false);
      setBankEditing(false);
      toast.success("Đã xóa thông tin tài khoản ngân hàng");
      void notifyDataChanged();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Không xóa được thông tin tài khoản ngân hàng"));
    } finally {
      setBankDeleting(false);
    }
  };

  if (!user) return null;

  const activeHistory = histories.find((item) => isCurrentlyWorking(item));
  const isWorking = Boolean(activeHistory);
  const allowAdvanceAfterLeave = Boolean(settings?.allow_advance_after_leave);
  const advanceInteractionAllowed = isAdvanceInteractionAllowed(settings, actor?.role);
  const canReportAdvanceByScope =
    permissions.canReportAdvance && (isWorking || allowAdvanceAfterLeave);
  const canOpenAdvance =
    canReportAdvanceByScope &&
    advanceInteractionAllowed &&
    (!latestHistory?.recruiter_partner || actor?.role === "admin");
  const hasBankInfo = Boolean(
    user.bank_name || user.bank_account_number || user.bank_account_name || user.bank_account_note,
  );
  const bankBusy = bankSaving || bankDeleting;
  const advanceLimit = advancePolicy?.limit || 0;
  const advanceOutstanding = advancePolicy?.outstanding || 0;
  const workerBank = user.bank_account_number
    ? `${user.bank_name || "NH"} · ${user.bank_account_number} · ${user.bank_account_name || ""}`
    : "";
  const actorBank = actor?.bank_account_number
    ? `${actor.bank_name || "NH"} · ${actor.bank_account_number} · ${actor.bank_account_name || ""}`
    : "";
  const actorBankRoleLabel = actor?.role === "admin" ? "Admin" : "Staff";

  const openAdvanceDialog = () => {
    setAdvancePayoutMethod("bank_transfer");
    setAdvanceBankChoice(workerBank ? "worker" : actorBank ? "actor" : "worker");
    setAdvanceOpen(true);
  };

  const openLeaveDialog = () => {
    setLeaveDate(todayIso());
    setLeaveNote("");
    setLeaveOpen(true);
  };

  const openEmployeeCodeDialog = () => {
    const latest = getLatestEmploymentHistory(histories);
    setEmployeeCodeForm(latest?.employee_code || "");
    setEmployeeCodeOpen(true);
  };
  const openJoinDialog = () => {
    const latest = getLatestEmploymentHistory(histories);
    const personalSnapshot = getEmploymentPersonalSnapshot(latest, user);
    setJoinCccdFront(null);
    setJoinCccdBack(null);
    setJoinForm({
      factory: "",
      main_house: "",
      employee_code: "",
      ...personalSnapshot,
      hometown_snapshot: personalSnapshot.worker_address_snapshot,
      worker_tax_code_snapshot: latest?.worker_tax_code_snapshot || "",
      recruiter_staff: encodeInternalRecruiter(actor?.id),
      join_date: todayIso(),
      note: "",
    });
    setJoinOpen(true);
  };

  return (
    <>
      <WorkerPayrollDialog
        open={payrollOpen}
        onOpenChange={setPayrollOpen}
        viewer={actor as UserRecord}
        workerId={user?.id || ""}
      />

      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent
          layout="raw"
          className="flex max-h-[90dvh] min-w-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-lg desktop:max-w-7xl"
        >
          <DialogHeader className="min-w-0 shrink-0 border-b px-5 py-4 pr-14">
            <DialogTitle className="break-words [overflow-wrap:anywhere]">
              {user.full_name || user.username || "Người lao động"}
            </DialogTitle>
            <DialogDescription className="break-words [overflow-wrap:anywhere]">
              {isWorking ? "Đang đi làm" : "Đã nghỉ"}
            </DialogDescription>
          </DialogHeader>

          <div className="min-w-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <div className="desktop:grid desktop:grid-cols-[10.5rem_minmax(0,1fr)] desktop:items-stretch desktop:gap-3">
              {((isWorking && permissions.canReportLeave) ||
                permissions.canReportJoin ||
                canReportAdvanceByScope ||
                permissions.canViewPayroll ||
                permissions.canUpdateBank ||
                permissions.canAddOldHistory ||
                Boolean(restorableHistory)) && (
                <div className="desktop:col-start-1 desktop:row-start-1 desktop:self-stretch desktop:rounded-xl desktop:border desktop:border-border/60 desktop:bg-card/70 desktop:p-1.5">
                  <div className="hidden px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground desktop:block">
                    Chức năng
                  </div>
                  <div className="grid grid-cols-3 gap-2 desktop:grid-cols-1 desktop:gap-1.5">
                    {isWorking && permissions.canReportLeave && (
                      <ActionButton
                        icon={Clock3}
                        label="Báo nghỉ"
                        tone="danger"
                        onClick={openLeaveDialog}
                      />
                    )}
                    {restorableHistory && (
                      <ActionButton
                        icon={RotateCcw}
                        label="Khôi phục đang làm"
                        tone="success"
                        onClick={() => openRestoreDialog(restorableHistory)}
                      />
                    )}
                    {permissions.canReportJoin && (
                      <ActionButton
                        icon={Plus}
                        label="Báo đi làm mới"
                        tone="success"
                        onClick={openJoinDialog}
                      />
                    )}
                    {canReportAdvanceByScope && (
                      <ActionButton
                        icon={Wallet}
                        label="Báo ứng lương"
                        disabled={!canOpenAdvance}
                        tone="warning"
                        onClick={openAdvanceDialog}
                      />
                    )}
                    {permissions.canViewPayroll && (
                      <ActionButton
                        icon={CalendarRange}
                        label="Check công lương"
                        tone="info"
                        onClick={() => setPayrollOpen(true)}
                      />
                    )}
                    {permissions.canUpdateBank && (
                      <ActionButton
                        icon={Landmark}
                        label="Cập nhật ngân hàng"
                        tone="info"
                        onClick={() => {
                          setInfoOpen(true);
                          setBankEditing(true);
                        }}
                      />
                    )}
                    {((isWorking && permissions.canReportLeave) || canOpenAdvance) && (
                      <ActionButton
                        icon={Hash}
                        label="Cập nhật mã NV"
                        tone="primary"
                        onClick={openEmployeeCodeDialog}
                      />
                    )}{" "}
                    {permissions.canAddOldHistory && (
                      <ActionButton
                        icon={Plus}
                        label="Bổ sung lịch sử"
                        tone="success"
                        onClick={openOldHistory}
                      />
                    )}
                  </div>
                </div>
              )}

              <div className="min-w-0 desktop:col-start-2 desktop:row-start-1 desktop:grid desktop:grid-cols-[minmax(0,1fr)_minmax(17rem,21rem)] desktop:items-start desktop:gap-3">
                <div className="min-w-0 space-y-4 desktop:col-start-1">
                  <div className="hidden rounded-xl border border-border/60 bg-card p-3 shadow-soft desktop:block">
                    <div className="space-y-1.5">
                      <div className="grid grid-cols-4 gap-1.5">
                        <CompactInfoCell label="Mã tài khoản" value={user.uid || "—"} />
                        <CompactInfoCell label="Tên đăng nhập" value={user.username || "—"} />
                        <CompactInfoCell label="CCCD" value={maskCccd(user.cccd)} />
                        <CompactInfoCell label="SĐT" value={user.phone || "—"} />
                      </div>
                      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,1fr)_auto] gap-1.5">
                        <CompactInfoCell label="Ngân hàng" value={user.bank_name || "—"} />
                        <CompactInfoCell
                          label="Số tài khoản"
                          value={user.bank_account_number || "—"}
                        />
                        <CompactInfoCell
                          label="Tên chủ tài khoản"
                          value={user.bank_account_name || "—"}
                        />
                        <CompactInfoCell
                          label="Ghi chú STK"
                          value={user.bank_account_note || "—"}
                        />
                        {permissions.canUpdateBank && !bankEditing && (
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => setBankEditing(true)}
                              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-success/25 bg-success/5 px-2.5 text-xs font-medium text-success transition-colors hover:bg-success/10"
                            >
                              <Landmark className="h-3.5 w-3.5" />
                              Sửa STK
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {bankEditing && (
                      <form
                        className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-1.5 border-t border-border/60 pt-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void saveBankInfo();
                        }}
                      >
                        <div className="min-w-0 space-y-1">
                          <Label className="text-[10px]">Ngân hàng</Label>
                          <BankPicker
                            value={bankForm.bank_name}
                            onChange={(value) =>
                              setBankForm((current) => ({ ...current, bank_name: value }))
                            }
                            triggerClassName="h-8 text-xs"
                          />
                        </div>
                        <div className="min-w-0 space-y-1">
                          <Label className="text-[10px]">Số tài khoản</Label>
                          <Input
                            className="h-8 text-xs"
                            value={bankForm.bank_account_number}
                            onChange={(e) =>
                              setBankForm((c) => ({
                                ...c,
                                bank_account_number: e.target.value.replace(/\D/g, ""),
                              }))
                            }
                            inputMode="numeric"
                            placeholder="Nhập số tài khoản"
                          />
                        </div>
                        <div className="min-w-0 space-y-1">
                          <Label className="text-[10px]">Tên chủ tài khoản</Label>
                          <Input
                            className="h-8 text-xs"
                            value={bankForm.bank_account_name}
                            onChange={(e) =>
                              setBankForm((c) => ({ ...c, bank_account_name: e.target.value }))
                            }
                            placeholder="Nhập tên chủ tài khoản"
                          />
                        </div>
                        <div className="min-w-0 space-y-1">
                          <Label className="text-[10px]">Ghi chú STK</Label>
                          <Textarea
                            className="min-h-8 text-xs"
                            value={bankForm.bank_account_note}
                            onChange={(e) =>
                              setBankForm((c) => ({ ...c, bank_account_note: e.target.value }))
                            }
                            placeholder="Ghi chú thêm về tài khoản"
                            rows={2}
                          />
                        </div>
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 px-2 text-xs"
                            onClick={() => setBankEditing(false)}
                            disabled={bankBusy}
                          >
                            Hủy
                          </Button>
                          {hasBankInfo && (
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              className="h-8 px-2 text-xs"
                              onClick={() => setBankDeleteOpen(true)}
                              disabled={bankBusy}
                            >
                              <Trash2 className="h-3.5 w-3.5" /> Xóa STK
                            </Button>
                          )}
                          <Button
                            type="submit"
                            size="sm"
                            className="h-8 px-2 text-xs"
                            disabled={bankBusy}
                          >
                            {bankSaving ? "Đang lưu..." : "Lưu STK"}
                          </Button>
                        </div>
                      </form>
                    )}
                  </div>
                  <div className="flex items-center justify-between desktop:hidden">
                    <span className="text-xs font-medium text-muted-foreground">Thông tin</span>
                    <button
                      type="button"
                      onClick={() => setInfoOpen((v) => !v)}
                      className="flex items-center gap-1 rounded-full border border-border/60 bg-card px-3 py-1 text-xs font-medium text-foreground active:scale-[0.98]"
                      aria-expanded={infoOpen}
                    >
                      {infoOpen ? (
                        <ChevronUp className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                      {infoOpen ? "Thu gọn" : "Mở rộng"}
                    </button>
                  </div>

                  {infoOpen && (
                    <div className="desktop:hidden">
                      <>
                        <div className="grid min-w-0 grid-cols-2 gap-2 text-sm">
                          {user.uid && (
                            <div className="col-span-2 min-w-0 overflow-hidden rounded-xl bg-primary/10 p-2.5">
                              <div className="text-[10px] text-muted-foreground">Mã tài khoản</div>
                              <div className="mt-0.5 break-words text-sm font-semibold text-primary [overflow-wrap:anywhere]">
                                {user.uid}
                              </div>
                            </div>
                          )}
                          <div className="min-w-0 overflow-hidden rounded-xl bg-muted/35 p-2.5">
                            <div className="text-[10px] text-muted-foreground">
                              Họ tên tài khoản
                            </div>
                            <div className="mt-0.5 break-words text-sm font-semibold [overflow-wrap:anywhere]">
                              {user.full_name || "—"}
                            </div>
                          </div>
                          <div className="min-w-0 overflow-hidden rounded-xl bg-muted/35 p-2.5">
                            <div className="text-[10px] text-muted-foreground">CCCD tài khoản</div>
                            <div className="mt-0.5 break-words text-sm font-semibold [overflow-wrap:anywhere]">
                              {maskCccd(user.cccd)}
                            </div>
                          </div>
                          <div className="min-w-0 overflow-hidden rounded-xl bg-muted/35 p-2.5">
                            <div className="text-[10px] text-muted-foreground">SĐT</div>
                            <div className="mt-0.5 break-words text-sm font-semibold [overflow-wrap:anywhere]">
                              {user.phone || "—"}
                            </div>
                          </div>
                          <div className="min-w-0 overflow-hidden rounded-xl bg-muted/35 p-2.5">
                            <div className="text-[10px] text-muted-foreground">Tên đăng nhập</div>
                            <div className="mt-0.5 break-words text-sm font-semibold [overflow-wrap:anywhere]">
                              {user.username || "—"}
                            </div>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              <Landmark className="h-3.5 w-3.5" />
                              Tài khoản ngân hàng
                            </div>
                            {permissions.canUpdateBank && !bankEditing && (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                onClick={() => setBankEditing(true)}
                              >
                                Sửa STK
                              </Button>
                            )}
                          </div>
                          {bankEditing ? (
                            <form
                              className="space-y-2 rounded-xl border border-border/60 bg-muted/20 p-3"
                              onSubmit={(e) => {
                                e.preventDefault();
                                void saveBankInfo();
                              }}
                            >
                              <div className="space-y-1">
                                <Label className="text-xs">Ngân hàng</Label>
                                <BankPicker
                                  value={bankForm.bank_name}
                                  onChange={(value) =>
                                    setBankForm((current) => ({ ...current, bank_name: value }))
                                  }
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Số tài khoản</Label>
                                <Input
                                  value={bankForm.bank_account_number}
                                  onChange={(e) =>
                                    setBankForm((c) => ({
                                      ...c,
                                      bank_account_number: e.target.value.replace(/\D/g, ""),
                                    }))
                                  }
                                  inputMode="numeric"
                                  placeholder="Nhập số tài khoản"
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Tên chủ tài khoản</Label>
                                <Input
                                  value={bankForm.bank_account_name}
                                  onChange={(e) =>
                                    setBankForm((c) => ({
                                      ...c,
                                      bank_account_name: e.target.value,
                                    }))
                                  }
                                  placeholder="Nhập tên chủ tài khoản"
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Ghi chú STK</Label>
                                <Textarea
                                  value={bankForm.bank_account_note}
                                  onChange={(e) =>
                                    setBankForm((c) => ({
                                      ...c,
                                      bank_account_note: e.target.value,
                                    }))
                                  }
                                  placeholder="Ghi chú thêm về tài khoản"
                                  rows={2}
                                />
                              </div>
                              <div className="grid grid-cols-2 gap-2 pt-1">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setBankEditing(false)}
                                  disabled={bankBusy}
                                >
                                  Hủy
                                </Button>
                                {hasBankInfo && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="destructive"
                                    onClick={() => setBankDeleteOpen(true)}
                                    disabled={bankBusy}
                                  >
                                    <Trash2 className="h-4 w-4" /> Xóa STK
                                  </Button>
                                )}
                                <Button
                                  type="submit"
                                  size="sm"
                                  className={hasBankInfo ? "col-span-2" : ""}
                                  disabled={bankBusy}
                                >
                                  {bankSaving ? "Đang lưu..." : "Lưu STK"}
                                </Button>
                              </div>
                            </form>
                          ) : (
                            <div className="grid min-w-0 grid-cols-1 gap-1.5 text-sm">
                              <div className="min-w-0 overflow-hidden rounded-xl bg-muted/35 p-2.5">
                                <div className="text-[10px] text-muted-foreground">Ngân hàng</div>
                                <div className="mt-0.5 break-words text-sm font-semibold [overflow-wrap:anywhere]">
                                  {user.bank_name || "—"}
                                </div>
                              </div>
                              <div className="grid min-w-0 grid-cols-2 gap-1.5">
                                <div className="min-w-0 overflow-hidden rounded-xl bg-muted/35 p-2.5">
                                  <div className="text-[10px] text-muted-foreground">
                                    Số tài khoản
                                  </div>
                                  <div className="mt-0.5 break-words text-sm font-semibold [overflow-wrap:anywhere]">
                                    {user.bank_account_number || "—"}
                                  </div>
                                </div>
                                <div className="min-w-0 overflow-hidden rounded-xl bg-muted/35 p-2.5">
                                  <div className="text-[10px] text-muted-foreground">
                                    Tên chủ TK
                                  </div>
                                  <div className="mt-0.5 break-words text-sm font-semibold [overflow-wrap:anywhere]">
                                    {user.bank_account_name || "—"}
                                  </div>
                                </div>
                                <div className="min-w-0 overflow-hidden rounded-xl bg-muted/35 p-2.5">
                                  <div className="text-[10px] text-muted-foreground">
                                    Ghi chú STK
                                  </div>
                                  <div className="mt-0.5 break-words text-sm font-semibold [overflow-wrap:anywhere]">
                                    {user.bank_account_note || "—"}
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Ảnh CCCD
                        </div>
                        <CccdManager
                          targetUser={user}
                          actor={actor}
                          onUpdated={() => void notifyDataChanged()}
                          readOnly
                        />
                      </>
                    </div>
                  )}

                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Lịch sử đi làm ({histories.length})
                  </div>

                  {histories.length === 0 ? (
                    <div className="rounded-xl border bg-card p-3 text-center text-xs text-muted-foreground">
                      Chưa có lịch sử
                    </div>
                  ) : (
                    histories.map((h) => {
                      const canEdit = canEditHistoryRecord(h);
                      const factoryName = h.expand?.factory?.name || "Nhà máy";
                      const mainHouseName = h.expand?.main_house?.name || "—";
                      const recruiter = getRecruiterDisplay(h);
                      const recruiterName = recruiter
                        ? `${recruiter.name} · ${recruiter.label}`
                        : "—";
                      const employmentPeriod = `Vào: ${formatDate(h.join_date)} · Nghỉ: ${formatDate(h.leave_date) || "—"}`;
                      return (
                        <Card
                          key={h.id}
                          className="min-w-0 space-y-2 overflow-hidden rounded-2xl p-3 transition-colors desktop:grid desktop:grid-cols-[minmax(0,1.3fr)_minmax(0,1.1fr)_minmax(0,.8fr)_minmax(0,1fr)_auto] desktop:items-center desktop:gap-4 desktop:space-y-0 desktop:rounded-xl desktop:px-4 desktop:py-3 cursor-pointer hover:bg-muted/30"
                          onClick={() => setSelectedHistory(h)}
                        >
                          <div className="flex items-start justify-between gap-2 desktop:contents">
                            <div className="min-w-0 flex-1 desktop:col-start-1 desktop:row-start-1">
                              <div
                                title={`${factoryName} · ${h.employee_code || "—"}`}
                                className="break-words text-sm font-semibold [overflow-wrap:anywhere] desktop:truncate desktop:text-base"
                              >
                                {factoryName}
                                <span className="ml-1 text-xs font-medium text-muted-foreground desktop:text-sm">
                                  · {h.employee_code || "—"}
                                </span>
                              </div>
                              <div
                                title={h.worker_name_snapshot || "—"}
                                className="break-words text-xs text-muted-foreground [overflow-wrap:anywhere] desktop:truncate desktop:text-sm"
                              >
                                {h.worker_name_snapshot || "—"}
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-2 desktop:col-start-5 desktop:row-start-1 desktop:justify-self-end">
                              <StatusChip
                                className="desktop:text-sm"
                                tone={hasWorkingEmploymentStatus(h) ? "success" : "neutral"}
                              >
                                {hasWorkingEmploymentStatus(h) ? "Đang làm" : "Đã nghỉ"}
                              </StatusChip>
                              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                            </div>
                          </div>
                          <div className="min-w-0 space-y-1 text-xs text-muted-foreground desktop:contents desktop:text-sm">
                            <div
                              title={employmentPeriod}
                              className="min-w-0 break-words [overflow-wrap:anywhere] desktop:col-start-2 desktop:row-start-1 desktop:truncate"
                            >
                              <span className="hidden text-xs font-medium uppercase tracking-wide text-muted-foreground desktop:block">
                                Thời gian
                              </span>
                              {employmentPeriod}
                            </div>
                            <div
                              title={mainHouseName}
                              className="hidden min-w-0 desktop:col-start-3 desktop:row-start-1 desktop:block desktop:truncate"
                            >
                              <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                Nhà chính
                              </span>
                              {mainHouseName}
                            </div>
                            <div
                              title={recruiterName}
                              className="min-w-0 break-words [overflow-wrap:anywhere] desktop:col-start-4 desktop:row-start-1 desktop:truncate"
                            >
                              <span className="hidden text-xs font-medium uppercase tracking-wide text-muted-foreground desktop:block">
                                Người tuyển
                              </span>
                              <span className="desktop:hidden">Người tuyển: </span>
                              {recruiterName}
                            </div>
                            {h.note && (
                              <div
                                title={h.note}
                                className="min-w-0 break-words [overflow-wrap:anywhere] desktop:hidden"
                              >
                                {h.note}
                              </div>
                            )}
                          </div>
                        </Card>
                      );
                    })
                  )}
                </div>

                {canViewActionLogs && (
                  <StaffActionHistoryPanel
                    workerId={user.id}
                    logs={actionLogs}
                    loading={actionLogsLoading}
                    error={actionLogsError}
                    className="desktop:col-start-2 desktop:row-start-1 desktop:sticky desktop:top-0"
                  />
                )}
              </div>
            </div>
          </div>

          <DialogFooter className="desktop:px-5 desktop:pb-4">
            <Button variant="outline" onClick={onClose}>
              Đóng
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(selectedHistory)}
        onOpenChange={(value) => {
          if (!value) {
            setSelectedHistory(null);
            setHistoryCccdPreview(null);
          }
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Thông tin cá nhân tại thời điểm đi làm</DialogTitle>
            <DialogDescription>
              Dữ liệu được lưu riêng theo lịch sử, không thay đổi theo hồ sơ hiện tại.
            </DialogDescription>
          </DialogHeader>

          {selectedHistory && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 overflow-hidden rounded-xl border bg-white text-sm shadow-sm sm:grid-cols-[minmax(0,1.4fr)_minmax(0,.8fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
                <div className="col-span-2 min-w-0 border-b p-3 sm:col-span-1 sm:border-b-0 sm:border-r">
                  <div className="text-[11px] text-muted-foreground">Nhà máy</div>
                  <div className="mt-1 truncate font-semibold">
                    {selectedHistory.expand?.factory?.name || "Chưa có"}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    Mã NV: {selectedHistory.employee_code || "Chưa có"}
                  </div>
                </div>
                <div className="border-b border-r p-3 sm:border-b-0">
                  <div className="text-[11px] text-muted-foreground">Trạng thái</div>
                  <div className="mt-1">
                    <StatusChip
                      tone={hasWorkingEmploymentStatus(selectedHistory) ? "success" : "neutral"}
                    >
                      {hasWorkingEmploymentStatus(selectedHistory) ? "Đang làm" : "Đã nghỉ"}
                    </StatusChip>
                  </div>
                </div>
                <div className="min-w-0 border-b p-3 sm:border-b-0 sm:border-r">
                  <div className="text-[11px] text-muted-foreground">Nhà chính</div>
                  <div className="mt-1 truncate font-medium">
                    {selectedHistory.expand?.main_house?.name || "Chưa gán"}
                  </div>
                </div>
                <div className="border-r p-3">
                  <div className="text-[11px] text-muted-foreground">Ngày vào làm</div>
                  <div className="mt-1 font-medium">{formatDate(selectedHistory.join_date)}</div>
                </div>
                <div className="p-3">
                  <div className="text-[11px] text-muted-foreground">Ngày nghỉ</div>
                  <div className="mt-1 font-medium">{formatDate(selectedHistory.leave_date)}</div>
                </div>
              </div>

              <div className="space-y-2 rounded-xl border bg-white p-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Họ tên tại nhà máy: </span>
                  <span className="font-medium">
                    {selectedHistory.worker_name_snapshot || "Chưa có"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">CCCD tại nhà máy: </span>
                  <span className="font-medium">
                    {selectedHistory.worker_cccd_snapshot || "Chưa có"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Ngày sinh: </span>
                  <span className="font-medium">
                    {formatDate(selectedHistory.worker_date_of_birth_snapshot)}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Ngày cấp CCCD: </span>
                  <span className="font-medium">{formatDate(selectedHistory.cccd_issue_date)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Địa chỉ thường trú: </span>
                  <span className="font-medium">
                    {selectedHistory.worker_address_snapshot ||
                      selectedHistory.hometown_snapshot ||
                      "Chưa có"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Mã số thuế: </span>
                  <span className="font-medium">
                    {selectedHistory.worker_tax_code_snapshot || "Chưa có"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Người tuyển: </span>
                  <span className="font-medium">
                    {(() => {
                      const recruiter = getRecruiterDisplay(selectedHistory);
                      return recruiter ? `${recruiter.name} · ${recruiter.label}` : "Chưa có";
                    })()}
                  </span>
                </div>
              </div>

              <HistoryCccdSnapshot
                history={selectedHistory}
                version={selectedHistoryCccdVersion || undefined}
                loading={selectedHistoryCccdLoading}
                onPreview={(src, label) => src && setHistoryCccdPreview({ src, label })}
              />

              {selectedHistory.note && (
                <div className="rounded-xl bg-muted/40 p-3 text-sm text-muted-foreground">
                  <div className="mb-1 text-[11px] font-medium uppercase tracking-wide">
                    Ghi chú
                  </div>
                  {selectedHistory.note}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            {selectedHistory && canEditHistoryRecord(selectedHistory) && (
              <Button
                type="button"
                onClick={() => {
                  const history = selectedHistory;
                  setSelectedHistory(null);
                  startEdit(history);
                }}
              >
                Sửa lịch sử
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => setSelectedHistory(null)}>
              Đóng
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(historyCccdPreview)}
        onOpenChange={(value) => !value && setHistoryCccdPreview(null)}
      >
        <DialogContent className="w-[calc(100vw-1rem)] max-w-3xl rounded-2xl p-2 sm:p-4">
          <DialogHeader className="px-1 pt-1">
            <DialogTitle>{historyCccdPreview?.label || "Ảnh CCCD"}</DialogTitle>
            <DialogDescription>Ảnh CCCD của bản ghi lịch sử đi làm.</DialogDescription>
          </DialogHeader>
          {historyCccdPreview && (
            <div className="flex max-h-[calc(100dvh-8rem)] items-center justify-center overflow-auto rounded-xl bg-muted/30">
              <img
                src={historyCccdPreview.src}
                alt={historyCccdPreview.label}
                className="h-auto max-h-[calc(100dvh-8rem)] w-auto max-w-full rounded-xl object-contain"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(restoreRequest)}
        onOpenChange={(value) => {
          if (!value && !restoreSaving && !saving) setRestoreRequest(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Khôi phục trạng thái đang làm</DialogTitle>
            <DialogDescription>
              Xóa ngày nghỉ của lịch sử gần nhất và chuyển NLĐ về trạng thái đang làm.
            </DialogDescription>
          </DialogHeader>

          {restoreRequest && (
            <div className="space-y-3">
              <div className="rounded-xl border bg-muted/30 p-3">
                <div className="text-sm font-semibold">
                  {restoreRequest.history.expand?.factory?.name ||
                    factories.find((factory) => factory.id === restoreRequest.history.factory)
                      ?.name ||
                    "Nhà máy"}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-xl bg-background p-2.5">
                    <div className="text-[11px] text-muted-foreground">Ngày vào làm</div>
                    <div className="mt-1 font-semibold">
                      {formatDate(restoreRequest.history.join_date)}
                    </div>
                  </div>
                  <div className="rounded-xl bg-background p-2.5">
                    <div className="text-[11px] text-muted-foreground">Ngày nghỉ sẽ xóa</div>
                    <div className="mt-1 font-semibold text-destructive">
                      {formatDate(restoreRequest.history.leave_date)}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
                Sau khi xác nhận, bản ghi này sẽ không còn ngày nghỉ và giao diện NLĐ sẽ chuyển sang
                "Đang làm". Hệ thống sẽ chặn nếu đã có bản ghi đang làm khác.
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRestoreRequest(null)}
              disabled={restoreSaving || saving}
            >
              Huỷ
            </Button>
            <Button
              type="button"
              onClick={() => void confirmRestore()}
              disabled={restoreSaving || saving}
            >
              {restoreSaving || saving ? "Đang cập nhật..." : "Xóa ngày nghỉ và khôi phục"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={oldHistoryOpen}
        onOpenChange={(value) => !oldHistorySaving && setOldHistoryOpen(value)}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle>Bổ sung lịch sử đi làm cũ</DialogTitle>
            <DialogDescription>
              Bản ghi luôn ở trạng thái Đã nghỉ và không được trùng thời gian với lịch sử khác.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void saveOldHistory();
            }}
          >
            <div className="space-y-1">
              <Label className="text-xs">Nhà máy *</Label>
              <FactoryPicker
                factories={factories}
                value={oldHistoryForm.factory}
                onChange={(value) =>
                  setOldHistoryForm((current) => ({ ...current, factory: value }))
                }
              />
            </div>
            <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Nhà chính *</Label>
                <MainHousePicker
                  mainHouses={mainHouses}
                  value={oldHistoryForm.main_house}
                  onChange={(value) =>
                    setOldHistoryForm((current) => ({ ...current, main_house: value }))
                  }
                />
              </div>
              <RecruiterPicker
                label="Người tuyển *"
                value={oldHistoryForm.recruiter_staff as RecruiterSelectionValue}
                onChange={(value) =>
                  setOldHistoryForm((current) => ({ ...current, recruiter_staff: value }))
                }
                internalUsers={staffUsers}
                partners={mainHouses}
              />
            </div>
            <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Mã NV</Label>
                <Input
                  value={oldHistoryForm.employee_code}
                  onChange={(event) =>
                    setOldHistoryForm((current) => ({
                      ...current,
                      employee_code: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Mã số thuế</Label>
                <Input
                  value={oldHistoryForm.worker_tax_code_snapshot}
                  onChange={(event) =>
                    setOldHistoryForm((current) => ({
                      ...current,
                      worker_tax_code_snapshot: event.target.value.replace(/[^\d]/g, ""),
                    }))
                  }
                  inputMode="numeric"
                />
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-semibold">Thông tin CCCD</div>
              <JoinCccdSection
                value={oldHistoryForm}
                onChange={(changes) => setOldHistoryForm((current) => ({ ...current, ...changes }))}
                frontFile={oldHistoryCccdFront}
                backFile={oldHistoryCccdBack}
                onFrontFileChange={setOldHistoryCccdFront}
                onBackFileChange={setOldHistoryCccdBack}
              />
            </div>
            <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Ngày vào *</Label>
                <DateInput
                  value={oldHistoryForm.join_date}
                  max={oldHistoryForm.leave_date || todayIso()}
                  onChange={(value) =>
                    setOldHistoryForm((current) => ({ ...current, join_date: value }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Ngày nghỉ *</Label>
                <DateInput
                  value={oldHistoryForm.leave_date}
                  min={oldHistoryForm.join_date}
                  max={todayIso()}
                  onChange={(value) =>
                    setOldHistoryForm((current) => ({ ...current, leave_date: value }))
                  }
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Ghi chú</Label>
              <Textarea
                value={oldHistoryForm.note}
                onChange={(event) =>
                  setOldHistoryForm((current) => ({ ...current, note: event.target.value }))
                }
                rows={3}
                placeholder="Ví dụ: bổ sung hồ sơ làm việc trước đây..."
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOldHistoryOpen(false)}
                disabled={oldHistorySaving}
              >
                Đóng
              </Button>
              <Button type="submit" disabled={oldHistorySaving}>
                {oldHistorySaving ? "Đang lưu..." : "Lưu lịch sử cũ"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingId} onOpenChange={(v) => !v && setEditingId(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Sửa lịch sử đi làm</DialogTitle>
            <DialogDescription>
              Chỉnh sửa thông tin lịch sử đi làm của người lao động.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4 [&_[role=combobox]]:bg-white [&_input]:bg-white [&_textarea]:bg-white"
            onSubmit={(e) => {
              e.preventDefault();
              void saveEdit();
            }}
          >
            <div className="space-y-3">
              <div className="text-sm font-semibold">Thông tin đi làm</div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label className="text-xs">Nhà máy *</Label>
                  <FactoryPicker
                    factories={factories}
                    value={form.factory}
                    onChange={(value) => setForm((current) => ({ ...current, factory: value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Nhà chính</Label>
                  <MainHousePicker
                    mainHouses={mainHouses}
                    value={form.main_house}
                    onChange={(value) => setForm((current) => ({ ...current, main_house: value }))}
                    allowClear
                  />
                </div>
                <RecruiterPicker
                  label="Người tuyển"
                  value={form.recruiter_staff as RecruiterSelectionValue}
                  triggerClassName="bg-white"
                  onChange={(value) =>
                    setForm((current) => ({ ...current, recruiter_staff: value }))
                  }
                  internalUsers={staffUsers}
                  partners={mainHouses}
                />
              </div>
              <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-3">
                <div className="space-y-1">
                  <Label className="text-xs">Mã NV</Label>
                  <Input
                    value={form.employee_code}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, employee_code: event.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Ngày vào</Label>
                  <DateInput
                    value={form.join_date}
                    onChange={(join_date) => setForm((current) => ({ ...current, join_date }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">
                    Ngày nghỉ{isEditingOldHistory ? " (không được sửa)" : ""}
                  </Label>
                  <DateInput
                    value={form.leave_date}
                    onChange={(leave_date) => setForm((current) => ({ ...current, leave_date }))}
                    disabled={isEditingOldHistory}
                  />
                  {isEditingOldHistory && (
                    <div className="text-[11px] text-muted-foreground">
                      Lịch sử cũ giữ nguyên ngày nghỉ để không làm chồng chéo thời gian đi làm.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-semibold">Thông tin CCCD</div>
              <JoinCccdSection
                value={form}
                onChange={(changes) => setForm((current) => ({ ...current, ...changes }))}
                frontFile={editCccdFront}
                backFile={editCccdBack}
                frontImageUrl={editCccdFrontUrl}
                backImageUrl={editCccdBackUrl}
                onFrontFileChange={setEditCccdFront}
                onBackFileChange={setEditCccdBack}
              />
            </div>

            <div className="space-y-3">
              <div className="text-sm font-semibold">Thông tin bổ sung</div>
              <div className="space-y-1">
                <Label className="text-xs">Mã số thuế</Label>
                <Input
                  value={form.worker_tax_code_snapshot}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      worker_tax_code_snapshot: event.target.value.replace(/[^\d]/g, ""),
                    }))
                  }
                  inputMode="numeric"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Ghi chú</Label>
                <Textarea
                  rows={3}
                  value={form.note}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, note: event.target.value }))
                  }
                  placeholder="Tùy chọn"
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditCccdFront(null);
                  setEditCccdBack(null);
                  setEditingId(null);
                }}
                disabled={saving}
              >
                Huỷ
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Đang lưu..." : "Lưu thay đổi"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={advanceOpen} onOpenChange={setAdvanceOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle>Báo ứng lương</DialogTitle>
            <DialogDescription>
              Hạn mức được xác định theo nhà máy trong lịch sử đi làm gần nhất.
            </DialogDescription>
          </DialogHeader>

          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submitAdvance();
            }}
          >
            {!advanceInteractionAllowed && <AdvanceReadOnlyNotice />}
            <div className="rounded-xl border bg-muted/30 p-3 text-sm">
              <div className="font-semibold">
                {user.full_name || user.username || "Người lao động"}
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {advancePolicy?.factoryName || "Chưa xác định được nhà máy"} · Mã NV:{" "}
                {advancePolicy?.employment.employee_code || "—"}
              </div>
            </div>

            {advancePolicyError && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                {advancePolicyError}
              </div>
            )}
            {advancePolicy && !advancePolicy.isWorking && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                NLĐ đã nghỉ; yêu cầu đang dùng hạn mức của {advancePolicy.factoryName} theo lịch sử
                gần nhất.
              </div>
            )}

            {advanceLimit > 0 && (
              <div className="flex flex-wrap items-center gap-x-1 rounded-xl border border-dashed border-border bg-muted/30 p-2.5 text-xs text-muted-foreground">
                <span>
                  Hạn mức:{" "}
                  <span className="font-semibold text-foreground">
                    {advanceLimit.toLocaleString("vi-VN")} đ
                  </span>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Tồn ứng:{" "}
                  <span className="font-semibold text-foreground">
                    {advanceOutstandingLoading
                      ? "Đang tải..."
                      : `${advanceOutstanding.toLocaleString("vi-VN")} đ`}
                  </span>
                </span>
              </div>
            )}

            <AdvancePayoutMethodPicker
              value={advancePayoutMethod}
              onChange={setAdvancePayoutMethod}
            />

            {advancePayoutMethod === "bank_transfer" && (
              <div className="space-y-1">
                <Label className="text-xs">Tài khoản nhận tiền</Label>
                <div className="space-y-1.5">
                  {workerBank && (
                    <button
                      type="button"
                      onClick={() => setAdvanceBankChoice("worker")}
                      className={`flex w-full items-start gap-2 rounded-xl border p-2.5 text-left text-xs transition ${advanceBankChoice === "worker" ? "border-primary bg-primary/5" : "border-border bg-card"}`}
                    >
                      <div
                        className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 ${advanceBankChoice === "worker" ? "border-primary bg-primary" : "border-muted-foreground"}`}
                      />
                      <div>
                        <div className="font-medium">STK của NLĐ</div>
                        <div className="text-muted-foreground">{workerBank}</div>
                      </div>
                    </button>
                  )}
                  {actorBank && (
                    <button
                      type="button"
                      onClick={() => setAdvanceBankChoice("actor")}
                      className={`flex w-full items-start gap-2 rounded-xl border p-2.5 text-left text-xs transition ${advanceBankChoice === "actor" ? "border-primary bg-primary/5" : "border-border bg-card"}`}
                    >
                      <div
                        className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 ${advanceBankChoice === "actor" ? "border-primary bg-primary" : "border-muted-foreground"}`}
                      />
                      <div>
                        <div className="font-medium">STK của tôi ({actorBankRoleLabel})</div>
                        <div className="text-muted-foreground">{actorBank}</div>
                      </div>
                    </button>
                  )}
                  {!workerBank && !actorBank && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
                      Chưa có STK nào. Cập nhật ngân hàng trước khi báo ứng.
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-1">
              <Label className="text-xs">Số tiền</Label>
              <Input
                value={advanceAmount}
                onChange={(e) => setAdvanceAmount(formatMoneyInput(e.target.value))}
                inputMode="numeric"
                placeholder="Nhập số tiền ứng"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Lý do</Label>
              <Textarea
                rows={3}
                value={advanceReason}
                onChange={(e) => setAdvanceReason(e.target.value)}
                placeholder="Ví dụ: ứng tiền sinh hoạt..."
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAdvanceOpen(false)}>
                Huỷ
              </Button>
              <Button
                type="submit"
                disabled={
                  submittingAdvance ||
                  advanceOutstandingLoading ||
                  !advancePolicy ||
                  Boolean(advancePolicyError) ||
                  (advancePayoutMethod === "bank_transfer" && !workerBank && !actorBank) ||
                  !advanceInteractionAllowed
                }
              >
                {submittingAdvance ? "Đang gửi..." : "Gửi yêu cầu"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={leaveOpen} onOpenChange={(v) => !leaveSaving && setLeaveOpen(v)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle>Báo nghỉ nhà máy hiện tại</DialogTitle>
            <DialogDescription>
              Cập nhật ngày nghỉ cho bản ghi đang đi làm của người lao động.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submitLeave();
            }}
          >
            <div className="space-y-1">
              <Label className="text-xs">Ngày nghỉ</Label>
              <DateInput value={leaveDate} max={todayIso()} onChange={(v) => setLeaveDate(v)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Ghi chú</Label>
              <Textarea
                rows={3}
                value={leaveNote}
                onChange={(e) => setLeaveNote(e.target.value)}
                placeholder="Ví dụ: nghỉ việc, chuyển nhà máy..."
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setLeaveOpen(false)}
                disabled={leaveSaving}
              >
                Huỷ
              </Button>
              <Button type="submit" disabled={leaveSaving}>
                {leaveSaving ? "Đang lưu..." : "Xác nhận nghỉ"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={joinOpen} onOpenChange={(v) => !joinSaving && setJoinOpen(v)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle>Báo đi làm nhà máy mới</DialogTitle>
            <DialogDescription>
              Tạo bản ghi đi làm mới. Cần báo nghỉ nhà máy cũ trước khi tạo.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submitJoin();
            }}
          >
            <div className="text-sm font-semibold">Thông tin đi làm</div>
            <div className="space-y-1">
              <Label className="text-xs">Nhà máy *</Label>
              <FactoryPicker
                factories={joinableFactories}
                value={joinForm.factory}
                onChange={(value) => setJoinForm((current) => ({ ...current, factory: value }))}
              />
            </div>
            <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Nhà chính *</Label>
                <MainHousePicker
                  mainHouses={mainHouses}
                  value={joinForm.main_house}
                  onChange={(value) =>
                    setJoinForm((current) => ({ ...current, main_house: value }))
                  }
                />
              </div>
              <RecruiterPicker
                label="Người tuyển *"
                value={joinForm.recruiter_staff as RecruiterSelectionValue}
                onChange={(value) =>
                  setJoinForm((current) => ({ ...current, recruiter_staff: value }))
                }
                internalUsers={staffUsers}
                partners={mainHouses}
              />
            </div>
            <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Mã NV</Label>
                <Input
                  value={joinForm.employee_code}
                  onChange={(e) => setJoinForm((f) => ({ ...f, employee_code: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Ngày vào *</Label>
                <DateInput
                  value={joinForm.join_date}
                  max={todayIso()}
                  onChange={(v) => setJoinForm((f) => ({ ...f, join_date: v }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-semibold">Thông tin CCCD</div>
              <JoinCccdSection
                enableImagePasteAndCrop
                value={joinForm}
                onChange={(changes) => setJoinForm((current) => ({ ...current, ...changes }))}
                frontFile={joinCccdFront}
                backFile={joinCccdBack}
                frontImageUrl={joinCccdFrontUrl}
                backImageUrl={joinCccdBackUrl}
                onFrontFileChange={setJoinCccdFront}
                onBackFileChange={setJoinCccdBack}
              />
            </div>
            <div className="text-sm font-semibold">Thông tin bổ sung</div>
            <div className="space-y-1">
              <Label className="text-xs">Mã số thuế</Label>
              <Input
                value={joinForm.worker_tax_code_snapshot}
                onChange={(e) =>
                  setJoinForm((f) => ({
                    ...f,
                    worker_tax_code_snapshot: e.target.value.replace(/[^\d]/g, ""),
                  }))
                }
                inputMode="numeric"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Ghi chú</Label>
              <Textarea
                rows={3}
                value={joinForm.note}
                onChange={(e) => setJoinForm((f) => ({ ...f, note: e.target.value }))}
                placeholder="Tùy chọn"
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setJoinOpen(false)}
                disabled={joinSaving}
              >
                Huỷ
              </Button>
              <Button type="submit" disabled={joinSaving}>
                {joinSaving ? "Đang lưu..." : "Tạo bản ghi"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={employeeCodeOpen}
        onOpenChange={(v) => !employeeCodeSaving && setEmployeeCodeOpen(v)}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle>Cập nhật mã nhân viên</DialogTitle>
            <DialogDescription>
              Cập nhật mã NV cho hồ sơ và lịch sử đi làm gần nhất.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submitEmployeeCode();
            }}
          >
            <div className="space-y-1">
              <Label className="text-xs">Mã nhân viên</Label>
              <Input
                value={employeeCodeForm}
                onChange={(e) => setEmployeeCodeForm(e.target.value)}
                placeholder="Nhập mã nhân viên"
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEmployeeCodeOpen(false)}
                disabled={employeeCodeSaving}
              >
                Huỷ
              </Button>
              <Button type="submit" disabled={employeeCodeSaving}>
                {employeeCodeSaving ? "Đang lưu..." : "Lưu mã NV"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={bankDeleteOpen}
        onOpenChange={(nextOpen) => !bankDeleting && setBankDeleteOpen(nextOpen)}
      >
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Xóa thông tin tài khoản ngân hàng?</AlertDialogTitle>
            <AlertDialogDescription>
              Toàn bộ ngân hàng, số tài khoản, tên chủ tài khoản và ghi chú STK của{" "}
              {user.full_name || user.username || "NLĐ này"} sẽ bị xóa. Hành động này không thể hoàn
              tác.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bankDeleting}>Hủy</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void deleteBankInfo()}
              disabled={bankDeleting}
            >
              <Trash2 className="h-4 w-4" />
              {bankDeleting ? "Đang xóa..." : "Xác nhận xóa"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
