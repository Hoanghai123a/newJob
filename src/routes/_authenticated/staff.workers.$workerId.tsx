import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Download,
  IdCard,
  ImagePlus,
  Banknote,
  Landmark,
  NotebookPen,
  Pencil,
  Plus,
  Trash,
  UserSquare2,
  Wallet,
  ZoomIn,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { PageContainer } from "@/components/layout/PageContainer";
import { Card } from "@/components/ui/card";
import { DataLoadingState } from "@/components/ui/data-loading-state";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useAuth } from "@/lib/auth";
import { useAppSettings } from "@/lib/app-settings";
import { exportToExcel, formatDateOnly } from "@/lib/excel";
import {
  createEmploymentHistory,
  fetchEmploymentHistories,
  getCurrentEmploymentHistory,
  getLatestEmploymentHistory,
  getStaleWorkingEmploymentHistories,
  getEmploymentPersonalSnapshot,
  getMissingEmploymentEditFields,
  getMissingEmploymentSnapshotFields,
  isCurrentlyWorking,
  maskCccd,
  updateEmploymentHistory,
  updateUserAndCache,
  type EmploymentHistoryRecord,
} from "@/lib/employment";
import { fetchFactories, type FactoryRecord } from "@/lib/factories";
import { fetchMainHouses, type MainHouseRecord } from "@/lib/main-houses";
import { createStaffActionLog } from "@/lib/staff-log";
import { JoinCccdSection } from "@/components/employment/JoinCccdSection";
import {
  assertAdvanceInteractionAllowed,
  isAdvanceInteractionAllowed,
  resolveAdvancePolicy,
  validateAdvanceAmount,
  type AdvancePolicy,
} from "@/lib/advance-policy";
import { CccdManager } from "@/components/cccd/CccdManager";
import { BankNameInput } from "@/components/staff/BankNameInput";
import { FactoryPicker, MainHousePicker } from "@/components/workforce/UserPicker";
import { SalaryHoldCreateDialog } from "@/components/staff/SalaryHoldCreateDialog";
import { canCreateSalaryHold } from "@/lib/salary-holds";
import {
  getCccdVersionByNumber,
  getCurrentCccdVersion,
  updateCccdVersionAndCache,
  updateCccdVersionImages,
  findOrCreateCccdVersion,
  type CccdVersionRecord,
} from "@/lib/cccd-versions";
import { compressImage } from "@/lib/image-compress";
import {
  canAccessStaffWorkspace,
  canReportAdvance,
  canUpdateBank,
  canReportJoin,
  canReportLeave,
  canViewPayroll,
  fetchStaffWorkerWorkspace,
  filterHistoriesForStaffScope,
  canViewHistoryInStaffScope,
  isRecentRecruiter,
} from "@/lib/staff-permissions";
import { pb, fileUrl, type UserRecord } from "@/lib/pocketbase";
import type { WorkerRecord } from "@/lib/workers";
import { resolveBankName } from "@/lib/vn-banks";
import { AdvancePayoutMethodPicker } from "@/components/advances/AdvancePayoutMethodPicker";
import { AdvanceReadOnlyNotice } from "@/components/advances/AdvanceReadOnlyNotice";
import { RecruiterPicker } from "@/components/employment/RecruiterPicker";
import { getUserErrorMessage } from "@/lib/toast";
import {
  buildRecruiterPayload,
  encodeInternalRecruiter,
  getRecruiterDisplay,
  recruiterSelectionFromHistory,
  type RecruiterSelectionValue,
} from "@/lib/recruiters";
import {
  PAYOUT_METHOD_META,
  normalizeAdvancePayoutMethod,
  type AdvancePayoutMethod,
} from "@/lib/advances";
import { filterEmploymentFactories } from "@/lib/staff-employment-scope";

export const Route = createFileRoute("/_authenticated/staff/workers/$workerId")({
  component: StaffWorkerDetailPage,
});

type AdvanceItem = {
  id: string;
  amount?: number;
  reason?: string;
  status?: string;
  recovery_status?: string;
  payout_method?: AdvancePayoutMethod;
  created?: string;
};

function recordTime(value?: string) {
  const time = new Date(value || 0).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function normalizeCccdNumber(value?: string) {
  return String(value || "").replace(/\D/g, "");
}

function getLatestHistoryByJoinDate(histories: EmploymentHistoryRecord[]) {
  return histories.reduce<EmploymentHistoryRecord | null>((latest, history) => {
    if (!latest) return history;

    const joinDiff = recordTime(history.join_date) - recordTime(latest.join_date);
    if (joinDiff > 0) return history;
    if (joinDiff < 0) return latest;

    return recordTime(history.created) > recordTime(latest.created) ? history : latest;
  }, null);
}

function StaffWorkerDetailPage() {
  const { workerId } = Route.useParams();
  const { user: viewer } = useAuth();
  const { data: settings } = useAppSettings();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [workerUser, setWorkerUser] = useState<WorkerRecord | null>(null);
  const [histories, setHistories] = useState<EmploymentHistoryRecord[]>([]);
  const [allWorkerHistories, setAllWorkerHistories] = useState<EmploymentHistoryRecord[]>([]);
  const [factories, setFactories] = useState<FactoryRecord[]>([]);
  const [managedFactoryIds, setManagedFactoryIds] = useState<Set<string>>(new Set());
  const [staffUsers, setStaffUsers] = useState<UserRecord[]>([]);
  const [advances, setAdvances] = useState<AdvanceItem[]>([]);

  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [bankOpen, setBankOpen] = useState(false);
  const [salaryHoldOpen, setSalaryHoldOpen] = useState(false);
  const [oldHistoryOpen, setOldHistoryOpen] = useState(false);
  const [oldHistorySubmitting, setOldHistorySubmitting] = useState(false);
  const [editingHistory, setEditingHistory] = useState<EmploymentHistoryRecord | null>(null);
  const [detailHistory, setDetailHistory] = useState<EmploymentHistoryRecord | null>(null);
  const [detailCccdVersion, setDetailCccdVersion] = useState<CccdVersionRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  const [amountText, setAmountText] = useState("");
  const [advanceReason, setAdvanceReason] = useState("");
  const [advancePayoutMethod, setAdvancePayoutMethod] =
    useState<AdvancePayoutMethod>("bank_transfer");
  const [advancePolicy, setAdvancePolicy] = useState<AdvancePolicy | null>(null);
  const [advancePolicyError, setAdvancePolicyError] = useState("");
  const [advancePolicyLoading, setAdvancePolicyLoading] = useState(false);
  const [leaveDate, setLeaveDate] = useState(todayDate());
  const [leaveNote, setLeaveNote] = useState("");
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
    join_date: todayDate(),
    note: "",
  });
  const [joinCccdFront, setJoinCccdFront] = useState<File | null>(null);
  const [joinCccdBack, setJoinCccdBack] = useState<File | null>(null);
  const [editCccdFront, setEditCccdFront] = useState<File | null>(null);
  const [editCccdBack, setEditCccdBack] = useState<File | null>(null);
  const [oldHistoryCccdFront, setOldHistoryCccdFront] = useState<File | null>(null);
  const [oldHistoryCccdBack, setOldHistoryCccdBack] = useState<File | null>(null);
  const [bankForm, setBankForm] = useState({
    bank_name: "",
    bank_account_number: "",
    bank_account_name: "",
    bank_account_note: "",
  });
  const [historyForm, setHistoryForm] = useState({
    employee_code: "",
    worker_name_snapshot: "",
    worker_cccd_snapshot: "",
    worker_date_of_birth_snapshot: "",
    worker_address_snapshot: "",
    cccd_issue_date: "",
    hometown_snapshot: "",
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
  const [mainHouses, setMainHouses] = useState<MainHouseRecord[]>([]);

  useEffect(() => {
    if (!viewer?.id || !canAccessStaffWorkspace(viewer)) return;

    let alive = true;
    setLoading(true);

    Promise.all([
      fetchStaffWorkerWorkspace(viewer as UserRecord, workerId),
      fetchFactories(),
      pb
        .collection("users")
        .getList(1, 200, {
          filter: `role="staff" || role="admin"`,
          sort: "full_name,username",
        })
        .then((res) => res.items)
        .catch(() => []),
      pb
        .collection("advances")
        .getList(1, 50, {
          filter: `worker="${workerId}"`,
          sort: "-created",
        })
        .then((res) => res.items)
        .catch(() => []),
      fetchMainHouses().catch(() => [] as MainHouseRecord[]),
    ])
      .then(([workspace, factoryRows, staffRows, advanceRows, mainHouseRows]) => {
        if (!alive) return;

        const workspaceWorker = workspace.worker;
        if (!workspaceWorker) {
          setWorkerUser(null);
          setHistories([]);
          setAllWorkerHistories([]);
          return;
        }

        const historyRows = workspaceWorker.histories;
        const managedFactoryIds = workspace.managedFactoryIds;
        const visibleHistoryRows = filterHistoriesForStaffScope(
          viewer,
          historyRows,
          managedFactoryIds,
        );
        if (!visibleHistoryRows.length && viewer.role !== "admin") {
          return;
        }

        const userRecord = workspaceWorker.user;
        const latest = getLatestEmploymentHistory(visibleHistoryRows);

        setWorkerUser(userRecord);
        setHistories(visibleHistoryRows);
        setAllWorkerHistories(historyRows);
        setManagedFactoryIds(managedFactoryIds);
        setFactories(factoryRows);
        setMainHouses(mainHouseRows);
        setStaffUsers(staffRows as UserRecord[]);
        setAdvances(advanceRows as AdvanceItem[]);
        const personalSnapshot = getEmploymentPersonalSnapshot(latest, userRecord);
        setJoinForm((prev) => ({
          ...prev,
          employee_code: latest?.employee_code || "",
          ...personalSnapshot,
          hometown_snapshot: personalSnapshot.worker_address_snapshot,
          worker_tax_code_snapshot: latest?.worker_tax_code_snapshot || "",
          recruiter_staff:
            recruiterSelectionFromHistory(latest) || encodeInternalRecruiter(viewer.id),
          main_house: latest?.main_house || "",
        }));
        setBankForm({
          bank_name: userRecord?.bank_name || "",
          bank_account_number: userRecord?.bank_account_number || "",
          bank_account_name: userRecord?.bank_account_name || "",
          bank_account_note: userRecord?.bank_account_note || "",
        });
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [navigate, viewer, workerId]);

  useEffect(() => {
    setDetailCccdVersion(null);
    if (!detailHistory?.cccd_version) return;
    setDetailLoading(true);
    pb.collection("cccd_versions")
      .getOne(detailHistory.cccd_version)
      .then((r) => setDetailCccdVersion(r as unknown as CccdVersionRecord))
      .catch(() => setDetailCccdVersion(null))
      .finally(() => setDetailLoading(false));
  }, [detailHistory]);

  const latestHistory = useMemo(() => getLatestEmploymentHistory(histories), [histories]);
  const latestWorkerHistory = useMemo(
    () => getLatestEmploymentHistory(allWorkerHistories),
    [allWorkerHistories],
  );
  const latestHistoryByJoinDate = useMemo(
    () => getLatestHistoryByJoinDate(allWorkerHistories),
    [allWorkerHistories],
  );
  const joinCccdVersion = useMemo(() => {
    const cccdNumber = normalizeCccdNumber(joinForm.worker_cccd_snapshot);
    if (!cccdNumber) return undefined;
    return allWorkerHistories.find(
      (history) =>
        normalizeCccdNumber(history.worker_cccd_snapshot) === cccdNumber &&
        history.expand?.cccd_version,
    )?.expand?.cccd_version;
  }, [allWorkerHistories, joinForm.worker_cccd_snapshot]);
  const joinCccdFrontUrl = joinCccdVersion?.front_image
    ? versionedCccdUrl(joinCccdVersion, joinCccdVersion.front_image)
    : "";
  const joinCccdBackUrl = joinCccdVersion?.back_image
    ? versionedCccdUrl(joinCccdVersion, joinCccdVersion.back_image)
    : "";
  const canEditHistory = (history: EmploymentHistoryRecord) =>
    viewer?.role === "admin" ||
    (viewer?.role === "staff" &&
      history.id === latestHistoryByJoinDate?.id &&
      canViewHistoryInStaffScope(viewer, history, allWorkerHistories, managedFactoryIds));
  const isEditingOldHistory = Boolean(
    editingHistory && editingHistory.id !== latestHistoryByJoinDate?.id,
  );
  const activeHistory = useMemo(() => getCurrentEmploymentHistory(histories), [histories]);
  const recentRecruiter = isRecentRecruiter(viewer, histories);
  const canReportAdvanceForWorker = canReportAdvance(viewer, histories);
  const allowAdvanceAfterLeave = Boolean(settings.allow_advance_after_leave);
  const advanceInteractionAllowed = isAdvanceInteractionAllowed(settings, viewer?.role);
  const canOpenAdvanceForWorker =
    canReportAdvanceForWorker &&
    (Boolean(activeHistory) || allowAdvanceAfterLeave) &&
    advanceInteractionAllowed &&
    (!latestHistory?.recruiter_partner || viewer?.role === "admin");
  const canViewPayrollForWorker = canViewPayroll(viewer, histories, managedFactoryIds);
  const canReportLeaveForWorker = canReportLeave(
    viewer,
    activeHistory,
    histories,
    managedFactoryIds,
  );
  const canSubmitJoinForWorker = canReportJoin(
    viewer,
    histories,
    managedFactoryIds,
    joinForm.factory,
    settings.staff_employment_factory_scope,
  );
  const canOpenJoinForm = canReportJoin(
    viewer,
    histories,
    managedFactoryIds,
    undefined,
    settings.staff_employment_factory_scope,
  );
  const canUpdateBankForWorker = canUpdateBank(viewer, allWorkerHistories, managedFactoryIds);
  const canDoAnyAction =
    canOpenAdvanceForWorker ||
    canViewPayrollForWorker ||
    canReportLeaveForWorker ||
    canOpenJoinForm ||
    canUpdateBankForWorker;
  useEffect(() => {
    if (!advanceOpen || !workerUser?.id) return;
    let active = true;
    setAdvancePolicyLoading(true);
    resolveAdvancePolicy(workerUser.id, {
      allowAfterLeave: allowAdvanceAfterLeave,
      actorRole: viewer?.role,
    })
      .then((policy) => {
        if (!active) return;
        setAdvancePolicy(policy);
        setAdvancePolicyError("");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setAdvancePolicy(null);
        setAdvancePolicyError(
          getUserErrorMessage(error, "Không thể kiểm tra hạn mức ứng tiền"),
        );
      })
      .finally(() => active && setAdvancePolicyLoading(false));
    return () => {
      active = false;
    };
  }, [advanceOpen, allowAdvanceAfterLeave, viewer?.role, workerUser?.id]);

  const joinableFactories = useMemo(
    () =>
      filterEmploymentFactories(
        viewer,
        factories,
        managedFactoryIds,
        settings.staff_employment_factory_scope,
      ),
    [factories, managedFactoryIds, settings.staff_employment_factory_scope, viewer],
  );
  const latestLeaveDate = useMemo(() => {
    const dates = allWorkerHistories
      .map((h) => h.leave_date?.slice(0, 10))
      .filter((d): d is string => Boolean(d));
    if (!dates.length) return "";
    // ISO yyyy-mm-dd: sort chữ = sort thời gian
    return dates.sort()[dates.length - 1];
  }, [allWorkerHistories]);

  const reloadHistories = async () => {
    if (!viewer?.id) return;
    const workspace = await fetchStaffWorkerWorkspace(viewer as UserRecord, workerId);
    const nextRows = workspace.worker?.histories ?? [];
    const nextVisibleRows = filterHistoriesForStaffScope(viewer, nextRows, managedFactoryIds);
    setAllWorkerHistories(nextRows);
    setHistories(nextVisibleRows);
    const nextLatest = getLatestEmploymentHistory(nextRows);
  };

  const exportHistory = async () => {
    if (!histories.length) {
      toast.warning("Chưa có lịch sử để xuất");
      return;
    }

    exportToExcel(
      `lich_su_lao_dong_${workerId}_${Date.now()}`,
      {
        "Lịch sử đi làm": histories.map((history, index) => {
          const recruiter = getRecruiterDisplay(history);
          return {
            STT: index + 1,
            "Nhà máy": history.expand?.factory?.name || "",
            "Mã nhân viên": history.employee_code || "",
            "Họ tên tại nhà máy": history.worker_name_snapshot,
            CCCD: history.worker_cccd_snapshot,
            "Ngày sinh": formatDateOnly(history.worker_date_of_birth_snapshot),
            "Địa chỉ thường trú":
              history.worker_address_snapshot || history.hometown_snapshot || "",
            "Mã số thuế": history.worker_tax_code_snapshot || "",
            "Ngày cấp CCCD": formatDateOnly(history.cccd_issue_date),
            "Người tuyển": recruiter?.name || "",
            "Loại người tuyển": recruiter?.label || "",
            "Ngày vào": formatDateOnly(history.join_date),
            "Ngày nghỉ": formatDateOnly(history.leave_date),
            "Trạng thái": isCurrentlyWorking(history) ? "Đang làm" : "Đã nghỉ",
            "Ghi chú": history.note || "",
          };
        }),
      },
      { "Lịch sử đi làm": ["Ngày cấp CCCD", "Ngày vào", "Ngày nghỉ"] },
    );

    toast.success("Đã xuất Excel");
  };

  const submitAdvance = async () => {
    if (!workerUser || !latestHistory || !viewer?.id) return;
    if (!canOpenAdvanceForWorker) {
      toast.error("Bạn không có quyền báo ứng cho hồ sơ này");
      return;
    }

    const amount = Number(amountText.replace(/\D/g, ""));
    if (!amount) {
      toast.warning("Nhập số tiền ứng");
      return;
    }
    if (!advanceReason.trim()) {
      toast.warning("Nhập lý do ứng");
      return;
    }

    try {
      await assertAdvanceInteractionAllowed(viewer.role);
      const policy = await resolveAdvancePolicy(workerUser.id, {
        allowAfterLeave: allowAdvanceAfterLeave,
        actorRole: viewer.role,
      });
      validateAdvanceAmount(policy, amount);
      const employment = policy.employment;
      const payload = {
        user: workerUser.id,
        requested_by: viewer.id,
        recruiter_id: employment.recruiter_staff || "",
        employee_code: employment.employee_code || "",
        full_name: employment.worker_name_snapshot || workerUser.full_name || "",
        company: policy.factoryName,
        phone: workerUser.phone || "",
        join_date: employment.join_date || "",
        bank_name: advancePayoutMethod === "cash" ? "" : workerUser.bank_name || "",
        bank_account_number:
          advancePayoutMethod === "cash" ? "" : workerUser.bank_account_number || "",
        bank_account_name: advancePayoutMethod === "cash" ? "" : workerUser.bank_account_name || "",
        payout_method: advancePayoutMethod,
        amount,
        reason: advanceReason.trim(),
        status: "recruiter_approved",
        recovery_status: "none",
      };

      const created = await pb.collection("advances").create(payload);
      await createStaffActionLog({
        actor: viewer,
        targetUserId: workerUser.id,
        targetCollection: "advances",
        targetRecord: created.id,
        action: "report_advance",
        after: created,
        note: policy.isWorking
          ? "Staff tạo yêu cầu ứng lương thay người lao động"
          : "Staff tạo ứng cho NLĐ đã nghỉ theo cấu hình Admin",
      });

      setAdvanceOpen(false);
      setAmountText("");
      setAdvanceReason("");
      setAdvancePayoutMethod("bank_transfer");
      toast.success("Đã gửi yêu cầu ứng lương");
    } catch (error: unknown) {
      toast.error(getUserErrorMessage(error, "Không thể tạo yêu cầu ứng tiền"));
    }
  };

  const submitLeave = async () => {
    if (!canReportLeaveForWorker) {
      toast.error("Bạn không có quyền báo nghỉ cho hồ sơ này");
      return;
    }
    if (!activeHistory || !viewer?.id) {
      toast.warning("Không có bản ghi đang làm để báo nghỉ");
      return;
    }
    if (!leaveDate) {
      toast.warning("Chọn ngày nghỉ");
      return;
    }

    await updateEmploymentHistory(
      activeHistory.id,
      { leave_date: leaveDate, note: leaveNote.trim() },
      {
        actor: viewer,
        action: "report_leave",
        source: "Trang chi tiết người lao động",
        note: "Báo nghỉ cho nguoi lao dong",
        before: activeHistory,
      },
    );

    await reloadHistories();
    setLeaveOpen(false);
    setLeaveNote("");
    setLeaveDate(todayDate());
    toast.success("Đã cập nhật ngày nghỉ");
  };

  const submitJoin = async () => {
    if (!viewer?.id || !workerUser) return;
    if (!joinForm.factory) return toast.warning("Chọn nhà máy");
    if (!joinForm.join_date) return toast.warning("Nhập ngày vào làm");
    if (!joinForm.recruiter_staff) return toast.warning("Chọn người tuyển");
    if (!joinForm.main_house) return toast.warning("Chọn nhà chính");
    const missingSnapshotFields = getMissingEmploymentSnapshotFields(joinForm);
    if (missingSnapshotFields.length) {
      toast.warning(`Thiếu thông tin cá nhân: ${missingSnapshotFields.join(", ")}`);
      return;
    }
    if (!canSubmitJoinForWorker) {
      toast.error("Bạn không có quyền báo đi làm tại nhà máy đã chọn");
      return;
    }

    const latestHistories = await fetchEmploymentHistories([workerUser.id]);
    const active = getCurrentEmploymentHistory(latestHistories);
    if (active) {
      toast.error("Người lao động vẫn đang ở nhà máy cũ, cần báo nghỉ trước");
      return;
    }

    for (const history of getStaleWorkingEmploymentHistories(latestHistories)) {
      await updateEmploymentHistory(
          history.id,
          { status: "left" },
          {
        actor: viewer,
        source: "Trang chi tiết người lao động",
        note: "Báo đi làm mới: đồng bộ lịch sử đã có ngày nghỉ",
        before: history,
      });
    }

    if (latestLeaveDate && joinForm.join_date < latestLeaveDate) {
      toast.error(`Ngày vào không được cũ hơn ngày nghỉ gần nhất (${formatDate(latestLeaveDate)})`);
      return;
    }
    if (joinForm.join_date > todayDate()) {
      toast.warning("Ngày vào không được lớn hơn ngày hiện tại");
      return;
    }

    let cccdVersionId: string | undefined;
    const cccdNumber = joinForm.worker_cccd_snapshot.trim() || workerUser.cccd || "";
    if (joinCccdFront || joinCccdBack) {
      if (!cccdNumber) {
        toast.warning("Cần có số CCCD để lưu ảnh");
        return;
      }
      const [compressedFront, compressedBack] = await Promise.all([
        joinCccdFront ? compressImage(joinCccdFront) : Promise.resolve(null),
        joinCccdBack ? compressImage(joinCccdBack) : Promise.resolve(null),
      ]);
      const version = await findOrCreateCccdVersion(
        workerUser.id,
        cccdNumber,
        compressedFront,
        compressedBack,
      );
      cccdVersionId = version.id;
    } else {
      const reusableVersion =
        joinCccdVersion ||
        (cccdNumber ? await getCccdVersionByNumber(workerUser.id, cccdNumber) : null);
      cccdVersionId = reusableVersion?.id;
      if (!cccdVersionId) {
        const currentCccdVersion = await getCurrentCccdVersion(workerUser.id);
        if (
          currentCccdVersion &&
          normalizeCccdNumber(currentCccdVersion.cccd_number) === normalizeCccdNumber(cccdNumber)
        ) {
          cccdVersionId = currentCccdVersion.id;
        }
      }
    }

    const created = await createEmploymentHistory({
      user: workerUser.id,
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

    await reloadHistories();
    await createStaffActionLog({
      actor: viewer,
      targetUserId: workerUser.id,
      targetCollection: "employment_histories",
      targetRecord: created.id,
      action: "report_join",
      after: created,
      note: "Báo đi làm nhà máy mới",
    });

    setJoinOpen(false);
    setJoinCccdFront(null);
    setJoinCccdBack(null);
    toast.success("Đã tạo bản ghi đi làm mới");
  };

  const submitBankUpdate = async () => {
    if (!workerUser || !viewer?.id) return;
    if (!canUpdateBankForWorker) {
      toast.error("Bạn không có quyền cập nhật ngân hàng cho hồ sơ này");
      return;
    }

    const before = {
      bank_name: workerUser.bank_name || "",
      bank_account_number: workerUser.bank_account_number || "",
      bank_account_name: workerUser.bank_account_name || "",
      bank_account_note: workerUser.bank_account_note || "",
    };

    const payload = {
      ...bankForm,
      bank_name: resolveBankName(bankForm.bank_name.trim()),
    };
    const updatedUser = await updateUserAndCache(workerUser.id, payload);
    await createStaffActionLog({
      actor: viewer,
      targetUserId: workerUser.id,
      targetCollection: "users",
      targetRecord: workerUser.id,
      action: "update_bank",
      before,
      after: payload,
      note: "Cập nhật tài khoản ngân hàng cho user",
    });

    setWorkerUser(updatedUser);
    setBankOpen(false);
    toast.success("Đã cập nhật tài khoản ngân hàng");
  };

  const openEditHistory = (history: EmploymentHistoryRecord) => {
    if (!canEditHistory(history)) {
      toast.error("Staff chỉ được chỉnh sửa lịch sử có ngày vào gần nhất");
      return;
    }
    setEditingHistory(history);
    setEditCccdFront(null);
    setEditCccdBack(null);
    const personalSnapshot = getEmploymentPersonalSnapshot(history);
    setHistoryForm({
      employee_code: history.employee_code || "",
      ...personalSnapshot,
      hometown_snapshot: personalSnapshot.worker_address_snapshot,
      worker_tax_code_snapshot: history.worker_tax_code_snapshot || "",
      recruiter_staff: recruiterSelectionFromHistory(history),
      main_house: history.main_house || "",
      join_date: history.join_date?.slice(0, 10) || "",
      leave_date: history.leave_date?.slice(0, 10) || "",
      note: history.note || "",
    });
  };

  const openOldHistory = () => {
    if (!workerUser || viewer?.role !== "admin") return;
    const latest = getLatestEmploymentHistory(allWorkerHistories);
    const personalSnapshot = getEmploymentPersonalSnapshot(latest, workerUser);
    setOldHistoryForm({
      factory: "",
      main_house: latest?.main_house || "",
      employee_code: latest?.employee_code || "",
      ...personalSnapshot,
      hometown_snapshot: personalSnapshot.worker_address_snapshot,
      worker_tax_code_snapshot: latest?.worker_tax_code_snapshot || "",
      recruiter_staff: recruiterSelectionFromHistory(latest) || encodeInternalRecruiter(viewer.id),
      join_date: "",
      leave_date: "",
      note: "",
    });
    setOldHistoryCccdFront(null);
    setOldHistoryCccdBack(null);
    setOldHistoryOpen(true);
  };

  const submitOldHistory = async () => {
    if (!workerUser || viewer?.role !== "admin") {
      toast.error("Chỉ admin được bổ sung lịch sử cũ");
      return;
    }
    if (!oldHistoryForm.factory) return toast.warning("Chọn nhà máy");
    if (!oldHistoryForm.main_house) return toast.warning("Chọn nhà chính");
    if (!oldHistoryForm.recruiter_staff) return toast.warning("Chọn người tuyển");
    if (!oldHistoryForm.join_date) return toast.warning("Chọn ngày vào");
    if (!oldHistoryForm.leave_date) return toast.warning("Chọn ngày nghỉ");
    const missingSnapshotFields = getMissingEmploymentSnapshotFields(oldHistoryForm);
    if (missingSnapshotFields.length) {
      toast.warning(`Thiếu thông tin cá nhân: ${missingSnapshotFields.join(", ")}`);
      return;
    }
    if (oldHistoryForm.leave_date < oldHistoryForm.join_date) {
      toast.warning("Ngày nghỉ không được trước ngày vào");
      return;
    }
    if (oldHistoryForm.leave_date > todayDate()) {
      toast.warning("Ngày nghỉ không được lớn hơn ngày hiện tại");
      return;
    }

    setOldHistorySubmitting(true);
    try {
      const latestRows = await fetchEmploymentHistories([workerUser.id]);
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
        const version = await findOrCreateCccdVersion(workerId, cccdNumber);
        await updateCccdVersionImages(
          version.id,
          compressedFront || undefined,
          compressedBack || undefined,
        );
        cccdVersionId = version.id;
      }

      const created = await createEmploymentHistory({
        user: workerUser.id,
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

      await reloadHistories();
      await createStaffActionLog({
        actor: viewer,
        targetUserId: workerUser.id,
        targetCollection: "employment_histories",
        targetRecord: created.id,
        action: "create",
        after: created,
        note: "Admin bổ sung lịch sử đi làm cũ",
      });
      setOldHistoryOpen(false);
      setOldHistoryCccdFront(null);
      setOldHistoryCccdBack(null);
      toast.success("Đã bổ sung lịch sử đi làm cũ");
    } catch (error: unknown) {
      toast.error(getUserErrorMessage(error, "Không thể bổ sung lịch sử cũ"));
    } finally {
      setOldHistorySubmitting(false);
    }
  };

  const saveEditedHistory = async () => {
    if (!editingHistory || !viewer?.id) return;
    if (!canEditHistory(editingHistory)) {
      toast.error("Bạn không có quyền chỉnh sửa lịch sử này");
      setEditingHistory(null);
      return;
    }
    const missingEditFields = getMissingEmploymentEditFields(historyForm);
    if (missingEditFields.length) {
      toast.warning(`Thiếu thông tin bắt buộc: ${missingEditFields.join(", ")}`);
      return;
    }
    const before = { ...editingHistory };
    const isOldHistory = editingHistory.id !== latestHistoryByJoinDate?.id;
    const originalLeaveDate = before.leave_date || "";
    if (isOldHistory && historyForm.leave_date !== originalLeaveDate) {
      toast.error("Không được sửa ngày nghỉ của lịch sử cũ để tránh chồng chéo thời gian làm việc");
      setHistoryForm((current) => ({ ...current, leave_date: originalLeaveDate }));
      return;
    }
    let cccdVersionId = editingHistory.cccd_version;
    if (editCccdFront || editCccdBack) {
      const cccdNumber = historyForm.worker_cccd_snapshot.trim();
      if (!cccdNumber) {
        toast.warning("Cần có số CCCD để lưu ảnh");
        return;
      }
      const [compressedFront, compressedBack] = await Promise.all([
        editCccdFront ? compressImage(editCccdFront) : Promise.resolve(null),
        editCccdBack ? compressImage(editCccdBack) : Promise.resolve(null),
      ]);
      const version = await findOrCreateCccdVersion(workerId, cccdNumber);
      await updateCccdVersionImages(
        version.id,
        compressedFront || undefined,
        compressedBack || undefined,
      );
      cccdVersionId = version.id;
    }
    await updateEmploymentHistory(editingHistory.id, {
      worker: workerUser.id,
      employee_code: historyForm.employee_code.trim(),
      worker_name_snapshot: historyForm.worker_name_snapshot.trim(),
      worker_cccd_snapshot: historyForm.worker_cccd_snapshot.trim(),
      worker_date_of_birth_snapshot: historyForm.worker_date_of_birth_snapshot,
      worker_address_snapshot: historyForm.worker_address_snapshot.trim(),
      hometown_snapshot: historyForm.worker_address_snapshot.trim(),
      cccd_issue_date: historyForm.cccd_issue_date,
      worker_tax_code_snapshot: historyForm.worker_tax_code_snapshot.trim(),
      cccd_version: cccdVersionId,
      ...buildRecruiterPayload(historyForm.recruiter_staff),
      main_house: historyForm.main_house || undefined,
      join_date: historyForm.join_date,
      leave_date: isOldHistory ? originalLeaveDate : historyForm.leave_date,
      note: historyForm.note.trim(),
    }, {
      actor: viewer,
      source: "Biểu mẫu sửa lịch sử tại trang chi tiết",
      note:
        viewer.role === "admin"
          ? "Admin chỉnh sửa trực tiếp lịch sử đi làm"
          : "Staff chỉnh sửa lịch sử đi làm gần nhất",
      before,
    });

    await reloadHistories();

    setEditCccdFront(null);
    setEditCccdBack(null);
    setEditingHistory(null);
    toast.success("Đã lưu thay đổi lịch sử");
  };

  if (loading) {
    return (
      <PageContainer title="Chi tiết lao động" subtitle="Đang tải hồ sơ..." className="space-y-3">
        <DataLoadingState
          variant="list"
          label="Đang tải lịch sử đi làm và quyền thao tác..."
          rows={4}
        />
      </PageContainer>
    );
  }

  if (!workerUser) {
    return (
      <PageContainer title="Chi tiết lao động" subtitle="Không tìm thấy hồ sơ">
        <EmptyState
          icon={UserSquare2}
          title="Không tìm thấy user"
          description="Kiểm tra lại hồ sơ hoặc import lại dữ liệu trong phần admin."
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer
      title={workerUser.full_name || workerUser.username || "Chi tiết lao động"}
      subtitle={latestHistory?.expand?.factory?.name || "Chưa có nhà máy gần nhất"}
      className="min-w-0 overflow-x-hidden"
      right={
        <button
          type="button"
          onClick={exportHistory}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-card text-muted-foreground"
          aria-label="Xuất lịch sử"
        >
          <Download className="h-4 w-4" />
        </button>
      }
    >
      {!advanceInteractionAllowed && viewer?.role !== "admin" && <AdvanceReadOnlyNotice />}
      <div className="grid grid-cols-3 gap-2">
        <ActionButton
          icon={Wallet}
          label="Báo ứng"
          disabled={!canOpenAdvanceForWorker}
          onClick={() => {
            setAdvancePayoutMethod("bank_transfer");
            setAdvanceOpen(true);
          }}
        />
        <ActionButton
          icon={CalendarRange}
          label="Check công lương"
          disabled={!canViewPayrollForWorker}
          onClick={() => navigate({ to: "/staff/workers/$workerId/payroll", params: { workerId } })}
        />
        <ActionButton
          icon={Clock3}
          label="Báo nghỉ"
          disabled={!canReportLeaveForWorker}
          onClick={() => setLeaveOpen(true)}
        />
        <ActionButton
          icon={Plus}
          label="Báo đi làm mới"
          disabled={!canOpenJoinForm}
          onClick={() => setJoinOpen(true)}
        />
        <ActionButton
          icon={Landmark}
          label="Cập nhật ngân hàng"
          disabled={!canUpdateBankForWorker}
          onClick={() => setBankOpen(true)}
        />
        {canCreateSalaryHold(viewer, latestWorkerHistory) && (
          <ActionButton icon={Banknote} label="Giữ lương" onClick={() => setSalaryHoldOpen(true)} />
        )}
      </div>

      <Card className="space-y-3 rounded-2xl border-border/60 p-4 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {viewer?.role === "admin" ? (
              <StatusChip tone="info">Admin có toàn quyền sửa lịch sử</StatusChip>
            ) : recentRecruiter ? (
              <StatusChip tone="success">Bạn là người tuyển trong 3 lịch sử gần nhất</StatusChip>
            ) : canDoAnyAction ? (
              <StatusChip tone="info">Bạn có quyền theo nhà máy phụ trách</StatusChip>
            ) : (
              <StatusChip tone="neutral">Bạn chỉ có quyền xem</StatusChip>
            )}
            <StatusChip
              tone={latestHistory && isCurrentlyWorking(latestHistory) ? "success" : "neutral"}
            >
              {latestHistory && isCurrentlyWorking(latestHistory) ? "Đang làm" : "Đã nghỉ"}
            </StatusChip>
          </div>
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
          <div className="grid min-w-0 grid-cols-1 gap-2 text-sm min-[360px]:grid-cols-2">
            <InfoCell label="Họ tên gốc" value={workerUser.full_name || "Chưa có"} />
            <InfoCell label="CCCD gốc" value={workerUser.cccd || "Chưa có"} />
            <InfoCell label="Điện thoại" value={workerUser.phone || "Chưa có"} />
            <InfoCell
              label="Nhà máy gần nhất"
              value={latestHistory?.expand?.factory?.name || "Chưa có"}
            />
            <InfoCell label="Mã NV gần nhất" value={latestHistory?.employee_code || "Chưa có"} />
            <InfoCell
              label="Mã số thuế gần nhất"
              value={latestHistory?.worker_tax_code_snapshot || "Chưa có"}
            />
            <InfoCell
              label="Người tuyển gần nhất"
              value={(() => {
                const recruiter = getRecruiterDisplay(latestHistory);
                return recruiter ? `${recruiter.name} · ${recruiter.label}` : "Chưa gán";
              })()}
            />
          </div>
        )}
      </Card>

      {infoOpen && workerUser && (
        <div className="space-y-2">
          <div className="text-sm font-semibold">Ảnh CCCD</div>
          <CccdManager
            targetUser={workerUser}
            actor={viewer as UserRecord}
            readOnly
            onUpdated={async () => {
              const refreshed = await pb
                .collection("workers")
                .getOne<WorkerRecord>(workerId)
                .catch(() => null);
              if (refreshed) setWorkerUser(refreshed);
            }}
          />
        </div>
      )}

      {canReportAdvanceForWorker && advances.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-semibold">Tình trạng báo ứng</div>
          {advances.slice(0, 10).map((adv) => (
            <Card
              key={adv.id}
              className="min-w-0 space-y-1 overflow-hidden rounded-2xl border-border/60 p-4 shadow-soft"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{formatMoney(adv.amount || 0)}</div>
                  {adv.reason && (
                    <div className="mt-0.5 break-words text-[11px] text-muted-foreground [overflow-wrap:anywhere]">
                      {adv.reason}
                    </div>
                  )}
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {formatDate(adv.created)}
                  </div>
                  <div className="mt-1 text-[11px] font-medium text-primary">
                    {PAYOUT_METHOD_META[normalizeAdvancePayoutMethod(adv.payout_method)].label}
                  </div>
                </div>
                <AdvanceStatusChip status={adv.status} recoveryStatus={adv.recovery_status} />
              </div>
            </Card>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold">Lịch sử đi làm theo nhà máy</div>
          {viewer?.role === "admin" && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="rounded-xl"
              onClick={openOldHistory}
            >
              <Plus className="h-4 w-4" />
            </Button>
          )}
        </div>
        {histories.length === 0 ? (
          <EmptyState
            icon={NotebookPen}
            title="Chưa có lịch sử đi làm"
            description="Admin có thể import Excel hoặc staff có quyền có thể báo đi làm nhà máy mới."
          />
        ) : (
          histories.map((history) => (
            <Card
              key={history.id}
              className="min-w-0 cursor-pointer space-y-3 overflow-hidden rounded-2xl border-border/60 p-4 shadow-soft transition-colors hover:bg-muted/30"
              onClick={() => setDetailHistory(history)}
            >
              <div className="flex min-w-0 flex-col items-stretch gap-3 min-[360px]:flex-row min-[360px]:items-start min-[360px]:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">
                    {history.expand?.factory?.name || "Nhà máy"}
                  </div>
                  <div className="mt-0.5 break-words text-[11px] text-muted-foreground [overflow-wrap:anywhere]">
                    {history.worker_name_snapshot} · CCCD: {maskCccd(history.worker_cccd_snapshot)}
                    {history.cccd_version && (
                      <span className="ml-1 inline-flex items-center gap-0.5 text-primary">
                        <IdCard className="inline h-3 w-3" />
                        <span>Có ảnh</span>
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 break-words text-[11px] text-muted-foreground [overflow-wrap:anywhere]">
                    Mã số thuế: {history.worker_tax_code_snapshot || "Chưa có"}
                  </div>
                  <div className="mt-0.5 break-words text-[11px] text-muted-foreground [overflow-wrap:anywhere]">
                    Mã NV: {history.employee_code || "Chưa có"} · Người tuyển:{" "}
                    {(() => {
                      const recruiter = getRecruiterDisplay(history);
                      return recruiter ? `${recruiter.name} · ${recruiter.label}` : "Chưa gán";
                    })()}
                  </div>
                  <div className="mt-0.5 break-words text-[11px] text-muted-foreground [overflow-wrap:anywhere]">
                    Nhà chính: {history.expand?.main_house?.name || "Chưa gán"}
                  </div>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2 self-start">
                  <StatusChip tone={isCurrentlyWorking(history) ? "success" : "neutral"}>
                    {isCurrentlyWorking(history) ? "Đang làm" : "Đã nghỉ"}
                  </StatusChip>
                  {canEditHistory(history) && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditHistory(history);
                      }}
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 text-muted-foreground"
                      aria-label="Sửa lịch sử"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              <div className="grid min-w-0 grid-cols-1 gap-2 text-sm min-[360px]:grid-cols-2">
                <InfoCell label="Ngày vào" value={formatDate(history.join_date)} />
                <InfoCell label="Ngày nghỉ" value={formatDate(history.leave_date)} />
              </div>

              {history.note && (
                <div className="break-words rounded-xl bg-muted/40 p-3 text-sm text-muted-foreground [overflow-wrap:anywhere]">
                  {history.note}
                </div>
              )}
            </Card>
          ))
        )}
      </div>

      <Dialog open={advanceOpen} onOpenChange={setAdvanceOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>Báo ứng lương</DialogTitle>
            <DialogDescription>
              Tạo yêu cầu ứng lương cho người lao động từ hồ sơ gần nhất.
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
            {advancePolicyLoading && (
              <div className="rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
                Đang kiểm tra nhà máy và hạn mức ứng tiền...
              </div>
            )}
            {advancePolicyError && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                {advancePolicyError}
              </div>
            )}
            {advancePolicy && (
              <div className="rounded-xl border bg-primary/5 p-3 text-xs">
                <div>
                  <span className="text-muted-foreground">Nhà máy áp dụng: </span>
                  <span className="font-semibold">{advancePolicy.factoryName}</span>
                </div>
                <div className="mt-1 text-muted-foreground">
                  Hạn mức {advancePolicy.limit.toLocaleString("vi-VN")} đ · Còn lại{" "}
                  {advancePolicy.available.toLocaleString("vi-VN")} đ
                </div>
              </div>
            )}
            <AdvancePayoutMethodPicker
              value={advancePayoutMethod}
              onChange={setAdvancePayoutMethod}
            />
            <FormField label="Số tiền">
              <Input
                value={amountText}
                onChange={(event) => setAmountText(event.target.value.replace(/[^\d]/g, ""))}
                inputMode="numeric"
                placeholder="Nhập số tiền"
                className="rounded-xl"
              />
            </FormField>
            <FormField label="Lý do">
              <Textarea
                value={advanceReason}
                onChange={(event) => setAdvanceReason(event.target.value)}
                rows={4}
                className="rounded-xl"
                placeholder="Ví dụ: ứng tiền sinh hoạt, ứng trước kỳ lương..."
              />
            </FormField>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAdvanceOpen(false)}
                className="rounded-xl"
              >
                Đóng
              </Button>
              <Button
                type="submit"
                className="rounded-xl"
                disabled={
                  advancePolicyLoading ||
                  !advancePolicy ||
                  Boolean(advancePolicyError) ||
                  !advanceInteractionAllowed
                }
              >
                Gửi yêu cầu
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Drawer open={leaveOpen} onOpenChange={setLeaveOpen}>
        <DrawerContent className="max-h-[88dvh]">
          <DrawerHeader>
            <DrawerTitle>Báo nghỉ nhà máy hiện tại</DrawerTitle>
            <DrawerDescription>
              Chỉ áp dụng với bản ghi đang làm hiện tại của người lao động.
            </DrawerDescription>
          </DrawerHeader>
          <form
            className="space-y-3 overflow-y-auto px-4 pb-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submitLeave();
            }}
          >
            <FormField label="Ngày nghỉ">
              <DateInput
                value={leaveDate}
                onChange={(v) => setLeaveDate(v)}
                className="rounded-xl"
              />
            </FormField>
            <FormField label="Ghi chú">
              <Textarea
                value={leaveNote}
                onChange={(event) => setLeaveNote(event.target.value)}
                rows={4}
                className="rounded-xl"
                placeholder="Ví dụ: nghỉ việc, chuyển nhà máy, nghỉ tạm thời..."
              />
            </FormField>
            <DrawerFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setLeaveOpen(false)}
                className="rounded-xl"
              >
                Đóng
              </Button>
              <Button type="submit" className="rounded-xl">
                Cập nhật ngày nghỉ
              </Button>
            </DrawerFooter>
          </form>
        </DrawerContent>
      </Drawer>

      <Drawer open={joinOpen} onOpenChange={setJoinOpen}>
        <DrawerContent className="max-h-[90dvh]">
          <DrawerHeader>
            <DrawerTitle>Báo đi làm nhà máy mới</DrawerTitle>
            <DrawerDescription>
              Hồ sơ cũ phải kết thúc trước khi tạo bản ghi đi làm mới. Ngày vào không được cũ hơn
              ngày nghỉ gần nhất.
            </DrawerDescription>
          </DrawerHeader>
          <form
            className="space-y-3 overflow-y-auto px-4 pb-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submitJoin();
            }}
          >
            <div className="text-sm font-semibold">Thông tin đi làm</div>
            <FormField label="Nhà máy">
              <FactoryPicker
                factories={joinableFactories}
                value={joinForm.factory}
                onChange={(value) => setJoinForm((current) => ({ ...current, factory: value }))}
                triggerClassName="rounded-xl"
              />
            </FormField>
            <FormField label="Nhà chính">
              <MainHousePicker
                mainHouses={mainHouses}
                value={joinForm.main_house}
                onChange={(value) => setJoinForm((current) => ({ ...current, main_house: value }))}
                triggerClassName="rounded-xl"
              />
            </FormField>
            <FormField label="Mã NV">
              <Input
                value={joinForm.employee_code}
                onChange={(event) =>
                  setJoinForm((current) => ({ ...current, employee_code: event.target.value }))
                }
                className="rounded-xl"
              />
            </FormField>
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
            <FormField label="Mã số thuế">
              <Input
                value={joinForm.worker_tax_code_snapshot}
                onChange={(event) =>
                  setJoinForm((current) => ({
                    ...current,
                    worker_tax_code_snapshot: event.target.value.replace(/[^\d]/g, ""),
                  }))
                }
                inputMode="numeric"
                className="rounded-xl"
              />
            </FormField>
            <FormField label="Ngày vào">
              <DateInput
                value={joinForm.join_date}
                min={latestLeaveDate || undefined}
                max={todayDate()}
                onChange={(v) => setJoinForm((current) => ({ ...current, join_date: v }))}
                className="rounded-xl"
              />
              {latestLeaveDate && (
                <p className="text-xs text-muted-foreground">
                  Ngày nghỉ gần nhất: {formatDate(latestLeaveDate)}. Ngày vào không được cũ hơn ngày
                  này.
                </p>
              )}
            </FormField>
            <FormField label="Người tuyển">
              <RecruiterPicker
                value={joinForm.recruiter_staff as RecruiterSelectionValue}
                onChange={(value) =>
                  setJoinForm((current) => ({ ...current, recruiter_staff: value }))
                }
                internalUsers={staffUsers}
                partners={mainHouses}
              />
            </FormField>
            <FormField label="Ghi chú">
              <Textarea
                value={joinForm.note}
                onChange={(event) =>
                  setJoinForm((current) => ({ ...current, note: event.target.value }))
                }
                rows={4}
                className="rounded-xl"
              />
            </FormField>

            <DrawerFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setJoinOpen(false)}
                className="rounded-xl"
              >
                Đóng
              </Button>
              <Button type="submit" disabled={!canSubmitJoinForWorker} className="rounded-xl">
                Tạo bản ghi đi làm
              </Button>
            </DrawerFooter>
          </form>
        </DrawerContent>
      </Drawer>

      <Dialog open={bankOpen} onOpenChange={setBankOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>Cập nhật tài khoản ngân hàng</DialogTitle>
            <DialogDescription>
              Cập nhật trực tiếp thông tin ngân hàng của user gốc.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submitBankUpdate();
            }}
          >
            <FormField label="Ngân hàng">
              <BankNameInput
                value={bankForm.bank_name}
                onChange={(value) => setBankForm((current) => ({ ...current, bank_name: value }))}
              />
            </FormField>
            <FormField label="Số tài khoản">
              <Input
                value={bankForm.bank_account_number}
                onChange={(event) =>
                  setBankForm((current) => ({
                    ...current,
                    bank_account_number: event.target.value.replace(/\D/g, ""),
                  }))
                }
                className="rounded-xl"
              />
            </FormField>
            <FormField label="Tên chủ tài khoản">
              <Input
                value={bankForm.bank_account_name}
                onChange={(event) =>
                  setBankForm((current) => ({ ...current, bank_account_name: event.target.value }))
                }
                className="rounded-xl"
              />
            </FormField>
            <FormField label="Ghi chú STK">
              <Textarea
                value={bankForm.bank_account_note}
                onChange={(event) =>
                  setBankForm((current) => ({ ...current, bank_account_note: event.target.value }))
                }
                placeholder="Ghi chú thêm về tài khoản"
                rows={2}
                className="rounded-xl"
              />
            </FormField>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setBankOpen(false)}
                className="rounded-xl"
              >
                Đóng
              </Button>
              <Button type="submit" className="rounded-xl">
                Lưu tài khoản
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {viewer && (
        <SalaryHoldCreateDialog
          open={salaryHoldOpen}
          onOpenChange={setSalaryHoldOpen}
          viewer={viewer}
          worker={workerUser}
          history={latestWorkerHistory}
        />
      )}

      <Dialog open={oldHistoryOpen} onOpenChange={setOldHistoryOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Bổ sung lịch sử đi làm cũ</DialogTitle>
            <DialogDescription>
              Bản ghi này luôn có trạng thái Đã nghỉ và không được trùng thời gian với lịch sử khác.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submitOldHistory();
            }}
          >
            <FormField label="Nhà máy *">
              <FactoryPicker
                factories={factories}
                value={oldHistoryForm.factory}
                onChange={(value) =>
                  setOldHistoryForm((current) => ({ ...current, factory: value }))
                }
                triggerClassName="rounded-xl"
              />
            </FormField>
            <FormField label="Nhà chính *">
              <MainHousePicker
                mainHouses={mainHouses}
                value={oldHistoryForm.main_house}
                onChange={(value) =>
                  setOldHistoryForm((current) => ({ ...current, main_house: value }))
                }
                triggerClassName="rounded-xl"
              />
            </FormField>
            <FormField label="Người tuyển *">
              <RecruiterPicker
                value={oldHistoryForm.recruiter_staff as RecruiterSelectionValue}
                onChange={(value) =>
                  setOldHistoryForm((current) => ({ ...current, recruiter_staff: value }))
                }
                internalUsers={staffUsers}
                partners={mainHouses}
              />
            </FormField>
            <FormField label="Mã NV">
              <Input
                value={oldHistoryForm.employee_code}
                onChange={(event) =>
                  setOldHistoryForm((current) => ({
                    ...current,
                    employee_code: event.target.value,
                  }))
                }
                className="rounded-xl"
              />
            </FormField>
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
            <FormField label="Mã số thuế">
              <Input
                value={oldHistoryForm.worker_tax_code_snapshot}
                onChange={(event) =>
                  setOldHistoryForm((current) => ({
                    ...current,
                    worker_tax_code_snapshot: event.target.value.replace(/[^\d]/g, ""),
                  }))
                }
                inputMode="numeric"
                className="rounded-xl"
              />
            </FormField>
            <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2">
              <FormField label="Ngày vào *">
                <DateInput
                  value={oldHistoryForm.join_date}
                  max={oldHistoryForm.leave_date || todayDate()}
                  onChange={(v) =>
                    setOldHistoryForm((current) => ({
                      ...current,
                      join_date: v,
                    }))
                  }
                  className="rounded-xl"
                />
              </FormField>
              <FormField label="Ngày nghỉ *">
                <DateInput
                  value={oldHistoryForm.leave_date}
                  min={oldHistoryForm.join_date}
                  max={todayDate()}
                  onChange={(v) =>
                    setOldHistoryForm((current) => ({
                      ...current,
                      leave_date: v,
                    }))
                  }
                  className="rounded-xl"
                />
              </FormField>
            </div>
            <FormField label="Ghi chú">
              <Textarea
                value={oldHistoryForm.note}
                onChange={(event) =>
                  setOldHistoryForm((current) => ({ ...current, note: event.target.value }))
                }
                rows={3}
                placeholder="Ví dụ: bổ sung hồ sơ làm việc trước đây..."
                className="rounded-xl"
              />
            </FormField>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOldHistoryOpen(false)}
                disabled={oldHistorySubmitting}
              >
                Đóng
              </Button>
              <Button type="submit" disabled={oldHistorySubmitting} className="rounded-xl">
                {oldHistorySubmitting ? "Đang lưu..." : "Lưu lịch sử cũ"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingHistory} onOpenChange={(open) => !open && setEditingHistory(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle>Sửa lịch sử đi làm</DialogTitle>
            <DialogDescription>
              Admin được sửa mọi lịch sử; Staff chỉ được sửa lịch sử gần nhất.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void saveEditedHistory();
            }}
          >
            <FormField label="Mã NV">
              <Input
                value={historyForm.employee_code}
                onChange={(event) =>
                  setHistoryForm((current) => ({ ...current, employee_code: event.target.value }))
                }
                className="rounded-xl"
              />
            </FormField>
            <div className="space-y-2">
              <div className="text-sm font-semibold">Thông tin CCCD</div>
              <JoinCccdSection
                value={historyForm}
                onChange={(changes) => setHistoryForm((current) => ({ ...current, ...changes }))}
                frontFile={editCccdFront}
                backFile={editCccdBack}
                onFrontFileChange={setEditCccdFront}
                onBackFileChange={setEditCccdBack}
              />
            </div>
            <FormField label="Mã số thuế">
              <Input
                value={historyForm.worker_tax_code_snapshot}
                onChange={(event) =>
                  setHistoryForm((current) => ({
                    ...current,
                    worker_tax_code_snapshot: event.target.value.replace(/[^\d]/g, ""),
                  }))
                }
                inputMode="numeric"
                className="rounded-xl"
              />
            </FormField>
            <FormField label="Người tuyển">
              <RecruiterPicker
                value={historyForm.recruiter_staff as RecruiterSelectionValue}
                onChange={(value) =>
                  setHistoryForm((current) => ({ ...current, recruiter_staff: value }))
                }
                internalUsers={staffUsers}
                partners={mainHouses}
              />
            </FormField>
            <FormField label="Nhà chính">
              <MainHousePicker
                mainHouses={mainHouses}
                value={historyForm.main_house}
                onChange={(value) =>
                  setHistoryForm((current) => ({ ...current, main_house: value }))
                }
                triggerClassName="rounded-xl"
                allowClear
              />
            </FormField>
            <div className="grid min-w-0 grid-cols-1 gap-3 min-[360px]:grid-cols-2">
              <FormField label="Ngày vào">
                <DateInput
                  value={historyForm.join_date}
                  onChange={(v) => setHistoryForm((current) => ({ ...current, join_date: v }))}
                  className="rounded-xl"
                />
              </FormField>
              <FormField label={`Ngày nghỉ${isEditingOldHistory ? " (không được sửa)" : ""}`}>
                <DateInput
                  value={historyForm.leave_date}
                  onChange={(v) => setHistoryForm((current) => ({ ...current, leave_date: v }))}
                  disabled={isEditingOldHistory}
                  className="rounded-xl"
                />
                {isEditingOldHistory && (
                  <div className="text-[11px] text-muted-foreground">
                    Lịch sử cũ giữ nguyên ngày nghỉ để không làm chồng chéo thời gian đi làm.
                  </div>
                )}
              </FormField>
            </div>
            <FormField label="Ghi chú">
              <Textarea
                value={historyForm.note}
                onChange={(event) =>
                  setHistoryForm((current) => ({ ...current, note: event.target.value }))
                }
                rows={4}
                className="rounded-xl"
              />
            </FormField>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditingHistory(null)}
                className="rounded-xl"
              >
                Đóng
              </Button>
              <Button type="submit" className="rounded-xl">
                Lưu thay đổi
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Drawer open={!!detailHistory} onOpenChange={(open) => !open && setDetailHistory(null)}>
        <DrawerContent className="max-h-[85vh] w-full max-w-full overflow-hidden">
          <DrawerHeader className="min-w-0">
            <DrawerTitle className="break-words [overflow-wrap:anywhere]">
              Thông tin cá nhân tại thời điểm đi làm
            </DrawerTitle>
            <DrawerDescription className="break-words [overflow-wrap:anywhere]">
              {detailHistory?.expand?.factory?.name || "Nhà máy"} ·{" "}
              {detailHistory?.worker_name_snapshot}
            </DrawerDescription>
          </DrawerHeader>
          {detailHistory && (
            <div className="min-w-0 space-y-4 overflow-x-hidden overflow-y-auto px-4 pb-6">
              {!canEditHistory(detailHistory) && (
                <div className="rounded-xl border border-border/60 bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
                  Lịch sử cũ · Chỉ xem
                </div>
              )}
              <div className="grid min-w-0 grid-cols-1 gap-2 text-sm min-[360px]:grid-cols-2">
                <InfoCell label="Nhà máy" value={detailHistory.expand?.factory?.name || "—"} />
                <InfoCell
                  label="Trạng thái"
                  value={isCurrentlyWorking(detailHistory) ? "Đang làm" : "Đã nghỉ"}
                />
                <InfoCell label="Ngày vào" value={formatDate(detailHistory.join_date)} />
                <InfoCell label="Ngày nghỉ" value={formatDate(detailHistory.leave_date)} />
                <InfoCell label="Mã NV" value={detailHistory.employee_code || "Chưa có"} />
                <InfoCell label="CCCD" value={detailHistory.worker_cccd_snapshot || "—"} />
                <InfoCell
                  label="Ngày sinh"
                  value={formatDate(detailHistory.worker_date_of_birth_snapshot)}
                />
                <InfoCell label="Ngày cấp CCCD" value={formatDate(detailHistory.cccd_issue_date)} />
                <InfoCell
                  label="Địa chỉ thường trú"
                  value={
                    detailHistory.worker_address_snapshot ||
                    detailHistory.hometown_snapshot ||
                    "Chưa có"
                  }
                />
                <InfoCell
                  label="Mã số thuế"
                  value={detailHistory.worker_tax_code_snapshot || "Chưa có"}
                />
                <InfoCell
                  label="Người tuyển"
                  value={(() => {
                    const recruiter = getRecruiterDisplay(detailHistory);
                    return recruiter ? `${recruiter.name} · ${recruiter.label}` : "Chưa gán";
                  })()}
                />
                <InfoCell
                  label="Nhà chính"
                  value={detailHistory.expand?.main_house?.name || "Chưa gán"}
                />
              </div>

              {detailHistory.note && (
                <div className="break-words rounded-xl bg-muted/40 p-3 text-sm text-muted-foreground [overflow-wrap:anywhere]">
                  {detailHistory.note}
                </div>
              )}

              <div className="space-y-2">
                <div className="text-sm font-semibold">Ảnh CCCD</div>
                {detailLoading ? (
                  <DataLoadingState variant="inline" label="Đang tải ảnh CCCD..." />
                ) : detailCccdVersion ? (
                  <HistoryCccdImages
                    version={detailCccdVersion}
                    history={detailHistory}
                    actor={viewer as UserRecord}
                    readOnly={!canEditHistory(detailHistory)}
                    onUpdated={(updatedVersion) => setDetailCccdVersion(updatedVersion)}
                  />
                ) : (
                  <HistoryCccdUpload
                    history={detailHistory}
                    actor={viewer as UserRecord}
                    readOnly={!canEditHistory(detailHistory)}
                    onCreated={async (version) => {
                      setDetailCccdVersion(version);
                      setDetailHistory((current) =>
                        current?.id === detailHistory.id
                          ? { ...current, cccd_version: version.id }
                          : current,
                      );
                      await reloadHistories();
                    }}
                  />
                )}
              </div>
            </div>
          )}
          {detailHistory && canEditHistory(detailHistory) && (
            <DrawerFooter className="border-t border-border/60 px-4 py-3">
              <Button
                type="button"
                className="w-full rounded-xl"
                onClick={() => {
                  const history = detailHistory;
                  setDetailHistory(null);
                  openEditHistory(history);
                }}
              >
                <Pencil className="h-4 w-4" /> Sửa lịch sử
              </Button>
            </DrawerFooter>
          )}
        </DrawerContent>
      </Drawer>
    </PageContainer>
  );
}

function ActionButton({
  icon: Icon,
  label,
  disabled,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-[64px] min-w-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border border-border/60 bg-card px-2 py-2 text-center shadow-soft disabled:cursor-not-allowed disabled:opacity-45"
    >
      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <div className="break-words text-[11px] font-medium leading-tight [overflow-wrap:anywhere]">
        {label}
      </div>
    </button>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-2xl bg-muted/35 p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-sm font-semibold [overflow-wrap:anywhere]">{value}</div>
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function formatDate(value?: string) {
  if (!value) return "Chưa có";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("vi-VN");
}

function todayDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function versionedCccdUrl(version: CccdVersionRecord, filename?: string) {
  const url = fileUrl(version, filename);
  if (!url) return "";
  const cacheKey = version.updated || version.id;
  return url + (url.includes("?") ? "&" : "?") + "v=" + encodeURIComponent(cacheKey);
}

function HistoryCccdImages({
  version,
  history,
  actor,
  readOnly,
  onUpdated,
}: {
  version: CccdVersionRecord;
  history: EmploymentHistoryRecord;
  actor: Partial<UserRecord> | null;
  readOnly: boolean;
  onUpdated: (version: CccdVersionRecord) => void | Promise<void>;
}) {
  const [uploading, setUploading] = useState(false);
  const [zoomSrc, setZoomSrc] = useState("");

  const frontUrl = version.front_image ? versionedCccdUrl(version, version.front_image) : "";
  const backUrl = version.back_image ? versionedCccdUrl(version, version.back_image) : "";

  const upload =
    (side: "front_image" | "back_image") => async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      if (readOnly) {
        toast.error("Bạn không có quyền cập nhật ảnh CCCD của lịch sử này");
        e.target.value = "";
        return;
      }
      setUploading(true);
      try {
        const compressed = await compressImage(file);
        const updatedVersion = await updateCccdVersionImages(
          version.id,
          side === "front_image" ? compressed : undefined,
          side === "back_image" ? compressed : undefined,
        );
        await onUpdated(updatedVersion);
        toast.success("Đã cập nhật ảnh CCCD");
      } catch (error: unknown) {
        toast.error(getUserErrorMessage(error, "Lỗi upload ảnh"));
      } finally {
        setUploading(false);
        e.target.value = "";
      }
    };

  const remove = async (side: "front_image" | "back_image") => {
    if (readOnly) {
      toast.error("Bạn không có quyền xoá ảnh CCCD của lịch sử này");
      return;
    }
    if (!confirm(`Xoá ảnh ${side === "front_image" ? "mặt trước" : "mặt sau"}?`)) return;
    setUploading(true);
    try {
      const updatedVersion = await updateCccdVersionAndCache(version.id, { [side]: null });
      await onUpdated(updatedVersion);
      toast.success("Đã xoá ảnh CCCD");
    } catch (error: unknown) {
      toast.error(getUserErrorMessage(error, "Lỗi xoá ảnh"));
    } finally {
      setUploading(false);
    }
  };

  const download = async (url: string, label: string) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `CCCD_${history.worker_name_snapshot}_${label}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } catch {
      toast.error("Không tải được ảnh");
    }
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <CccdImageSlot
          label="Mặt trước"
          url={frontUrl}
          readOnly={readOnly}
          uploading={uploading}
          onPick={upload("front_image")}
          onDelete={() => remove("front_image")}
          onZoom={() => setZoomSrc(frontUrl)}
          onDownload={() => download(frontUrl, "mat_truoc")}
        />
        <CccdImageSlot
          label="Mặt sau"
          url={backUrl}
          readOnly={readOnly}
          uploading={uploading}
          onPick={upload("back_image")}
          onDelete={() => remove("back_image")}
          onZoom={() => setZoomSrc(backUrl)}
          onDownload={() => download(backUrl, "mat_sau")}
        />
      </div>
      <Dialog open={!!zoomSrc} onOpenChange={() => setZoomSrc("")}>
        <DialogContent className="max-w-[92vw] rounded-2xl p-2">
          <DialogHeader>
            <DialogTitle>Ảnh CCCD</DialogTitle>
          </DialogHeader>
          {zoomSrc && <img src={zoomSrc} alt="CCCD" className="w-full rounded-xl" />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function CccdImageSlot({
  label,
  url,
  readOnly,
  uploading,
  onPick,
  onDelete,
  onZoom,
  onDownload,
}: {
  label: string;
  url: string;
  readOnly: boolean;
  uploading: boolean;
  onPick: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDelete: () => void;
  onZoom: () => void;
  onDownload: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="relative aspect-[1.586/1] overflow-hidden rounded-xl border border-dashed border-border bg-white">
        {url ? (
          <>
            <img src={url} alt={label} className="h-full w-full object-cover" />
            <div className="absolute inset-x-0 bottom-0 flex justify-center gap-1.5 bg-gradient-to-t from-black/50 to-transparent px-2 pb-1.5 pt-4">
              <button
                type="button"
                onClick={onZoom}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-foreground shadow"
                aria-label="Phóng to"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={onDownload}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-foreground shadow"
                aria-label="Tải xuống"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
              {!readOnly && (
                <button
                  type="button"
                  onClick={onDelete}
                  disabled={uploading}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-destructive shadow"
                  aria-label="Xoá"
                >
                  <Trash className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </>
        ) : readOnly ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
            <IdCard className="h-6 w-6" />
            <span className="text-[11px]">Chưa có ảnh</span>
          </div>
        ) : (
          <label className="flex h-full w-full cursor-pointer flex-col items-center justify-center gap-1 text-muted-foreground">
            <input type="file" accept="image/*" hidden onChange={onPick} disabled={uploading} />
            <IdCard className="h-6 w-6" />
            <span className="text-[11px] font-medium">Bấm để chọn ảnh</span>
          </label>
        )}
      </div>
      {url && !readOnly && (
        <label className="block cursor-pointer">
          <input type="file" accept="image/*" hidden onChange={onPick} disabled={uploading} />
          <span className="inline-flex items-center gap-1 text-[11px] text-primary">
            <ImagePlus className="h-3 w-3" /> Đổi ảnh
          </span>
        </label>
      )}
    </div>
  );
}

function HistoryCccdUpload({
  history,
  actor,
  readOnly,
  onCreated,
}: {
  history: EmploymentHistoryRecord;
  actor: Partial<UserRecord> | null;
  readOnly: boolean;
  onCreated: (version: CccdVersionRecord) => void;
}) {
  const [uploading, setUploading] = useState(false);

  const handleUpload =
    (side: "front" | "back") => async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      if (readOnly) {
        toast.error("Bạn không có quyền thêm ảnh CCCD cho lịch sử này");
        e.target.value = "";
        return;
      }
      const userId = history.worker;
      const cccdNumber = history.worker_cccd_snapshot;
      if (!cccdNumber) {
        toast.error("Không có số CCCD để tạo phiên bản");
        return;
      }
      setUploading(true);
      try {
        const version = await findOrCreateCccdVersion(userId, cccdNumber);
        await updateEmploymentHistory(
          history.id,
          { cccd_version: version.id },
          {
            actor,
            source: "Ảnh CCCD trong chi tiết lịch sử",
            note: "Liên kết phiên bản CCCD trước khi tải ảnh",
            before: history,
          },
        );
        const compressed = await compressImage(file);
        const updatedVersion = await updateCccdVersionImages(
          version.id,
          side === "front" ? compressed : undefined,
          side === "back" ? compressed : undefined,
        );
        toast.success("Đã thêm ảnh CCCD");
        onCreated(updatedVersion);
      } catch (error: unknown) {
        toast.error(getUserErrorMessage(error, "Lỗi upload ảnh"));
      } finally {
        setUploading(false);
        e.target.value = "";
      }
    };

  if (readOnly) {
    return (
      <div className="grid grid-cols-2 gap-3">
        <CccdImageSlot
          label="Mặt trước"
          url=""
          readOnly
          uploading={false}
          onPick={() => undefined}
          onDelete={() => undefined}
          onZoom={() => undefined}
          onDownload={() => undefined}
        />
        <CccdImageSlot
          label="Mặt sau"
          url=""
          readOnly
          uploading={false}
          onPick={() => undefined}
          onDelete={() => undefined}
          onZoom={() => undefined}
          onDownload={() => undefined}
        />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Mặt trước</Label>
        <label className="flex aspect-[1.586/1] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border bg-white text-muted-foreground">
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={handleUpload("front")}
            disabled={uploading}
          />
          <IdCard className="h-6 w-6" />
          <span className="text-[11px] font-medium">Bấm để chọn ảnh</span>
        </label>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Mặt sau</Label>
        <label className="flex aspect-[1.586/1] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border bg-white text-muted-foreground">
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={handleUpload("back")}
            disabled={uploading}
          />
          <IdCard className="h-6 w-6" />
          <span className="text-[11px] font-medium">Bấm để chọn ảnh</span>
        </label>
      </div>
    </div>
  );
}

function AdvanceStatusChip({
  status,
  recoveryStatus,
}: {
  status?: string;
  recoveryStatus?: string;
}) {
  if (status === "rejected") return <StatusChip tone="danger">Từ chối</StatusChip>;
  if (status === "pending") return <StatusChip tone="warning">Chờ duyệt</StatusChip>;
  if (status === "accepted" && recoveryStatus === "recovered")
    return <StatusChip tone="success">Đã thu hồi</StatusChip>;
  if (status === "accepted" && recoveryStatus === "partial")
    return <StatusChip tone="info">Thu hồi 1 phần</StatusChip>;
  if (status === "accepted") return <StatusChip tone="success">Đã duyệt</StatusChip>;
  return <StatusChip tone="neutral">{status || "—"}</StatusChip>;
}
