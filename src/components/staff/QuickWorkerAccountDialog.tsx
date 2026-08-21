import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type HTMLAttributes,
  type ReactNode,
  type RefCallback,
} from "react";
import {
  BriefcaseBusiness,
  Camera,
  Check,
  ClipboardPaste,
  Crop,
  IdCard,
  Plus,
  Trash2,
  ScanLine,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { CccdImageCropDialog } from "@/components/cccd/CccdImageCropDialog";
import { readClipboardImage } from "@/lib/clipboard-image";
import { CccdQrPasteButton } from "@/components/cccd/CccdQrPasteButton";
import { CccdQrScanFeedbackDialog } from "@/components/cccd/CccdQrScanFeedbackDialog";
import { Button } from "@/components/ui/button";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { findOrCreateCccdVersion, type CccdVersionRecord } from "@/lib/cccd-versions";
import {
  displayDateToPocketBase,
  scanCccdQrFromFileDetailed,
  type CccdQrData,
  type CccdQrScanFailureReason,
  type CccdQrScanMode,
} from "@/lib/cccd-qr";
import { createEmploymentHistory, type EmploymentHistoryRecord } from "@/lib/employment";
import type { FactoryRecord } from "@/lib/factories";
import { compressImage } from "@/lib/image-compress";
import type { MainHouseRecord } from "@/lib/main-houses";
import { pb, type UserRecord } from "@/lib/pocketbase";
import type { WorkerRecord } from "@/lib/workers";
import { updateCachedUser } from "@/lib/staff-cache";
import { createStaffActionLog } from "@/lib/staff-log";
import { allocateEmploymentHistoryUids, allocateUserUids } from "@/lib/uid-counter";
import { cn } from "@/lib/utils";
import { FactoryPicker, MainHousePicker } from "@/components/workforce/UserPicker";
import { RecruiterPicker } from "@/components/employment/RecruiterPicker";
import { buildRecruiterPayload, type RecruiterSelectionValue } from "@/lib/recruiters";
import { resolveBankName } from "@/lib/vn-banks";
import { BankPicker } from "@/components/staff/BankNameInput";
import { getUserErrorMessage } from "@/lib/toast";

export interface QuickWorkerCreatedResult {
  user: WorkerRecord;
  history?: EmploymentHistoryRecord;
  cccdVersion?: CccdVersionRecord;
  warnings: string[];
}

type QuickWorkerForm = {
  real_name: string;
  worker_name_snapshot: string;
  cccd: string;
  phone: string;
  date_of_birth: string;
  cccd_issue_date: string;
  gender: string;
  address: string;
  bank_name: string;
  bank_account_number: string;
  bank_account_name: string;
  bank_account_note: string;
  recruiter_staff: string;
  join_date: string;
  main_house: string;
  factory: string;
  employee_code: string;
  note: string;
};

type QuickScanSide = "front" | "back";

type QuickWorkerEntry = {
  id: string;
  form: QuickWorkerForm;
  frontFile: File | null;
  backFile: File | null;
  frontPreview: string;
  backPreview: string;
  qrScannedSide: QuickScanSide | null;
};

type QuickScanFailure = {
  entryId: string;
  side: QuickScanSide;
  file: File;
  reason: Exclude<CccdQrScanFailureReason, "cancelled">;
};

type PendingQrOverwrite = {
  entryId: string;
  data: CccdQrData;
  fields: Array<keyof QuickWorkerForm>;
};

type QuickCropRequest = {
  entryId: string;
  side: QuickScanSide;
  file: File | null;
  fallbackMessage?: string;
};

let quickWorkerEntrySequence = 0;

function createQuickWorkerEntry(recruiterStaff = ""): QuickWorkerEntry {
  quickWorkerEntrySequence += 1;
  return {
    id: `quick-worker-${Date.now()}-${quickWorkerEntrySequence}`,
    form: { ...emptyForm(), recruiter_staff: recruiterStaff },
    frontFile: null,
    backFile: null,
    frontPreview: "",
    backPreview: "",
    qrScannedSide: null,
  };
}

function releaseEntryPreviews(entry: QuickWorkerEntry) {
  if (entry.frontPreview) URL.revokeObjectURL(entry.frontPreview);
  if (entry.backPreview) URL.revokeObjectURL(entry.backPreview);
}

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

const emptyForm = (): QuickWorkerForm => ({
  real_name: "",
  worker_name_snapshot: "",
  cccd: "",
  phone: "",
  date_of_birth: "",
  cccd_issue_date: "",
  gender: "",
  address: "",
  bank_name: "",
  bank_account_number: "",
  bank_account_name: "",
  bank_account_note: "",
  recruiter_staff: "",
  join_date: todayIso(),
  main_house: "",
  factory: "",
  employee_code: "",
  note: "",
});

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

function normalizeStoredNumericField(value: string) {
  return value.trim().replace(/[^0-9]+$/, "");
}

function hasRequiredDigits(value: string, count: number) {
  return digitsOnly(value).length === count;
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

export function QuickWorkerAccountDialog({
  open,
  onOpenChange,
  actor,
  factories,
  mainHouses,
  staffUsers,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actor: UserRecord | null;
  factories: FactoryRecord[];
  mainHouses: MainHouseRecord[];
  staffUsers: UserRecord[];
  onCreated: (results: QuickWorkerCreatedResult[]) => void | Promise<void>;
}) {
  const [entries, setEntries] = useState<QuickWorkerEntry[]>(() => [createQuickWorkerEntry()]);
  const [scanningEntrySide, setScanningEntrySide] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState("");
  const [scanFailure, setScanFailure] = useState<QuickScanFailure | null>(null);
  const [scanFailureOpen, setScanFailureOpen] = useState(false);
  const [pendingQrOverwrite, setPendingQrOverwrite] = useState<PendingQrOverwrite | null>(null);
  const [cropRequest, setCropRequest] = useState<QuickCropRequest | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [recordErrors, setRecordErrors] = useState<Record<string, string[]>>({});
  const entriesRef = useRef(entries);
  const scanSequenceRef = useRef(0);
  const activeScanRef = useRef<{
    key: string;
    sequence: number;
    controller: AbortController;
  } | null>(null);
  const frontCameraInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const frontLibraryInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const backCameraInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const backLibraryInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const cancelActiveScan = useCallback((key?: string) => {
    const active = activeScanRef.current;
    if (!active || (key && active.key !== key)) return;
    active.controller.abort();
    activeScanRef.current = null;
    setScanningEntrySide((current) => (!key || current === key ? null : current));
    setScanProgress("");
  }, []);

  const resetFormState = useCallback(() => {
    cancelActiveScan();
    setEntries((current) => {
      current.forEach(releaseEntryPreviews);
      return [createQuickWorkerEntry()];
    });
    setScanningEntrySide(null);
    setScanProgress("");
    setScanFailureOpen(false);
    setScanFailure(null);
    setPendingQrOverwrite(null);
    setCropRequest(null);
    setRecordErrors({});
    setSubmitting(false);
  }, [cancelActiveScan]);

  useEffect(() => {
    if (!open) resetFormState();
  }, [open, resetFormState]);

  useEffect(() => {
    return () => {
      activeScanRef.current?.controller.abort();
      entriesRef.current.forEach(releaseEntryPreviews);
    };
  }, []);

  const clearRecordError = (entryId: string) => {
    setRecordErrors((current) => {
      if (!current[entryId]) return current;
      const next = { ...current };
      delete next[entryId];
      return next;
    });
  };

  const setField = <K extends keyof QuickWorkerForm>(
    entryId: string,
    key: K,
    value: QuickWorkerForm[K],
  ) => {
    setEntries((current) =>
      current.map((entry) =>
        entry.id === entryId ? { ...entry, form: { ...entry.form, [key]: value } } : entry,
      ),
    );
    clearRecordError(entryId);
  };

  const getQrChanges = (data: CccdQrData): Partial<QuickWorkerForm> => ({
    cccd: data.cccd || "",
    real_name: data.fullName || "",
    worker_name_snapshot: data.fullName || "",
    date_of_birth: data.dateOfBirth ? displayDateToPocketBase(data.dateOfBirth) : "",
    cccd_issue_date: data.issuedDate ? displayDateToPocketBase(data.issuedDate) : "",
    gender: data.gender || "",
    address: data.address || "",
  });

  const applyQrData = (entryId: string, data: CccdQrData, overwriteAll: boolean) => {
    const currentEntry = entriesRef.current.find((entry) => entry.id === entryId);
    if (!currentEntry) return;

    const changeEntries = Object.entries(getQrChanges(data)) as Array<
      [keyof QuickWorkerForm, string]
    >;
    setEntries((current) =>
      current.map((entry) => {
        if (entry.id !== entryId) return entry;
        const nextForm = { ...entry.form };
        for (const [key, value] of changeEntries) {
          if (!value) continue;
          if (!nextForm[key] || overwriteAll || nextForm[key] === value) nextForm[key] = value;
        }
        return { ...entry, form: nextForm };
      }),
    );
    clearRecordError(entryId);
    setPendingQrOverwrite(null);
    toast.success("Đã áp dụng thông tin CCCD");
  };

  const prepareQrData = (entryId: string, data: CccdQrData) => {
    const currentEntry = entriesRef.current.find((entry) => entry.id === entryId);
    if (!currentEntry) return;
    const overwriteKeys = (
      Object.entries(getQrChanges(data)) as Array<[keyof QuickWorkerForm, string]>
    )
      .filter(
        ([key, value]) =>
          Boolean(value) && Boolean(currentEntry.form[key]) && currentEntry.form[key] !== value,
      )
      .map(([key]) => key);

    if (overwriteKeys.length > 0) {
      setPendingQrOverwrite({ entryId, data, fields: overwriteKeys });
      return;
    }
    applyQrData(entryId, data, true);
  };

  const scanImage = async (
    entryId: string,
    file: File,
    side: QuickScanSide,
    mode: CccdQrScanMode = "auto",
  ) => {
    cancelActiveScan();
    const scanningKey = `${entryId}:${side}`;
    const sequence = ++scanSequenceRef.current;
    const controller = new AbortController();
    activeScanRef.current = { key: scanningKey, sequence, controller };
    setScanningEntrySide(scanningKey);
    setScanProgress("Đang chuẩn bị ảnh CCCD…");

    try {
      const result = await scanCccdQrFromFileDetailed(file, {
        mode,
        signal: controller.signal,
        onProgress: (stage) => {
          if (activeScanRef.current?.sequence === sequence) setScanProgress(stage.message);
        },
      });
      if (activeScanRef.current?.sequence !== sequence) return;

      if (result.status === "success") {
        setScanFailureOpen(false);
        setScanFailure(null);
        setEntries((current) =>
          current.map((entry) =>
            entry.id === entryId ? { ...entry, qrScannedSide: side } : entry,
          ),
        );
        prepareQrData(entryId, result.data);
        return;
      }
      if (result.reason === "cancelled") return;
      setScanFailure({ entryId, side, file, reason: result.reason });
      setScanFailureOpen(true);
    } catch {
      if (activeScanRef.current?.sequence === sequence) {
        setScanFailure({ entryId, side, file, reason: "not_found" });
        setScanFailureOpen(true);
      }
    } finally {
      if (activeScanRef.current?.sequence === sequence) {
        activeScanRef.current = null;
        setScanningEntrySide(null);
        setScanProgress("");
      }
    }
  };

  const applyCccdImage = async (entryId: string, side: QuickScanSide, file: File) => {
    const currentEntry = entriesRef.current.find((entry) => entry.id === entryId);
    const skipAutomaticScan = Boolean(
      currentEntry?.qrScannedSide && currentEntry.qrScannedSide !== side,
    );
    const resetSuccessfulScan = currentEntry?.qrScannedSide === side;

    setScanFailureOpen(false);
    setScanFailure(null);
    const preview = URL.createObjectURL(file);
    setEntries((current) =>
      current.map((entry) => {
        if (entry.id !== entryId) return entry;
        if (side === "front") {
          if (entry.frontPreview) URL.revokeObjectURL(entry.frontPreview);
          return {
            ...entry,
            frontFile: file,
            frontPreview: preview,
            qrScannedSide: resetSuccessfulScan ? null : entry.qrScannedSide,
          };
        }
        if (entry.backPreview) URL.revokeObjectURL(entry.backPreview);
        return {
          ...entry,
          backFile: file,
          backPreview: preview,
          qrScannedSide: resetSuccessfulScan ? null : entry.qrScannedSide,
        };
      }),
    );
    clearRecordError(entryId);
    if (!skipAutomaticScan) await scanImage(entryId, file, side);
  };

  const requestCrop = (
    entryId: string,
    side: QuickScanSide,
    file: File | null,
    fallbackMessage?: string,
  ) => {
    if (file && !file.type.startsWith("image/")) {
      toast.error("Vui lòng chọn file ảnh CCCD");
      return;
    }
    setCropRequest({ entryId, side, file, fallbackMessage });
  };

  const pickCccdImage =
    (entryId: string, side: QuickScanSide) => (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0] || null;
      event.target.value = "";
      if (file) requestCrop(entryId, side, file);
    };

  const pasteCccdImage = async (entryId: string, side: QuickScanSide) => {
    const result = await readClipboardImage(side === "front" ? "Mặt trước" : "Mặt sau");
    if (result.status === "success") {
      requestCrop(entryId, side, result.file);
      return;
    }
    requestCrop(entryId, side, null, result.message);
  };

  const clearCccdImage = (entryId: string, side: QuickScanSide) => {
    const scanningKey = `${entryId}:${side}`;
    cancelActiveScan(scanningKey);
    if (scanFailure?.entryId === entryId && scanFailure.side === side) {
      setScanFailureOpen(false);
    }
    setScanFailure((current) =>
      current?.entryId === entryId && current.side === side ? null : current,
    );
    setEntries((current) =>
      current.map((entry) => {
        if (entry.id !== entryId) return entry;
        if (side === "front") {
          if (entry.frontPreview) URL.revokeObjectURL(entry.frontPreview);
          return {
            ...entry,
            frontFile: null,
            frontPreview: "",
            qrScannedSide: entry.qrScannedSide === side ? null : entry.qrScannedSide,
          };
        }
        if (entry.backPreview) URL.revokeObjectURL(entry.backPreview);
        return {
          ...entry,
          backFile: null,
          backPreview: "",
          qrScannedSide: entry.qrScannedSide === side ? null : entry.qrScannedSide,
        };
      }),
    );
  };

  const addEntry = () => {
    setEntries((current) => [...current, createQuickWorkerEntry()]);
  };

  const removeEntry = (entryId: string) => {
    if (activeScanRef.current?.key.startsWith(`${entryId}:`)) cancelActiveScan();
    if (scanFailure?.entryId === entryId) setScanFailureOpen(false);
    setScanFailure((current) => (current?.entryId === entryId ? null : current));
    setPendingQrOverwrite((current) => (current?.entryId === entryId ? null : current));
    setCropRequest((current) => (current?.entryId === entryId ? null : current));
    setEntries((current) => {
      if (current.length === 1) return current;
      const entry = current.find((item) => item.id === entryId);
      if (entry) releaseEntryPreviews(entry);
      return current.filter((item) => item.id !== entryId);
    });
    clearRecordError(entryId);
  };

  const validateEntry = (entry: QuickWorkerEntry) => {
    const { form } = entry;
    const realName = form.real_name.trim();
    const cccdRaw = form.cccd;
    const phoneRaw = form.phone;
    const cccdForValidation = cccdRaw.trim();
    const phoneForValidation = phoneRaw.trim();
    const cccdDigits = digitsOnly(cccdForValidation);
    const birthForPb = displayDateToPocketBase(form.date_of_birth);
    const issueDateForPb = displayDateToPocketBase(form.cccd_issue_date);
    const errors: string[] = [];

    if (!realName) errors.push("Nhập tên thật");
    if (!cccdRaw) errors.push("Nhập CCCD để lưu lịch sử đi làm");
    if (phoneForValidation && !hasRequiredDigits(phoneForValidation, 10)) {
      errors.push(
        "Số điện thoại phải có đúng 10 chữ số; ký tự ở cuối chỉ dùng để phân biệt tài khoản và không được lưu",
      );
    }
    if (cccdForValidation && !hasRequiredDigits(cccdForValidation, 12)) {
      errors.push(
        "CCCD phải có đúng 12 chữ số; ký tự ở cuối chỉ dùng để phân biệt tài khoản và không được lưu",
      );
    }
    if (!form.date_of_birth.trim()) errors.push("Nhập ngày sinh");
    else if (!birthForPb) errors.push("Ngày sinh không hợp lệ");
    if (!form.cccd_issue_date.trim()) errors.push("Nhập ngày cấp CCCD");
    else if (!issueDateForPb) errors.push("Ngày cấp CCCD không hợp lệ");
    if (!form.address.trim()) errors.push("Nhập địa chỉ thường trú");
    if ((entry.frontFile || entry.backFile) && ![9, 12].includes(cccdDigits.length)) {
      errors.push("Nhập số CMND/CCCD hợp lệ trước khi lưu ảnh CCCD");
    }
    if (!form.factory) errors.push("Chọn công ty/nhà máy");
    else if (!factories.some((factory) => factory.id === form.factory)) {
      errors.push("Nhà máy không nằm trong phạm vi được phép");
    }
    if (!form.main_house) errors.push("Chọn nhà chính");
    if (!form.recruiter_staff) errors.push("Chọn người tuyển");
    if (!form.join_date) errors.push("Nhập ngày vào làm");

    return { errors };
  };

  const createWorker = async (entry: QuickWorkerEntry, uid: string, historyUid: string) => {
    const { form } = entry;
    const realName = form.real_name.trim();
    const workerName = form.worker_name_snapshot.trim() || realName;
    const cccdRaw = form.cccd;
    const phoneRaw = form.phone;
    const cccd = normalizeStoredNumericField(cccdRaw);
    const phone = normalizeStoredNumericField(phoneRaw);
    const birthForPb = displayDateToPocketBase(form.date_of_birth);
    const issueDateForPb = displayDateToPocketBase(form.cccd_issue_date);
    const [compressedFront, compressedBack] = await Promise.all([
      entry.frontFile ? compressImage(entry.frontFile) : Promise.resolve(null),
      entry.backFile ? compressImage(entry.backFile) : Promise.resolve(null),
    ]);

    const fd = new FormData();
    fd.append("full_name", realName);
    fd.append("phone", phone);
    fd.append("uid", uid);
    fd.append("status", "active");
    fd.append("cccd", cccd);
    fd.append("gender", form.gender.trim());
    if (birthForPb) fd.append("date_of_birth", birthForPb);
    if (issueDateForPb) fd.append("cccd_issue_date", issueDateForPb);
    fd.append("address", form.address.trim());
    fd.append("bank_name", resolveBankName(form.bank_name.trim()));
    fd.append("bank_account_number", form.bank_account_number.replace(/\D/g, ""));
    fd.append("bank_account_name", form.bank_account_name.trim());
    fd.append("bank_account_note", form.bank_account_note.trim());

    const createdUser = await pb.collection("workers").create<WorkerRecord>(fd);
    const secondaryWarnings: string[] = [];
    const cacheUser: WorkerRecord = {
      ...createdUser,
      full_name: realName,
      phone,
      cccd,
    };

    try {
      await updateCachedUser(cacheUser);
    } catch {
      secondaryWarnings.push("chưa cập nhật được cache hồ sơ");
    }

    let cccdVersion: CccdVersionRecord | undefined;
    let cccdVersionId: string | undefined;
    if (cccd && (compressedFront || compressedBack)) {
      try {
        const version = await findOrCreateCccdVersion(
          createdUser.id,
          cccd,
          compressedFront,
          compressedBack,
        );
        cccdVersion = version;
        cccdVersionId = version.id;
      } catch (error) {
        secondaryWarnings.push(
          `chưa lưu được phiên bản CCCD (${getErrorMessage(error, "lỗi không rõ")})`,
        );
      }
    }

    let history: EmploymentHistoryRecord | undefined;
    let historyId: string | undefined;
    try {
      history = await createEmploymentHistory(
        {
          user: createdUser.id,
          factory: form.factory,
          main_house: form.main_house,
          employee_code: form.employee_code.trim(),
          worker_name_snapshot: workerName,
          worker_cccd_snapshot: cccd,
          worker_date_of_birth_snapshot: birthForPb,
          worker_address_snapshot: form.address.trim(),
          hometown_snapshot: form.address.trim(),
          cccd_issue_date: issueDateForPb,
          ...buildRecruiterPayload(form.recruiter_staff),
          cccd_version: cccdVersionId,
          join_date: form.join_date,
          note: form.note.trim(),
        },
        { uid: historyUid },
      );
      historyId = history.id;
    } catch (error) {
      secondaryWarnings.push(
        `chưa tạo được lịch sử đi làm (${getErrorMessage(error, "lỗi không rõ")})`,
      );
    }

    try {
      await createStaffActionLog({
        actor,
        targetUserId: createdUser.id,
        targetCollection: "workers",
        targetRecord: createdUser.id,
        action: "create",
        after: { id: createdUser.id, uid, full_name: realName, cccd },
        note: "Tạo nhanh hồ sơ NLĐ từ mục NLĐ",
      });
      if (historyId) {
        await createStaffActionLog({
          actor,
          targetUserId: createdUser.id,
          targetCollection: "employment_histories",
          targetRecord: historyId,
          action: "report_join",
          after: { id: historyId },
          note: "Tạo nhanh lịch sử đi làm từ mục NLĐ",
        });
      }
    } catch {
      secondaryWarnings.push("chưa ghi được nhật ký thao tác");
    }

    return {
      user: cacheUser,
      history,
      cccdVersion,
      warnings: secondaryWarnings,
    } satisfies QuickWorkerCreatedResult;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!actor?.id) return toast.error("Không xác định người thao tác");

    const validationErrors: Record<string, string[]> = {};
        entries.forEach((entry, index) => {
      const { errors } = validateEntry(entry);
      if (errors.length > 0) validationErrors[entry.id] = errors;
    });
    if (Object.keys(validationErrors).length > 0) {
      setRecordErrors(validationErrors);
      const details = entries
        .map((entry, index) =>
          validationErrors[entry.id]?.length
            ? `NLĐ #${index + 1}: ${validationErrors[entry.id].join("; ")}`
            : "",
        )
        .filter(Boolean)
        .join(" | ");
      toast.error(details);
      return;
    }

    setSubmitting(true);
    setRecordErrors({});
    const created: Array<{ entry: QuickWorkerEntry; result: QuickWorkerCreatedResult }> = [];
    const failed: Record<string, string[]> = {};

    let userUids: string[] = [];
    let historyUids: string[] = [];
    try {
      [userUids, historyUids] = await Promise.all([
        allocateUserUids(entries.length),
        allocateEmploymentHistoryUids(entries.length),
      ]);
    } catch (error) {
      toast.error(getErrorMessage(error, "Không cấp được dải UID để tạo NLĐ"));
      setSubmitting(false);
      return;
    }

    for (const [index, entry] of entries.entries()) {
      try {
        const result = await createWorker(entry, userUids[index], historyUids[index]);
        created.push({ entry, result });
      } catch (error) {
        const message =
          getPocketBaseFieldErrors(error) ||
          getErrorMessage(error, "Không tạo được hồ sơ NLĐ");
        failed[entry.id] = [message];
      }
    }

    let refreshWarning = "";
    if (created.length > 0) {
      try {
        await onCreated(created.map(({ result }) => result));
      } catch {
        refreshWarning = "Đã tạo hồ sơ nhưng chưa cập nhật được danh sách cục bộ";
      }
    }

    const createdIds = new Set(created.map(({ entry }) => entry.id));
    if (Object.keys(failed).length > 0) {
      setRecordErrors(failed);
      setEntries((current) => {
        current.filter((entry) => createdIds.has(entry.id)).forEach(releaseEntryPreviews);
        return current.filter((entry) => !createdIds.has(entry.id));
      });
      const failureDetails = entries
        .map((entry, index) =>
          failed[entry.id]?.length ? `NLĐ #${index + 1}: ${failed[entry.id].join("; ")}` : "",
        )
        .filter(Boolean)
        .join(" | ");
      toast.error(
        created.length > 0
          ? `Đã tạo ${created.length} NLĐ. ${failureDetails}`
          : `Chưa tạo được NLĐ. ${failureDetails}`,
      );
      if (refreshWarning) toast.warning(refreshWarning);
    } else {
      const warnings = created.flatMap(({ entry, result }) =>
        result.warnings.map(
          (warning) => `NLĐ #${entries.findIndex((item) => item.id === entry.id) + 1}: ${warning}`,
        ),
      );
      if (refreshWarning) warnings.push(refreshWarning);
      resetFormState();
      onOpenChange(false);
      if (warnings.length > 0) {
        toast.warning(`Đã tạo ${created.length} NLĐ, nhưng ${warnings.join("; ")}.`);
      } else {
        toast.success(
          created.length === 1 ? "Đã tạo nhanh hồ sơ NLĐ" : `Đã tạo ${created.length} NLĐ`,
        );
      }
    }

    setSubmitting(false);
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (submitting) return;
          if (!value) cancelActiveScan();
          onOpenChange(value);
        }}
      >
        <DialogContent
          layout="raw"
          overlayClassName="desktop:left-[var(--desktop-workspace-left,17.5rem)] desktop:top-20 desktop:right-0 desktop:bottom-0 desktop:bg-black/50"
          className="fixed flex h-[92dvh] max-h-[92dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl desktop:left-[var(--desktop-workspace-left,17.5rem)] desktop:top-20 desktop:right-0 desktop:bottom-0 desktop:h-auto desktop:max-h-none desktop:w-auto desktop:max-w-none desktop:translate-x-0 desktop:translate-y-0 desktop:rounded-none"
        >
          <DialogHeader className="shrink-0 border-b bg-background px-5 py-4 pr-14 desktop:px-5 desktop:py-3 desktop:pr-14">
            <DialogTitle>Tạo nhanh hồ sơ NLĐ</DialogTitle>
            <DialogDescription>
              Tạo hồ sơ NLĐ và ghi nhận lịch sử đang đi làm trong một bước.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 desktop:px-5 desktop:py-3">
              <div className="space-y-3">
                {entries.map((entry, index) => (
                  <section
                    key={entry.id}
                    className="desktop:rounded-xl desktop:border desktop:border-border desktop:bg-muted/15 desktop:p-3"
                  >
                    <div className="mb-3 hidden items-center justify-between gap-3 desktop:flex">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">NLĐ #{index + 1}</p>
                        {recordErrors[entry.id]?.length ? (
                          <p
                            className="mt-0.5 truncate text-xs text-destructive"
                            title={recordErrors[entry.id].join("; ")}
                          >
                            {recordErrors[entry.id].join("; ")}
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            Nhập thông tin người lao động
                          </p>
                        )}
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 shrink-0 text-destructive hover:text-destructive"
                        onClick={() => removeEntry(entry.id)}
                        disabled={submitting || entries.length === 1}
                      >
                        <Trash2 className="h-4 w-4" />
                        Xóa
                      </Button>
                    </div>

                    <QuickWorkerEntryFields
                      entry={entry}
                      scanningEntrySide={scanningEntrySide}
                      scanProgress={scanProgress}
                      staffUsers={staffUsers}
                      mainHouses={mainHouses}
                      factories={factories}
                      frontCameraInputRef={(node) => {
                        frontCameraInputRefs.current[entry.id] = node;
                      }}
                      frontLibraryInputRef={(node) => {
                        frontLibraryInputRefs.current[entry.id] = node;
                      }}
                      backCameraInputRef={(node) => {
                        backCameraInputRefs.current[entry.id] = node;
                      }}
                      backLibraryInputRef={(node) => {
                        backLibraryInputRefs.current[entry.id] = node;
                      }}
                      onSetField={setField}
                      onPick={pickCccdImage}
                      onScan={scanImage}
                      onClear={clearCccdImage}
                      onPasteImage={(entryId, side) => void pasteCccdImage(entryId, side)}
                      onCropImage={(entryId, side) => {
                        const currentEntry = entriesRef.current.find((item) => item.id === entryId);
                        const file =
                          side === "front" ? currentEntry?.frontFile : currentEntry?.backFile;
                        if (file) requestCrop(entryId, side, file);
                      }}
                      onPaste={(entryId, data) => {
                        cancelActiveScan();
                        setScanFailure(null);
                        prepareQrData(entryId, data);
                      }}
                      onRequestCamera={(side) =>
                        (side === "front" ? frontCameraInputRefs : backCameraInputRefs).current[
                          entry.id
                        ]?.click()
                      }
                      onRequestLibrary={(side) =>
                        (side === "front" ? frontLibraryInputRefs : backLibraryInputRefs).current[
                          entry.id
                        ]?.click()
                      }
                    />
                  </section>
                ))}
              </div>
            </div>

            <DialogFooter className="shrink-0 border-t bg-background px-5 py-4 desktop:px-5 desktop:py-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                Hủy
              </Button>
              <Button
                type="button"
                variant="outline"
                className="hidden desktop:inline-flex"
                onClick={addEntry}
                disabled={submitting}
              >
                <Plus className="h-4 w-4" />
                Bổ sung NLĐ
              </Button>
              <Button type="submit" disabled={submitting || scanningEntrySide !== null}>
                <BriefcaseBusiness className="h-4 w-4" />
                {submitting
                  ? "Đang lưu..."
                  : entries.length === 1
                    ? "Tạo nhanh"
                    : `Tạo ${entries.length} NLĐ`}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <CccdImageCropDialog
        open={Boolean(cropRequest)}
        sourceFile={cropRequest?.file || null}
        sideLabel={cropRequest?.side === "back" ? "Mặt sau" : "Mặt trước"}
        fallbackMessage={cropRequest?.fallbackMessage}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setCropRequest(null);
        }}
        onConfirm={(file) => {
          if (!cropRequest) return;
          void applyCccdImage(cropRequest.entryId, cropRequest.side, file);
        }}
      />

      {scanFailure && (
        <CccdQrScanFeedbackDialog
          open={scanFailureOpen}
          reason={scanFailure.reason}
          scanning={scanningEntrySide === `${scanFailure.entryId}:${scanFailure.side}`}
          progressText={scanProgress}
          onRetry={() =>
            void scanImage(scanFailure.entryId, scanFailure.file, scanFailure.side, "full")
          }
          onCapture={() => {
            const input =
              scanFailure.side === "front"
                ? frontCameraInputRefs.current[scanFailure.entryId]
                : backCameraInputRefs.current[scanFailure.entryId];
            setScanFailureOpen(false);
            input?.click();
          }}
          onChooseImage={() => {
            const input =
              scanFailure.side === "front"
                ? frontLibraryInputRefs.current[scanFailure.entryId]
                : backLibraryInputRefs.current[scanFailure.entryId];
            setScanFailureOpen(false);
            input?.click();
          }}
          onDismiss={() => {
            cancelActiveScan(`${scanFailure.entryId}:${scanFailure.side}`);
            setScanFailureOpen(false);
          }}
        />
      )}

      <Dialog
        open={Boolean(pendingQrOverwrite)}
        onOpenChange={(nextOpen) => !nextOpen && setPendingQrOverwrite(null)}
      >
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>Xác nhận thông tin CCCD</DialogTitle>
            <DialogDescription>
              Một số ô đã có dữ liệu. Chọn cách áp dụng thông tin CCCD mới.
            </DialogDescription>
          </DialogHeader>
          {pendingQrOverwrite && (
            <div className="rounded-xl border border-border/70 bg-muted/35 p-3 text-sm">
              <p className="font-medium">Các trường có dữ liệu khác:</p>
              <p className="mt-1 leading-5 text-muted-foreground">
                {pendingQrOverwrite.fields.map((field) => fieldLabels[field]).join(", ")}
              </p>
            </div>
          )}
          <DialogFooter className="sm:flex-wrap">
            <Button type="button" variant="ghost" onClick={() => setPendingQrOverwrite(null)}>
              Bỏ qua
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (!pendingQrOverwrite) return;
                applyQrData(pendingQrOverwrite.entryId, pendingQrOverwrite.data, false);
              }}
            >
              Chỉ điền ô trống
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (!pendingQrOverwrite) return;
                applyQrData(pendingQrOverwrite.entryId, pendingQrOverwrite.data, true);
              }}
            >
              Ghi đè bằng dữ liệu mới
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function QuickWorkerEntryFields({
  entry,
  scanningEntrySide,
  scanProgress,
  staffUsers,
  mainHouses,
  factories,
  frontCameraInputRef,
  frontLibraryInputRef,
  backCameraInputRef,
  backLibraryInputRef,
  onSetField,
  onPick,
  onScan,
  onClear,
  onPasteImage,
  onCropImage,
  onPaste,
  onRequestCamera,
  onRequestLibrary,
}: {
  entry: QuickWorkerEntry;
  scanningEntrySide: string | null;
  scanProgress: string;
  staffUsers: UserRecord[];
  mainHouses: MainHouseRecord[];
  factories: FactoryRecord[];
  frontCameraInputRef: RefCallback<HTMLInputElement>;
  frontLibraryInputRef: RefCallback<HTMLInputElement>;
  backCameraInputRef: RefCallback<HTMLInputElement>;
  backLibraryInputRef: RefCallback<HTMLInputElement>;
  onSetField: <K extends keyof QuickWorkerForm>(
    entryId: string,
    key: K,
    value: QuickWorkerForm[K],
  ) => void;
  onPick: (
    entryId: string,
    side: "front" | "back",
  ) => (event: ChangeEvent<HTMLInputElement>) => void;
  onScan: (
    entryId: string,
    file: File,
    side: QuickScanSide,
    mode?: CccdQrScanMode,
  ) => Promise<void>;
  onClear: (entryId: string, side: QuickScanSide) => void;
  onPasteImage: (entryId: string, side: QuickScanSide) => void;
  onCropImage: (entryId: string, side: QuickScanSide) => void;
  onPaste: (entryId: string, data: CccdQrData) => void;
  onRequestCamera: (side: "front" | "back") => void;
  onRequestLibrary: (side: "front" | "back") => void;
}) {
  const { form } = entry;
  const setField = <K extends keyof QuickWorkerForm>(key: K, value: QuickWorkerForm[K]) =>
    onSetField(entry.id, key, value);

  return (
    <div className="grid gap-3 sm:grid-cols-[220px_1fr] desktop:grid-cols-[240px_minmax(0,1fr)] desktop:gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-1 desktop:grid-cols-2 desktop:gap-2">
        <CccdImageBox
          label="CCCD trước"
          preview={entry.frontPreview}
          scanning={scanningEntrySide === `${entry.id}:front`}
          scanProgress={scanProgress}
          cameraInputRef={frontCameraInputRef}
          libraryInputRef={frontLibraryInputRef}
          onPick={onPick(entry.id, "front")}
          onScan={() => entry.frontFile && onScan(entry.id, entry.frontFile, "front", "full")}
          onClear={() => onClear(entry.id, "front")}
          onPasteImage={() => onPasteImage(entry.id, "front")}
          onCropImage={() => onCropImage(entry.id, "front")}
          onRequestCamera={() => onRequestCamera("front")}
          onRequestLibrary={() => onRequestLibrary("front")}
        />
        <CccdImageBox
          label="CCCD sau"
          preview={entry.backPreview}
          scanning={scanningEntrySide === `${entry.id}:back`}
          scanProgress={scanProgress}
          cameraInputRef={backCameraInputRef}
          libraryInputRef={backLibraryInputRef}
          onPick={onPick(entry.id, "back")}
          onScan={() => entry.backFile && onScan(entry.id, entry.backFile, "back", "full")}
          onClear={() => onClear(entry.id, "back")}
          onPasteImage={() => onPasteImage(entry.id, "back")}
          onCropImage={() => onCropImage(entry.id, "back")}
          onRequestCamera={() => onRequestCamera("back")}
          onRequestLibrary={() => onRequestLibrary("back")}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 desktop:grid-cols-[1.55fr_1.1fr_1.05fr_1.35fr_0.82fr_0.95fr] desktop:grid-rows-3 desktop:items-stretch desktop:gap-2">
        <TextField
          label="Họ tên"
          value={form.real_name}
          onChange={(value) => setField("real_name", value)}
          placeholder="Họ tên"
          desktopClassName="desktop:col-start-1 desktop:row-start-1"
        />
        <TextField
          label="Tên đi làm"
          value={form.worker_name_snapshot}
          onChange={(value) => setField("worker_name_snapshot", value)}
          placeholder="Tên đi làm"
          desktopClassName="desktop:col-start-2 desktop:row-start-1"
        />
        <div className="flex min-w-0 flex-col gap-1 desktop:col-start-3 desktop:row-start-1 desktop:gap-0">
          <Label className="truncate text-xs desktop:hidden">Ngân hàng</Label>
          <BankPicker
            value={form.bank_name}
            onChange={(value) => setField("bank_name", value)}
            triggerClassName="bg-white text-slate-900 desktop:h-9 desktop:rounded-lg desktop:px-2.5 desktop:text-sm"
          />
        </div>
        <TextField
          label="STK"
          value={form.bank_account_number}
          onChange={(value) => setField("bank_account_number", value.replace(/\D/g, ""))}
          placeholder="STK"
          inputMode="numeric"
          desktopClassName="desktop:col-start-4 desktop:row-start-1"
        />
        <TextField
          label="Chủ TK"
          value={form.bank_account_name}
          onChange={(value) => setField("bank_account_name", value)}
          placeholder="Chủ TK"
          desktopClassName="desktop:col-start-5 desktop:row-start-1"
        />
        <TextField
          label="Ghi chú TK"
          value={form.bank_account_note}
          onChange={(value) => setField("bank_account_note", value)}
          placeholder="Ghi chú TK"
          desktopClassName="desktop:col-start-6 desktop:row-start-1"
        />
        <TextField
          label="SĐT (tùy chọn)"
          value={form.phone}
          onChange={(value) => setField("phone", value)}
          placeholder="SĐT (tùy chọn)"
          inputMode="tel"
          desktopClassName="desktop:col-start-1 desktop:row-start-2"
        />
        <TextField
          label="CMND/CCCD"
          value={form.cccd}
          onChange={(value) => setField("cccd", value)}
          placeholder="CCCD"
          inputMode="text"
          trailingAction={
            <CccdQrPasteButton
              disabled={scanningEntrySide !== null}
              className="bg-white/90"
              onData={(data) => onPaste(entry.id, data)}
            />
          }
          desktopClassName="desktop:col-start-2 desktop:row-start-2"
        />
        <TextField
          label="Ngày sinh"
          type="date"
          value={form.date_of_birth}
          onChange={(value) => setField("date_of_birth", value)}
          placeholder="Ngày sinh"
          desktopClassName="desktop:col-start-3 desktop:row-start-2"
        />
        <div className="flex min-w-0 flex-col gap-1 desktop:col-start-4 desktop:row-start-2 desktop:gap-0 desktop:max-w-none">
          <Label className="truncate text-xs desktop:hidden">Giới tính</Label>
          <Select value={form.gender} onValueChange={(value) => setField("gender", value)}>
            <SelectTrigger className="bg-white text-slate-900 desktop:h-9 desktop:rounded-lg desktop:px-2.5 desktop:text-sm">
              <SelectValue placeholder="Giới tính" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Nam">Nam</SelectItem>
              <SelectItem value="Nữ">Nữ</SelectItem>
              <SelectItem value="Khác">Khác</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="sm:col-span-2 desktop:col-span-1 desktop:col-start-5 desktop:row-start-2 desktop:max-w-none">
          <TextField
            label="Địa chỉ"
            value={form.address}
            onChange={(value) => setField("address", value)}
            placeholder="Địa chỉ"
          />
        </div>
        <TextField
          label="Ngày cấp CCCD"
          type="date"
          value={form.cccd_issue_date}
          onChange={(value) => setField("cccd_issue_date", value)}
          placeholder="Ngày cấp CCCD"
          desktopClassName="desktop:col-start-6 desktop:row-start-2"
        />
        <div className="desktop:col-start-1 desktop:row-start-3">
          <RecruiterPicker
            value={form.recruiter_staff as RecruiterSelectionValue}
            onChange={(value) => setField("recruiter_staff", value)}
            internalUsers={staffUsers}
            partners={mainHouses}
            placeholder="Người tuyển"
            triggerClassName="bg-white"
          />
        </div>
        <TextField
          label="Ngày vào"
          type="date"
          value={form.join_date}
          onChange={(value) => setField("join_date", value)}
          placeholder="Ngày vào"
          desktopClassName="desktop:col-start-2 desktop:row-start-3"
        />
        <div className="flex min-w-0 flex-col gap-1 desktop:col-start-3 desktop:row-start-3 desktop:gap-0">
          <Label className="truncate text-xs desktop:hidden">Nhà chính</Label>
          <MainHousePicker
            mainHouses={mainHouses}
            value={form.main_house}
            onChange={(value) => setField("main_house", value)}
            placeholder="Nhà chính"
            triggerClassName="bg-white text-slate-900 desktop:h-9 desktop:rounded-lg desktop:px-2.5 desktop:text-sm"
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1 desktop:col-start-4 desktop:row-start-3 desktop:gap-0">
          <Label className="truncate text-xs desktop:hidden">Công ty</Label>
          <FactoryPicker
            factories={factories}
            value={form.factory}
            onChange={(value) => setField("factory", value)}
            placeholder="Công ty"
            triggerClassName="bg-white text-slate-900 desktop:h-9 desktop:rounded-lg desktop:px-2.5 desktop:text-sm"
          />
        </div>
        <TextField
          label="Mã NV"
          value={form.employee_code}
          onChange={(value) => setField("employee_code", value)}
          placeholder="Mã NV"
          desktopClassName="desktop:col-start-5 desktop:row-start-3"
        />
        <div className="desktop:col-start-6 desktop:row-start-3">
          <Label className="text-xs desktop:hidden">Ghi chú</Label>
          <Textarea
            rows={1}
            value={form.note}
            onChange={(event) => setField("note", event.target.value)}
            placeholder="Ghi chú"
            title={form.note || "Ghi chú"}
            className="truncate bg-white text-slate-900 desktop:h-9 desktop:min-h-9 desktop:resize-none desktop:rounded-lg desktop:px-2.5 desktop:py-2 desktop:text-sm"
          />
        </div>
      </div>
    </div>
  );
}

const fieldLabels: Record<keyof QuickWorkerForm, string> = {
  real_name: "tên thật",
  worker_name_snapshot: "họ tên theo nhà máy",
  cccd: "CCCD",
  phone: "số điện thoại",
  date_of_birth: "ngày sinh",
  cccd_issue_date: "ngày cấp CCCD",
  gender: "giới tính",
  address: "địa chỉ",
  bank_name: "ngân hàng",
  bank_account_number: "số tài khoản",
  bank_account_name: "chủ tài khoản",
  bank_account_note: "ghi chú tài khoản",
  recruiter_staff: "người tuyển",
  join_date: "ngày vào làm",
  main_house: "nhà chính",
  factory: "công ty",
  employee_code: "mã nhân viên",
  note: "ghi chú",
};

function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  inputMode,
  list,
  trailingAction,
  desktopClassName,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"];
  list?: string;
  trailingAction?: ReactNode;
  desktopClassName?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1 desktop:gap-0", desktopClassName)}>
      <Label className="truncate text-xs desktop:hidden" title={label}>
        {label}
      </Label>
      {type === "date" ? (
        <DateInput
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          className="[&_input]:bg-white [&_input]:text-slate-900 desktop:[&_button]:h-7 desktop:[&_button]:w-7 desktop:[&_input]:h-9 desktop:[&_input]:rounded-lg desktop:[&_input]:px-2.5 desktop:[&_input]:pr-8 desktop:[&_input]:text-sm"
        />
      ) : (
        <div className="relative">
          <Input
            type={type}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            inputMode={inputMode}
            list={list}
            title={value || placeholder}
            className={cn(
              "truncate bg-white text-slate-900 desktop:h-9 desktop:rounded-lg desktop:px-2.5 desktop:text-sm",
              trailingAction && "pr-16 desktop:pr-16",
            )}
          />
          {trailingAction && (
            <div className="absolute right-1 top-1/2 -translate-y-1/2">{trailingAction}</div>
          )}
        </div>
      )}
    </div>
  );
}

function CccdImageBox({
  label,
  preview,
  scanning,
  scanProgress,
  cameraInputRef,
  libraryInputRef,
  onPick,
  onScan,
  onClear,
  onPasteImage,
  onCropImage,
  onRequestCamera,
  onRequestLibrary,
}: {
  label: string;
  preview: string;
  scanning: boolean;
  scanProgress: string;
  cameraInputRef: RefCallback<HTMLInputElement>;
  libraryInputRef: RefCallback<HTMLInputElement>;
  onPick: (event: ChangeEvent<HTMLInputElement>) => void;
  onScan: () => void;
  onClear: () => void;
  onPasteImage: () => void;
  onCropImage: () => void;
  onRequestCamera: () => void;
  onRequestLibrary: () => void;
}) {
  return (
    <div className="flex flex-col gap-1 desktop:h-full desktop:gap-0">
      <Label className="text-xs desktop:hidden">{label}</Label>
      <div className="relative aspect-[1.586/1] overflow-hidden rounded-xl border border-dashed border-border bg-white desktop:aspect-auto desktop:h-full">
        <span className="pointer-events-none absolute left-2 top-2 z-30 hidden rounded bg-background/85 px-1.5 py-0.5 text-xs font-medium text-foreground shadow-sm desktop:inline">
          {label}
        </span>
        <button
          type="button"
          className="absolute inset-0 z-10 hidden cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset desktop:block"
          aria-label={preview ? `Đổi ảnh ${label}` : `Chọn ảnh ${label}`}
          title={preview ? `Đổi ảnh ${label}` : `Chọn ảnh ${label}`}
          onClick={onRequestLibrary}
          disabled={scanning}
        />
        {preview && (
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="absolute right-2 top-2 z-30 hidden h-8 w-8 desktop:inline-flex"
            onClick={onClear}
            disabled={scanning}
            aria-label={`Xóa ảnh ${label}`}
            title={`Xóa ảnh ${label}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
        {preview ? (
          <img src={preview} alt={label} className="size-full object-cover" />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-2 p-2 text-xs text-muted-foreground">
            <IdCard className="h-6 w-6 desktop:hidden" />
            <span className="desktop:hidden">{label}</span>
            <div className="grid w-full grid-cols-3 gap-1 desktop:hidden">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-8 px-2 text-xs"
                onClick={() => onRequestCamera()}
                disabled={scanning}
              >
                <Camera className="h-4 w-4" />
                Chụp
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-8 px-2 text-xs"
                onClick={() => onRequestLibrary()}
                disabled={scanning}
              >
                Thư viện
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-8 px-1 text-xs"
                onClick={onPasteImage}
                disabled={scanning}
              >
                <ClipboardPaste className="h-4 w-4" />
                Dán
              </Button>
            </div>
          </div>
        )}
        {preview && (
          <div className="absolute inset-x-2 bottom-2 z-30 flex gap-1 desktop:right-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-8 flex-1"
              onClick={onScan}
              disabled={scanning}
              aria-busy={scanning}
              title={scanning ? scanProgress || "Đang phân tích ảnh CCCD…" : "Quét kỹ lại"}
            >
              <ScanLine className="h-4 w-4" />
              <span className="truncate">
                {scanning ? scanProgress || "Đang phân tích ảnh CCCD…" : "Quét kỹ lại"}
              </span>
            </Button>
            <Button
              type="button"
              size="icon"
              variant="secondary"
              className="h-8 w-8 desktop:hidden"
              onClick={onClear}
              disabled={scanning}
              aria-label={`Xóa ảnh ${label}`}
              title={`Xóa ảnh ${label}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-1 pt-0.5 desktop:pt-1">
        {preview && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 px-2 text-xs desktop:h-7"
            onClick={onCropImage}
            disabled={scanning}
          >
            <Crop className="h-4 w-4" />
            Cắt lại
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={cn("h-8 px-2 text-xs desktop:h-7", !preview && "col-span-2")}
          onClick={onPasteImage}
          disabled={scanning}
        >
          <ClipboardPaste className="h-4 w-4" />
          Dán ảnh
        </Button>
        {preview && (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 px-2 text-xs desktop:hidden"
              onClick={onRequestCamera}
              disabled={scanning}
            >
              <Camera className="h-4 w-4" />
              Ch?p l?i
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 px-2 text-xs desktop:hidden"
              onClick={onRequestLibrary}
              disabled={scanning}
            >
              Th? vi?n
            </Button>
          </>
        )}
      </div>
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onPick}
      />
      <input
        ref={libraryInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onPick}
      />
    </div>
  );
}
