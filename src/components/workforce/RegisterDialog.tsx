import { useEffect, useState } from "react";
import { BriefcaseBusiness } from "lucide-react";
import { toast } from "@/lib/toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FactoryPicker, MainHousePicker, UserPicker } from "./UserPicker";
import type { UserRecord } from "@/lib/pocketbase";
import type { FactoryRecord } from "@/lib/factories";
import type { MainHouseRecord } from "@/lib/main-houses";
import {
  createEmploymentHistory,
  fetchEmploymentHistories,
  fetchRegisterableUsers,
  getCurrentEmploymentHistory,
  getEmploymentPersonalSnapshot,
  getLatestEmploymentHistory,
  getMissingEmploymentSnapshotFields,
  getStaleWorkingEmploymentHistories,
  isEmploymentUserUniqueError,
  maskCccd,
  updateEmploymentHistory,
} from "@/lib/employment";
import { createStaffActionLog } from "@/lib/staff-log";
import { JoinCccdSection } from "@/components/employment/JoinCccdSection";
import { compressImage } from "@/lib/image-compress";
import { findOrCreateCccdVersion, updateCccdVersionImages } from "@/lib/cccd-versions";
import { RecruiterPicker } from "@/components/employment/RecruiterPicker";
import { getUserErrorMessage } from "@/lib/toast";
import {
  buildRecruiterPayload,
  encodeInternalRecruiter,
  type RecruiterSelectionValue,
} from "@/lib/recruiters";

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
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

export interface RegisterDialogProps {
  open: boolean;
  actor: UserRecord | null;
  onClose: () => void;
  users: UserRecord[];
  factories: FactoryRecord[];
  mainHouses: MainHouseRecord[];
  onCreated: () => void;
  includeLongLeft?: boolean;
  defaultRecruiterId?: string;
  actorRoleLabel?: string;
}

export function RegisterDialog({
  open,
  actor,
  onClose,
  users,
  factories,
  mainHouses,
  onCreated,
  includeLongLeft = false,
  defaultRecruiterId = "",
  actorRoleLabel,
}: RegisterDialogProps) {
  const [userId, setUserId] = useState("");
  const [factoryId, setFactoryId] = useState("");
  const [mainHouseId, setMainHouseId] = useState("");
  const [recruiterId, setRecruiterId] = useState("");
  const [employeeCode, setEmployeeCode] = useState("");
  const [workerName, setWorkerName] = useState("");
  const [workerCccd, setWorkerCccd] = useState("");
  const [workerDateOfBirth, setWorkerDateOfBirth] = useState("");
  const [workerAddress, setWorkerAddress] = useState("");
  const [cccdIssueDate, setCccdIssueDate] = useState("");
  const [workerTaxCode, setWorkerTaxCode] = useState("");
  const [joinDate, setJoinDate] = useState(todayIso());
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [candidateUsers, setCandidateUsers] = useState<UserRecord[]>([]);
  const [cccdFront, setCccdFront] = useState<File | null>(null);
  const [cccdBack, setCccdBack] = useState<File | null>(null);

  const selectedUser = candidateUsers.find((u) => u.id === userId);
  const roleLabel = actorRoleLabel || (actor?.role === "admin" ? "Quản trị viên" : "Nhân sự");
  const personalSnapshotValue = {
    worker_name_snapshot: workerName,
    worker_cccd_snapshot: workerCccd,
    worker_date_of_birth_snapshot: workerDateOfBirth,
    worker_address_snapshot: workerAddress,
    cccd_issue_date: cccdIssueDate,
  };
  const updatePersonalSnapshot = (changes: Partial<typeof personalSnapshotValue>) => {
    if (changes.worker_name_snapshot !== undefined) setWorkerName(changes.worker_name_snapshot);
    if (changes.worker_cccd_snapshot !== undefined) setWorkerCccd(changes.worker_cccd_snapshot);
    if (changes.worker_date_of_birth_snapshot !== undefined) {
      setWorkerDateOfBirth(changes.worker_date_of_birth_snapshot);
    }
    if (changes.worker_address_snapshot !== undefined) {
      setWorkerAddress(changes.worker_address_snapshot);
    }
    if (changes.cccd_issue_date !== undefined) setCccdIssueDate(changes.cccd_issue_date);
  };

  const reset = () => {
    setUserId("");
    setFactoryId("");
    setMainHouseId("");
    setRecruiterId(encodeInternalRecruiter(defaultRecruiterId));
    setEmployeeCode("");
    setWorkerName("");
    setWorkerCccd("");
    setWorkerDateOfBirth("");
    setWorkerAddress("");
    setCccdIssueDate("");
    setWorkerTaxCode("");
    setCccdFront(null);
    setCccdBack(null);
    setJoinDate(todayIso());
    setNote("");
  };

  useEffect(() => {
    if (!open) reset();
  }, [open, defaultRecruiterId]);

  useEffect(() => {
    if (!open) return;
    fetchRegisterableUsers({ includeLongLeft })
      .then(setCandidateUsers)
      .catch(() => setCandidateUsers([]));
  }, [open, includeLongLeft]);

  useEffect(() => {
    if (!selectedUser) return;
    let active = true;

    const applySnapshot = (snapshot: ReturnType<typeof getEmploymentPersonalSnapshot>) => {
      if (!active) return;
      setWorkerName(snapshot.worker_name_snapshot);
      setWorkerCccd(snapshot.worker_cccd_snapshot);
      setWorkerDateOfBirth(snapshot.worker_date_of_birth_snapshot);
      setWorkerAddress(snapshot.worker_address_snapshot);
      setCccdIssueDate(snapshot.cccd_issue_date);
    };

    applySnapshot(getEmploymentPersonalSnapshot(null, selectedUser));
    fetchEmploymentHistories([selectedUser.id])
      .then((rows) =>
        applySnapshot(
          getEmploymentPersonalSnapshot(getLatestEmploymentHistory(rows), selectedUser),
        ),
      )
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [selectedUser]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return toast.error("Chọn người lao động");
    if (!factoryId) return toast.error("Chọn nhà máy");
    if (!joinDate) return toast.error("Nhập ngày vào làm");
    if (!recruiterId) return toast.error("Chọn người tuyển");
    if (!mainHouseId) return toast.error("Chọn nhà chính");
    if (!selectedUser) return;

    const personalSnapshot = {
      worker_name_snapshot: workerName.trim(),
      worker_cccd_snapshot: workerCccd.trim(),
      worker_date_of_birth_snapshot: workerDateOfBirth,
      worker_address_snapshot: workerAddress.trim(),
      cccd_issue_date: cccdIssueDate,
    };
    const missingSnapshotFields = getMissingEmploymentSnapshotFields(personalSnapshot);
    if (missingSnapshotFields.length) {
      return toast.error(`Thiếu thông tin cá nhân: ${missingSnapshotFields.join(", ")}`);
    }

    const workerCccdDigits = workerCccd.replace(/\D/g, "");
    if (workerCccd && workerCccdDigits.length !== 12) {
      return toast.error("CCCD phải có đúng 12 chữ số; có thể thêm ký tự phía sau");
    }

    setSubmitting(true);
    try {
      const latestHistories = await fetchEmploymentHistories([userId]);
      const activeHistory = getCurrentEmploymentHistory(latestHistories);
      if (activeHistory) {
        toast.error(
          "Người lao động này đang có một lịch sử đi làm chưa kết thúc. Hãy cập nhật ngày nghỉ trước khi đăng ký mới.",
        );
        return;
      }

      const staleWorkingHistories = getStaleWorkingEmploymentHistories(latestHistories);
      for (const history of staleWorkingHistories) {
        await updateEmploymentHistory(
          history.id,
          { status: "left" },
          {
            actor,
            source: "Đăng ký đi làm",
            note: `${roleLabel} đăng ký đi làm mới: đồng bộ lịch sử đã có ngày nghỉ`,
            before: history,
          },
        );
      }

      let cccdVersionId: string | undefined;
      if (cccdFront || cccdBack) {
        const cccdNumber = workerCccd.trim();
        if (!cccdNumber) {
          toast.error("Cần có số CCCD để lưu ảnh");
          return;
        }
        const [compressedFront, compressedBack] = await Promise.all([
          cccdFront ? compressImage(cccdFront) : Promise.resolve(null),
          cccdBack ? compressImage(cccdBack) : Promise.resolve(null),
        ]);
        const version = await findOrCreateCccdVersion(userId, cccdNumber);
        await updateCccdVersionImages(
          version.id,
          compressedFront || undefined,
          compressedBack || undefined,
        );
        cccdVersionId = version.id;
      }

      const created = await createEmploymentHistory({
        user: userId,
        factory: factoryId,
        main_house: mainHouseId,
        employee_code: employeeCode.trim() || undefined,
        worker_name_snapshot: workerName.trim(),
        worker_cccd_snapshot: workerCccd.trim(),
        worker_date_of_birth_snapshot: workerDateOfBirth,
        worker_address_snapshot: workerAddress.trim(),
        hometown_snapshot: workerAddress.trim(),
        cccd_issue_date: cccdIssueDate,
        worker_tax_code_snapshot: workerTaxCode.trim(),
        ...buildRecruiterPayload(recruiterId),
        cccd_version: cccdVersionId,
        join_date: joinDate,
        note: note.trim() || undefined,
      });
      await createStaffActionLog({
        actor,
        targetUserId: userId,
        targetCollection: "employment_histories",
        targetRecord: created.id,
        action: "create",
        after: created,
        note: `${roleLabel} đăng ký đi làm`,
      });
      setCccdFront(null);
      setCccdBack(null);
      toast.success("Đã đăng ký đi làm");
      onClose();
      onCreated();
    } catch (error: unknown) {
      const fieldErrors = getPocketBaseFieldErrors(error);
      const message = getErrorMessage(error, "Lỗi đăng ký đi làm");
      if (isEmploymentUserUniqueError(error)) {
        toast.error(
          "Người lao động này đã có một lịch sử đi làm đang hoạt động. Hãy kiểm tra ngày nghỉ hoặc tải lại dữ liệu trước khi đăng ký mới.",
        );
      } else if (fieldErrors) {
        toast.error(fieldErrors);
      } else if (message.includes("UNIQUE")) {
        toast.error(
          "Người lao động này đã có lịch sử đang đi làm. Hãy cập nhật trạng thái nghỉ trước khi đăng ký mới.",
        );
      } else {
        toast.error(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Đăng ký đi làm</DialogTitle>
          <DialogDescription>
            Tạo bản ghi lịch sử đi làm cho người lao động đã có tài khoản.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <UserPicker
            label="Người lao động"
            users={candidateUsers}
            value={userId}
            onChange={setUserId}
            placeholder="Tìm họ tên, SĐT, mã NV..."
          />

          {selectedUser && (
            <div className="rounded-xl border border-dashed bg-muted/40 p-2.5 text-[11px] text-muted-foreground">
              Gợi ý từ tài khoản:{" "}
              <span className="font-medium text-foreground">
                {selectedUser.full_name || selectedUser.username}
              </span>
              {selectedUser.cccd && ` · CCCD ${maskCccd(selectedUser.cccd)}`}
              {selectedUser.phone && ` · ${selectedUser.phone}`}
              <div className="mt-1">
                Có thể sửa họ tên / CCCD bên dưới nếu nhà máy ghi nhận khác.
              </div>
            </div>
          )}

          <div className="space-y-2">
            <div className="text-sm font-semibold">Thông tin CCCD</div>
            <JoinCccdSection
              value={personalSnapshotValue}
              onChange={updatePersonalSnapshot}
              frontFile={cccdFront}
              backFile={cccdBack}
              onFrontFileChange={setCccdFront}
              onBackFileChange={setCccdBack}
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Mã số thuế</Label>
            <Input
              value={workerTaxCode}
              onChange={(e) => setWorkerTaxCode(e.target.value.replace(/[^\d]/g, ""))}
              inputMode="numeric"
              placeholder="Mã số thuế theo lịch sử đi làm"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Nhà máy</Label>
            <FactoryPicker factories={factories} value={factoryId} onChange={setFactoryId} />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Nhà chính</Label>
            <MainHousePicker
              mainHouses={mainHouses}
              value={mainHouseId}
              onChange={setMainHouseId}
            />
          </div>

          <RecruiterPicker
            label="Người tuyển"
            internalUsers={users}
            partners={mainHouses}
            value={recruiterId as RecruiterSelectionValue}
            onChange={setRecruiterId}
            placeholder="Chọn nhân sự hoặc Đối tác"
            allowClear
          />

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Mã NV</Label>
              <Input
                value={employeeCode}
                onChange={(e) => setEmployeeCode(e.target.value)}
                placeholder="Tuỳ chọn"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Ngày vào làm</Label>
              <DateInput
                value={joinDate}
                onChange={(value) => setJoinDate(value)}
                max={todayIso()}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Ghi chú</Label>
            <Textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Tuỳ chọn"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Huỷ
            </Button>
            <Button type="submit" disabled={submitting}>
              <BriefcaseBusiness className="h-4 w-4" />
              {submitting ? "Đang lưu..." : "Đăng ký"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Re-export for callers that need the pickers directly
export { UserPicker, FactoryPicker };
export type { UserRecord };
