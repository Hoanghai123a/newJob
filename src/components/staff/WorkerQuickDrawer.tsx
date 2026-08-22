import { useEffect, useMemo, useState } from "react";
import {
  CalendarRange,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock3,
  Hash,
  Landmark,
  Plus,
  UserSquare2,
  Wallet,
} from "lucide-react";
import { companyPayload } from "@/lib/tenant";
import { toast } from "@/lib/toast";
import { useNavigate } from "@tanstack/react-router";
import { WorkerPayrollDialog } from "@/components/payroll/WorkerPayrollView";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusChip } from "@/components/ui/status-chip";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { canReportJoin, type StaffWorkerRecord } from "@/lib/staff-permissions";
import {
  createEmploymentHistory,
  fetchEmploymentHistories,
  getCurrentEmploymentHistory,
  getLatestEmploymentHistory,
  getStaleWorkingEmploymentHistories,
  getMissingEmploymentSnapshotFields,
  getEmploymentPersonalSnapshot,
  isCurrentlyWorking,
  maskCccd,
  updateEmploymentHistory,
  updateUserAndCache,
} from "@/lib/employment";
import {
  findOrCreateCccdVersion,
  getCccdVersionByNumber,
  getCurrentCccdVersion,
  type CccdVersionRecord,
} from "@/lib/cccd-versions";
import { compressImage } from "@/lib/image-compress";
import type { FactoryRecord } from "@/lib/factories";
import type { MainHouseRecord } from "@/lib/main-houses";
import { createStaffActionLog } from "@/lib/staff-log";
import {
  assertAdvanceInteractionAllowed,
  isAdvanceInteractionAllowed,
  resolveAdvancePolicy,
  validateAdvanceAmount,
  type AdvancePolicy,
} from "@/lib/advance-policy";
import { useAppSettings } from "@/lib/app-settings";
import { fileUrl, pb, type UserRecord } from "@/lib/pocketbase";
import { resolveBankName } from "@/lib/vn-banks";
import { BankNameInput } from "@/components/staff/BankNameInput";
import { FactoryPicker, MainHousePicker } from "@/components/workforce/UserPicker";
import { AdvancePayoutMethodPicker } from "@/components/advances/AdvancePayoutMethodPicker";
import { AdvanceReadOnlyNotice } from "@/components/advances/AdvanceReadOnlyNotice";
import type { AdvancePayoutMethod } from "@/lib/advances";
import { JoinCccdSection } from "@/components/employment/JoinCccdSection";
import { RecruiterPicker } from "@/components/employment/RecruiterPicker";
import { getUserErrorMessage } from "@/lib/toast";
import { filterEmploymentFactories } from "@/lib/staff-employment-scope";
import {
  buildRecruiterPayload,
  encodeInternalRecruiter,
  getRecruiterDisplay,
  type RecruiterSelectionValue,
} from "@/lib/recruiters";

function todayDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function formatMoneyDisplay(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  return Number(digits).toLocaleString("vi-VN");
}

function normalizeCccdNumber(value?: string) {
  return String(value || "").replace(/\D/g, "");
}

function versionedCccdUrl(version: CccdVersionRecord | undefined, filename?: string) {
  const url = fileUrl(version, filename);
  if (!url || !version) return "";
  const cacheKey = version.updated || version.id;
  return `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(cacheKey)}`;
}

export function ScopeChip({
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
      className={
        active
          ? "rounded-full bg-primary px-3 py-2 text-xs font-medium text-primary-foreground"
          : "rounded-full border border-border/60 bg-card px-3 py-2 text-xs font-medium text-muted-foreground"
      }
    >
      {label}
    </button>
  );
}

export function WorkerQuickDrawer({
  worker,
  open,
  viewer,
  factories,
  mainHouses,
  managedFactoryIds,
  staffUsers,
  onClose,
  onDataChanged,
}: {
  worker: StaffWorkerRecord | null;
  open: boolean;
  viewer: UserRecord;
  factories: FactoryRecord[];
  mainHouses: MainHouseRecord[];
  managedFactoryIds: Set<string>;
  staffUsers: UserRecord[];
  onClose: () => void;
  onDataChanged: () => void;
}) {
  const navigate = useNavigate();
  const { data: settings } = useAppSettings();
  const [view, setView] = useState<DrawerView>("summary");
  const [payrollOpen, setPayrollOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
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
  const [amountText, setAmountText] = useState("");
  const [advanceReason, setAdvanceReason] = useState("");
  const [payoutMethod, setPayoutMethod] = useState<AdvancePayoutMethod>("bank_transfer");
  const [bankChoice, setBankChoice] = useState<"worker" | "viewer">("worker");
  const [bankForm, setBankForm] = useState({
    bank_name: "",
    bank_account_number: "",
    bank_account_name: "",
    bank_account_note: "",
  });
  const [employeeCodeForm, setEmployeeCodeForm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!worker) return;
    setView("summary");
    setLeaveDate(todayDate());
    setLeaveNote("");
    setAmountText("");
    setAdvanceReason("");
    setPayoutMethod("bank_transfer");
    const latest = worker.latestHistory;
    const personalSnapshot = getEmploymentPersonalSnapshot(latest, worker.user);
    setJoinForm({
      factory: "",
      main_house: "",
      employee_code: "",
      ...personalSnapshot,
      hometown_snapshot: personalSnapshot.worker_address_snapshot,
      worker_tax_code_snapshot: latest?.worker_tax_code_snapshot || "",
      recruiter_staff: encodeInternalRecruiter(viewer?.id),
      join_date: todayDate(),
      note: "",
    });
    setJoinCccdFront(null);
    setJoinCccdBack(null);
    setBankForm({
      bank_name: worker.user.bank_name || "",
      bank_account_number: worker.user.bank_account_number || "",
      bank_account_name: worker.user.bank_account_name || "",
      bank_account_note: worker.user.bank_account_note || "",
    });
    setEmployeeCodeForm(latest?.employee_code || "");
  }, [worker, viewer?.id]);

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

  const latest = worker?.latestHistory ?? null;
  const joinCccdVersion = useMemo(() => {
    const cccdNumber = normalizeCccdNumber(joinForm.worker_cccd_snapshot);
    if (!cccdNumber || !worker) return undefined;
    return worker.histories.find(
      (history) =>
        normalizeCccdNumber(history.worker_cccd_snapshot) === cccdNumber &&
        history.expand?.cccd_version,
    )?.expand?.cccd_version;
  }, [joinForm.worker_cccd_snapshot, worker]);
  const joinCccdFrontUrl = versionedCccdUrl(joinCccdVersion, joinCccdVersion?.front_image);
  const joinCccdBackUrl = versionedCccdUrl(joinCccdVersion, joinCccdVersion?.back_image);
  const isWorking = Boolean(latest && isCurrentlyWorking(latest));
  const activeHistory = worker ? getCurrentEmploymentHistory(worker.histories) : null;
  const allowAdvanceAfterLeave = Boolean(settings.allow_advance_after_leave);
  const advanceInteractionAllowed = isAdvanceInteractionAllowed(settings, viewer?.role);
  const canReportAdvanceByScope = Boolean(
    worker?.canReportAdvance && (isWorking || allowAdvanceAfterLeave),
  );
  const canOpenAdvance =
    canReportAdvanceByScope &&
    advanceInteractionAllowed &&
    (!latest?.recruiter_partner || viewer?.role === "admin");
  const canOpenJoin = canReportJoin(
    viewer,
    worker?.histories || [],
    managedFactoryIds,
    undefined,
    settings.staff_employment_factory_scope,
  );

  const submitLeave = async () => {
    if (!worker || !activeHistory || !viewer?.id) return;
    if (!leaveDate) {
      toast.warning("Chọn ngày nghỉ");
      return;
    }
    setSubmitting(true);
    try {
      await updateEmploymentHistory(
        activeHistory.id,
        { leave_date: leaveDate, note: leaveNote.trim() },
        {
          actor: viewer,
          action: "report_leave",
          source: "Danh sách lao động",
          note: "Báo nghỉ",
          before: activeHistory,
        },
      );
      const updated = await fetchEmploymentHistories([worker.user.id]);
      const newLatest = getLatestEmploymentHistory(updated);
      toast.success("Đã cập nhật ngày nghỉ");
      onClose();
      onDataChanged();
    } catch (e: any) {
      toast.error(e?.message || "Lỗi báo nghỉ");
    } finally {
      setSubmitting(false);
    }
  };

  const submitJoin = async () => {
    if (!worker || !viewer?.id) return;
    if (!joinForm.factory) {
      toast.warning("Chọn nhà máy");
      return;
    }
    if (!joinForm.join_date) {
      toast.warning("Nhập ngày vào làm");
      return;
    }
    if (!joinForm.recruiter_staff) {
      toast.warning("Chọn người tuyển");
      return;
    }
    if (!joinForm.main_house) {
      toast.warning("Chọn nhà chính");
      return;
    }
    const missingSnapshotFields = getMissingEmploymentSnapshotFields(joinForm);
    if (missingSnapshotFields.length) {
      toast.warning(`Thiếu thông tin cá nhân: ${missingSnapshotFields.join(", ")}`);
      return;
    }
    if (
      !canReportJoin(
        viewer,
        worker.histories,
        managedFactoryIds,
        joinForm.factory,
        settings.staff_employment_factory_scope,
      )
    ) {
      toast.error("Bạn không có quyền báo đi làm tại nhà máy đã chọn");
      return;
    }
    setSubmitting(true);
    try {
      const latestHistories = await fetchEmploymentHistories([worker.user.id]);
      const active = getCurrentEmploymentHistory(latestHistories);
      if (active) {
        toast.error("Cần báo nghỉ nhà máy cũ trước");
        setSubmitting(false);
        return;
      }

      for (const history of getStaleWorkingEmploymentHistories(latestHistories)) {
        await updateEmploymentHistory(
          history.id,
          { status: "left" },
          {
            actor: viewer,
            source: "Danh sách lao động",
            note: "Báo đi làm mới: đồng bộ lịch sử đã có ngày nghỉ",
            before: history,
          },
        );
      }

      let cccdVersionId: string | undefined;
      const cccdNumber = joinForm.worker_cccd_snapshot.trim() || worker.user.cccd || "";
      if (joinCccdFront || joinCccdBack) {
        if (!cccdNumber) {
          toast.warning("Cần có số CCCD để lưu ảnh");
          setSubmitting(false);
          return;
        }
        const [compressedFront, compressedBack] = await Promise.all([
          joinCccdFront ? compressImage(joinCccdFront) : Promise.resolve(null),
          joinCccdBack ? compressImage(joinCccdBack) : Promise.resolve(null),
        ]);
        const version = await findOrCreateCccdVersion(
          worker.user.id,
          cccdNumber,
          compressedFront,
          compressedBack,
        );
        cccdVersionId = version.id;
      } else {
        const reusableVersion =
          joinCccdVersion ||
          (cccdNumber ? await getCccdVersionByNumber(worker.user.id, cccdNumber) : null);
        cccdVersionId = reusableVersion?.id;
        if (!cccdVersionId) {
          const currentCccdVersion = await getCurrentCccdVersion(worker.user.id);
          if (
            currentCccdVersion &&
            normalizeCccdNumber(currentCccdVersion.cccd_number) === normalizeCccdNumber(cccdNumber)
          ) {
            cccdVersionId = currentCccdVersion.id;
          }
        }
      }

      const created = await createEmploymentHistory({
        user: worker.user.id,
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
        actor: viewer,
        targetUserId: worker.user.id,
        targetCollection: "employment_histories",
        targetRecord: created.id,
        action: "report_join",
        note: "Báo đi làm mới từ danh sách",
      });
      toast.success("Đã tạo bản ghi đi làm mới");
      setJoinCccdFront(null);
      setJoinCccdBack(null);
      onClose();
      onDataChanged();
    } catch (e: any) {
      toast.error(e?.message || "Lỗi báo đi làm");
    } finally {
      setSubmitting(false);
    }
  };

  const submitAdvance = async () => {
    if (!worker || !viewer?.id || !latest) return;
    if (!activeHistory) {
      toast.error("Chỉ báo ứng cho người lao động đang đi làm");
      return;
    }
    const amount = Number(amountText.replace(/\D/g, ""));
    if (!amount) {
      toast.warning("Nhập số tiền");
      return;
    }
    if (!advanceReason.trim()) {
      toast.warning("Nhập lý do");
      return;
    }
    const bankSource = bankChoice === "viewer" ? viewer : worker.user;
    if (payoutMethod === "bank_transfer" && !bankSource.bank_account_number) {
      toast.warning("Tài khoản ngân hàng chưa có");
      return;
    }
    setSubmitting(true);
    try {
      await assertAdvanceInteractionAllowed(viewer.role);
      const policy = await resolveAdvancePolicy(worker.user.id, {
        allowAfterLeave: allowAdvanceAfterLeave,
        actorRole: viewer.role,
      });
      validateAdvanceAmount(policy, amount);
      const employment = policy.employment;

      const created = await pb.collection("advances").create({
        ...companyPayload(pb.authStore.record as UserRecord),
        user: worker.user.id,
        requested_by: viewer.id,
        recruiter_id: employment.recruiter_staff || "",
        employee_code: employment.employee_code || "",
        full_name: employment.worker_name_snapshot || worker.user.full_name || "",
        company: policy.factoryName,
        phone: worker.user.phone || "",
        join_date: employment.join_date || "",
        bank_name: payoutMethod === "cash" ? "" : bankSource.bank_name || "",
        bank_account_number: payoutMethod === "cash" ? "" : bankSource.bank_account_number || "",
        bank_account_name: payoutMethod === "cash" ? "" : bankSource.bank_account_name || "",
        payout_method: payoutMethod,
        amount,
        reason: advanceReason.trim(),
        status: "recruiter_approved",
        recovery_status: "none",
      });
      await createStaffActionLog({
        actor: viewer,
        targetUserId: worker.user.id,
        targetCollection: "advances",
        targetRecord: created.id,
        action: "report_advance",
        after: created,
        note: "Báo ứng từ danh sách",
      });
      toast.success("Đã gửi yêu cầu ứng lương");
      onClose();
      onDataChanged();
    } catch (e: any) {
      toast.error(e?.message || "Lỗi báo ứng");
    } finally {
      setSubmitting(false);
    }
  };

  const submitBank = async () => {
    if (!worker || !viewer?.id) return;
    if (!worker.canUpdateBank) {
      toast.error("Bạn không có quyền cập nhật ngân hàng cho hồ sơ này");
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        ...bankForm,
        bank_name: resolveBankName(bankForm.bank_name.trim()),
      };
      await updateUserAndCache(worker.user.id, payload);
      await createStaffActionLog({
        actor: viewer,
        targetUserId: worker.user.id,
        targetCollection: "users",
        targetRecord: worker.user.id,
        action: "update_bank",
        note: "Cập nhật ngân hàng từ danh sách",
      });
      toast.success("Đã cập nhật ngân hàng");
      onClose();
      onDataChanged();
    } catch (e: any) {
      toast.error(e?.message || "Lỗi cập nhật");
    } finally {
      setSubmitting(false);
    }
  };

  const submitEmployeeCode = async () => {
    if (!worker || !viewer?.id) return;
    const code = employeeCodeForm.trim();
    if (!code) {
      toast.warning("Nhập mã nhân viên");
      return;
    }
    setSubmitting(true);
    try {
      if (!latest) {
        toast.error("Người lao động chưa có lịch sử đi làm để cập nhật mã NV");
        return;
      }
      await updateEmploymentHistory(
        latest.id,
        { employee_code: code },
        {
          actor: viewer,
          source: "Danh sách lao động",
          note: `Cập nhật mã NV: ${code}`,
          before: latest,
        },
      );
      toast.success("Đã cập nhật mã nhân viên");
      onClose();
      onDataChanged();
    } catch (e: any) {
      toast.error(e?.message || "Lỗi cập nhật mã NV");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={(v) => !v && onClose()}>
      <DrawerContent className="max-h-[90dvh]">
        <DrawerHeader>
          <DrawerTitle>
            {worker?.user.full_name || worker?.user.username || "Người lao động"}
          </DrawerTitle>
          <DrawerDescription>
            {latest?.expand?.factory?.name || "Chưa có nhà máy"} ·{" "}
            {isWorking ? "Đang đi làm" : "Đã nghỉ"}
          </DrawerDescription>
        </DrawerHeader>

        <div className="min-w-0 space-y-4 overflow-y-auto px-4 pb-6">
          {view === "summary" && worker && (
            <>
              <div className="grid grid-cols-3 gap-2">
                {worker.canReportLeave && (
                  <ActionButton icon={Clock3} label="Báo nghỉ" onClick={() => setView("leave")} />
                )}
                {canOpenJoin && (
                  <ActionButton
                    icon={Plus}
                    label="Báo đi làm mới"
                    onClick={() => setView("join")}
                  />
                )}
                {canReportAdvanceByScope && (
                  <ActionButton
                    icon={Wallet}
                    label="Báo ứng lương"
                    disabled={!canOpenAdvance}
                    onClick={() => {
                      setPayoutMethod("bank_transfer");
                      setView("advance");
                    }}
                  />
                )}
                {worker.canViewPayroll && (
                  <ActionButton
                    icon={CalendarRange}
                    label="Check công lương"
                    onClick={() => setPayrollOpen(true)}
                  />
                )}
                {worker.canUpdateBank && (
                  <ActionButton
                    icon={Landmark}
                    label="Cập nhật ngân hàng"
                    onClick={() => setView("bank")}
                  />
                )}
                {(worker.canReportLeave || canOpenJoin || canReportAdvanceByScope) && (
                  <ActionButton
                    icon={Hash}
                    label="Cập nhật mã NV"
                    onClick={() => setView("employee_code")}
                  />
                )}
              </div>

              <div className="flex items-center justify-between">
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
                <div className="grid min-w-0 grid-cols-2 gap-2 text-sm">
                  <InfoCell
                    label="Họ tên (NM)"
                    value={latest?.worker_name_snapshot || worker.user.full_name || "—"}
                  />
                  <InfoCell
                    label="CCCD (NM)"
                    value={maskCccd(latest?.worker_cccd_snapshot || worker.user.cccd)}
                  />
                  <InfoCell label="Mã số thuế" value={latest?.worker_tax_code_snapshot || "—"} />
                  <InfoCell label="Mã NV" value={latest?.employee_code || "?"} />
                  <InfoCell label="SĐT" value={worker.user.phone || "—"} />
                  <InfoCell label="Nhà máy" value={latest?.expand?.factory?.name || "—"} />
                  <InfoCell label="Nhà chính" value={latest?.expand?.main_house?.name || "—"} />
                  <InfoCell
                    label="Người tuyển"
                    value={(() => {
                      const recruiter = getRecruiterDisplay(latest);
                      return recruiter ? `${recruiter.name} · ${recruiter.label}` : "—";
                    })()}
                  />
                </div>
              )}

              <button
                type="button"
                onClick={() => {
                  const id = worker.user.id;
                  onClose();
                  setTimeout(
                    () => navigate({ to: "/staff/workers/$workerId", params: { workerId: id } }),
                    150,
                  );
                }}
                className="flex w-full items-center justify-between rounded-2xl border border-border/60 bg-card px-4 py-3 text-sm font-medium shadow-soft"
              >
                <div className="flex items-center gap-2">
                  <UserSquare2 className="h-4 w-4 text-primary" />
                  <span>Xem chi tiết đầy đủ</span>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            </>
          )}

          {view === "leave" && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void submitLeave();
              }}
            >
              <div className="text-sm font-semibold">Báo nghỉ nhà máy hiện tại</div>
              {!activeHistory ? (
                <div className="rounded-xl border bg-card p-3 text-sm text-muted-foreground">
                  Không có bản ghi đang làm để báo nghỉ.
                </div>
              ) : (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs">Ngày nghỉ</Label>
                    <DateInput value={leaveDate} onChange={(v) => setLeaveDate(v)} />
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
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setView("summary")}
                      className="flex-1"
                    >
                      Quay lại
                    </Button>
                    <Button type="submit" disabled={submitting} className="flex-1">
                      {submitting ? "Đang lưu..." : "Xác nhận nghỉ"}
                    </Button>
                  </div>
                </>
              )}
            </form>
          )}

          {view === "join" && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void submitJoin();
              }}
            >
              <div className="text-sm font-semibold">Thông tin đi làm</div>
              <div className="text-sm font-semibold">Báo đi làm nhà máy mới</div>
              <div className="space-y-1">
                <Label className="text-xs">Nhà máy</Label>
                <FactoryPicker
                  factories={joinableFactories}
                  value={joinForm.factory}
                  onChange={(value) => setJoinForm((current) => ({ ...current, factory: value }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Nhà chính</Label>
                <MainHousePicker
                  mainHouses={mainHouses}
                  value={joinForm.main_house}
                  onChange={(value) =>
                    setJoinForm((current) => ({ ...current, main_house: value }))
                  }
                />
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
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Mã NV</Label>
                  <Input
                    value={joinForm.employee_code}
                    onChange={(e) => setJoinForm((f) => ({ ...f, employee_code: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Ngày vào làm</Label>
                  <DateInput
                    value={joinForm.join_date}
                    onChange={(v) => setJoinForm((f) => ({ ...f, join_date: v }))}
                    max={todayDate()}
                  />
                </div>
              </div>
              <RecruiterPicker
                label="Người tuyển"
                value={joinForm.recruiter_staff as RecruiterSelectionValue}
                onChange={(value) => setJoinForm((form) => ({ ...form, recruiter_staff: value }))}
                internalUsers={staffUsers}
                partners={mainHouses}
              />
              <div className="space-y-1">
                <Label className="text-xs">Ghi chú</Label>
                <Textarea
                  rows={2}
                  value={joinForm.note}
                  onChange={(e) => setJoinForm((f) => ({ ...f, note: e.target.value }))}
                  placeholder="Tuỳ chọn"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setView("summary")}
                  className="flex-1"
                >
                  Quay lại
                </Button>
                <Button type="submit" disabled={submitting} className="flex-1">
                  {submitting ? "Đang lưu..." : "Tạo bản ghi"}
                </Button>
              </div>
            </form>
          )}

          {view === "advance" && worker && (
            <AdvanceForm
              worker={worker}
              viewer={viewer}
              amountText={amountText}
              setAmountText={setAmountText}
              advanceReason={advanceReason}
              setAdvanceReason={setAdvanceReason}
              payoutMethod={payoutMethod}
              setPayoutMethod={setPayoutMethod}
              bankChoice={bankChoice}
              setBankChoice={setBankChoice}
              submitting={submitting}
              interactionAllowed={advanceInteractionAllowed}
              allowAfterLeave={allowAdvanceAfterLeave}
              onSubmit={submitAdvance}
              onBack={() => setView("summary")}
            />
          )}

          {view === "bank" && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void submitBank();
              }}
            >
              <div className="text-sm font-semibold">Cập nhật tài khoản ngân hàng</div>
              <div className="space-y-1">
                <Label className="text-xs">Ngân hàng</Label>
                <BankNameInput
                  value={bankForm.bank_name}
                  onChange={(value) => setBankForm((f) => ({ ...f, bank_name: value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Số TK</Label>
                  <Input
                    value={bankForm.bank_account_number}
                    onChange={(e) =>
                      setBankForm((f) => ({
                        ...f,
                        bank_account_number: e.target.value.replace(/\D/g, ""),
                      }))
                    }
                    inputMode="numeric"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Tên TK</Label>
                  <Input
                    value={bankForm.bank_account_name}
                    onChange={(e) =>
                      setBankForm((f) => ({ ...f, bank_account_name: e.target.value }))
                    }
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Ghi chú STK</Label>
                <Textarea
                  value={bankForm.bank_account_note}
                  onChange={(e) =>
                    setBankForm((f) => ({ ...f, bank_account_note: e.target.value }))
                  }
                  placeholder="Ghi chú thêm về tài khoản"
                  rows={2}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setView("summary")}
                  className="flex-1"
                >
                  Quay lại
                </Button>
                <Button type="submit" disabled={submitting} className="flex-1">
                  {submitting ? "Đang lưu..." : "Lưu ngân hàng"}
                </Button>
              </div>
            </form>
          )}

          {view === "employee_code" && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void submitEmployeeCode();
              }}
            >
              <div className="text-sm font-semibold">Cập nhật mã nhân viên</div>
              <div className="space-y-1">
                <Label className="text-xs">Mã NV hiện tại</Label>
                <div className="rounded-xl bg-muted/35 px-3 py-2 text-sm">
                  {worker?.latestHistory?.employee_code || "Chưa có"}
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Mã NV mới</Label>
                <Input
                  value={employeeCodeForm}
                  onChange={(e) => setEmployeeCodeForm(e.target.value)}
                  placeholder="Nhập mã nhân viên"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setView("summary")}
                  className="flex-1"
                >
                  Quay lại
                </Button>
                <Button type="submit" disabled={submitting} className="flex-1">
                  {submitting ? "Đang lưu..." : "Lưu mã NV"}
                </Button>
              </div>
            </form>
          )}
        </div>

        <DrawerFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Đóng
          </Button>
        </DrawerFooter>
      </DrawerContent>
      <WorkerPayrollDialog
        open={payrollOpen}
        onOpenChange={setPayrollOpen}
        viewer={viewer}
        workerId={worker?.user.id || ""}
      />
    </Drawer>
  );
}

type DrawerView = "summary" | "leave" | "join" | "advance" | "bank" | "employee_code";

function ActionButton({
  icon: Icon,
  label,
  disabled = false,
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
      className="flex min-h-[64px] min-w-0 disabled:cursor-not-allowed disabled:opacity-50 flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border border-border/60 bg-card px-2 py-2 text-center shadow-soft active:scale-[0.98]"
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
    <div className="min-w-0 overflow-hidden rounded-xl bg-muted/35 p-2.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 break-words text-sm font-semibold [overflow-wrap:anywhere]">
        {value}
      </div>
    </div>
  );
}

function AdvanceForm({
  worker,
  viewer,
  amountText,
  setAmountText,
  advanceReason,
  setAdvanceReason,
  payoutMethod,
  setPayoutMethod,
  bankChoice,
  setBankChoice,
  submitting,
  interactionAllowed,
  allowAfterLeave,
  onSubmit,
  onBack,
}: {
  worker: StaffWorkerRecord;
  viewer: UserRecord;
  amountText: string;
  setAmountText: (v: string) => void;
  advanceReason: string;
  setAdvanceReason: (v: string) => void;
  payoutMethod: AdvancePayoutMethod;
  setPayoutMethod: (value: AdvancePayoutMethod) => void;
  bankChoice: "worker" | "viewer";
  setBankChoice: (v: "worker" | "viewer") => void;
  submitting: boolean;
  interactionAllowed: boolean;
  allowAfterLeave: boolean;
  onSubmit: () => void;
  onBack: () => void;
}) {
  const [policy, setPolicy] = useState<AdvancePolicy | null>(null);
  const [policyError, setPolicyError] = useState("");
  const [policyLoading, setPolicyLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setPolicyLoading(true);
    resolveAdvancePolicy(worker.user.id, { allowAfterLeave, actorRole: viewer.role })
      .then((result) => {
        if (!active) return;
        setPolicy(result);
        setPolicyError("");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setPolicy(null);
        setPolicyError(getUserErrorMessage(error, "Không thể kiểm tra hạn mức ứng tiền"));
      })
      .finally(() => active && setPolicyLoading(false));
    return () => {
      active = false;
    };
  }, [allowAfterLeave, viewer.role, worker.user.id]);

  const limit = policy?.limit || 0;

  const workerBank = worker.user.bank_account_number
    ? `${worker.user.bank_name || "NH"} · ${worker.user.bank_account_number} · ${worker.user.bank_account_name || ""}`
    : "";
  const viewerBank = viewer.bank_account_number
    ? `${viewer.bank_name || "NH"} · ${viewer.bank_account_number} · ${viewer.bank_account_name || ""}`
    : "";
  const viewerBankRoleLabel = viewer.role === "admin" ? "Admin" : "Staff";

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit();
      }}
    >
      <div className="text-sm font-semibold">Báo ứng lương</div>
      {!interactionAllowed && <AdvanceReadOnlyNotice />}

      {policyLoading && (
        <div className="rounded-xl border bg-muted/30 p-2.5 text-xs text-muted-foreground">
          Đang kiểm tra nhà máy và hạn mức ứng tiền...
        </div>
      )}
      {policyError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
          {policyError}
        </div>
      )}
      {policy && (
        <div className="rounded-xl border bg-primary/5 p-2.5 text-xs">
          <span className="text-muted-foreground">Nhà máy áp dụng: </span>
          <span className="font-semibold">{policy.factoryName}</span>
          <div className="mt-1 text-muted-foreground">
            Đã ứng {policy.outstanding.toLocaleString("vi-VN")} đ · Còn lại{" "}
            {policy.available.toLocaleString("vi-VN")} đ
          </div>
        </div>
      )}

      {limit > 0 && (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 p-2.5 text-xs text-muted-foreground">
          Hạn mức ứng lương:{" "}
          <span className="font-semibold text-foreground">{limit.toLocaleString("vi-VN")} đ</span>
        </div>
      )}

      <div className="space-y-1">
        <Label className="text-xs">Số tiền</Label>
        <Input
          value={formatMoneyDisplay(amountText)}
          onChange={(e) => setAmountText(e.target.value.replace(/\D/g, ""))}
          inputMode="numeric"
          placeholder="Nhập số tiền"
        />
        {amountText && (
          <div className="text-[11px] text-muted-foreground">
            = {Number(amountText).toLocaleString("vi-VN")} đ
          </div>
        )}
      </div>

      <AdvancePayoutMethodPicker value={payoutMethod} onChange={setPayoutMethod} />

      {payoutMethod === "bank_transfer" && (
        <div className="space-y-1">
          <Label className="text-xs">Tài khoản nhận tiền</Label>
          <div className="space-y-1.5">
            {workerBank && (
              <button
                type="button"
                onClick={() => setBankChoice("worker")}
                className={`flex w-full items-start gap-2 rounded-xl border p-2.5 text-left text-xs transition ${bankChoice === "worker" ? "border-primary bg-primary/5" : "border-border bg-card"}`}
              >
                <div
                  className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 ${bankChoice === "worker" ? "border-primary bg-primary" : "border-muted-foreground"}`}
                />
                <div>
                  <div className="font-medium">STK của NLĐ</div>
                  <div className="text-muted-foreground">{workerBank}</div>
                </div>
              </button>
            )}
            {viewerBank && (
              <button
                type="button"
                onClick={() => setBankChoice("viewer")}
                className={`flex w-full items-start gap-2 rounded-xl border p-2.5 text-left text-xs transition ${bankChoice === "viewer" ? "border-primary bg-primary/5" : "border-border bg-card"}`}
              >
                <div
                  className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 ${bankChoice === "viewer" ? "border-primary bg-primary" : "border-muted-foreground"}`}
                />
                <div>
                  <div className="font-medium">STK của tôi ({viewerBankRoleLabel})</div>
                  <div className="text-muted-foreground">{viewerBank}</div>
                </div>
              </button>
            )}
            {!workerBank && !viewerBank && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
                Chưa có STK nào. Cập nhật ngân hàng trước khi báo ứng.
              </div>
            )}
          </div>
        </div>
      )}

      <div className="space-y-1">
        <Label className="text-xs">Lý do</Label>
        <Textarea
          rows={3}
          value={advanceReason}
          onChange={(e) => setAdvanceReason(e.target.value)}
          placeholder="Ví dụ: ứng tiền sinh hoạt..."
        />
      </div>

      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={onBack} className="flex-1">
          Quay lại
        </Button>
        <Button
          type="submit"
          disabled={
            submitting ||
            policyLoading ||
            !policy ||
            Boolean(policyError) ||
            (payoutMethod === "bank_transfer" && !workerBank && !viewerBank) ||
            !interactionAllowed
          }
          className="flex-1"
        >
          {submitting ? "Đang gửi..." : "Gửi yêu cầu"}
        </Button>
      </div>
    </form>
  );
}
