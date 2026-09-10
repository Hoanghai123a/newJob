import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  ClipboardPaste,
  Crop,
  IdCard,
  LoaderCircle,
  RefreshCw,
  ScanLine,
  Trash2,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CccdImageCropDialog } from "@/components/cccd/CccdImageCropDialog";
import { readClipboardImage } from "@/lib/clipboard-image";
import { CccdQrPasteButton } from "@/components/cccd/CccdQrPasteButton";
import { CccdQrScanFeedbackDialog } from "@/components/cccd/CccdQrScanFeedbackDialog";
import {
  displayDateToPocketBase,
  scanCccdQrFromFileDetailed,
  type CccdQrData,
  type CccdQrScanFailureReason,
} from "@/lib/cccd-qr";

export type JoinCccdFields = {
  worker_name_snapshot: string;
  worker_cccd_snapshot: string;
  worker_date_of_birth_snapshot: string;
  worker_address_snapshot: string;
  cccd_issue_date: string;
  hometown_snapshot?: string;
};

type LocationField = {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
};

type QrConfirmDraft = {
  fullName: string;
  cccd: string;
  dateOfBirth: string;
  issueDate: string;
  address: string;
};

type ScanSide = "front" | "back";

type FailureState = {
  reason: Exclude<CccdQrScanFailureReason, "cancelled">;
  side: ScanSide;
  file: File;
};

type CropRequest = {
  side: ScanSide;
  file: File | null;
  fallbackMessage?: string;
};

export function JoinCccdSection({
  value,
  onChange,
  frontFile,
  backFile,
  onFrontFileChange,
  onBackFileChange,
  frontImageUrl,
  backImageUrl,
  locationField,
  enableImagePasteAndCrop = false,
}: {
  value: JoinCccdFields;
  onChange: (changes: Partial<JoinCccdFields>) => void;
  frontFile: File | null;
  backFile: File | null;
  onFrontFileChange: (file: File | null) => void;
  onBackFileChange: (file: File | null) => void;
  frontImageUrl?: string;
  backImageUrl?: string;
  locationField?: LocationField;
  enableImagePasteAndCrop?: boolean;
}) {
  const [scanning, setScanning] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [failure, setFailure] = useState<FailureState | null>(null);
  const [qrScannedSide, setQrScannedSide] = useState<ScanSide | null>(null);
  const [cropRequest, setCropRequest] = useState<CropRequest | null>(null);
  const locationLabel = locationField?.label || "Địa chỉ thường trú";
  const locationValue =
    locationField?.value ?? value.worker_address_snapshot ?? value.hometown_snapshot ?? "";
  const locationPlaceholder = locationField?.placeholder || "Nhập địa chỉ thường trú";
  const updateLocation = (nextValue: string) => {
    if (locationField) {
      locationField.onChange(nextValue);
      return;
    }
    onChange({
      worker_address_snapshot: nextValue,
      hometown_snapshot: nextValue,
    });
  };
  const [confirmDraft, setConfirmDraft] = useState<QrConfirmDraft | null>(null);
  const scanSequence = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const frontCameraInputRef = useRef<HTMLInputElement | null>(null);
  const frontLibraryInputRef = useRef<HTMLInputElement | null>(null);
  const backCameraInputRef = useRef<HTMLInputElement | null>(null);
  const backLibraryInputRef = useRef<HTMLInputElement | null>(null);

  const cancelActiveScan = useCallback(() => {
    scanSequence.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setScanning(false);
    setProgressText("");
  }, []);

  useEffect(() => cancelActiveScan, [cancelActiveScan]);

  useEffect(() => {
    setQrScannedSide((current) => {
      if (current === "front" && !frontFile) return null;
      if (current === "back" && !backFile) return null;
      return current;
    });
  }, [frontFile, backFile]);

  const runScan = useCallback(
    async (file: File, side: ScanSide, mode: "auto" | "full") => {
      cancelActiveScan();
      const sequence = ++scanSequence.current;
      const controller = new AbortController();
      abortRef.current = controller;
      setScanning(true);
      setProgressText("Đang chuẩn bị ảnh CCCD…");

      try {
        const result = await scanCccdQrFromFileDetailed(file, {
          mode,
          signal: controller.signal,
          onProgress: (stage) => {
            if (sequence === scanSequence.current) setProgressText(stage.message);
          },
        });
        if (sequence !== scanSequence.current) return;

        if (result.status === "success") {
          setFailure(null);
          setQrScannedSide(side);
          setConfirmDraft(toQrConfirmDraft(result.data));
          return;
        }
        if (result.reason === "cancelled") return;
        setFailure({ reason: result.reason, side, file });
      } catch {
        if (sequence === scanSequence.current) {
          setFailure({ reason: "not_found", side, file });
        }
      } finally {
        if (sequence === scanSequence.current) {
          abortRef.current = null;
          setScanning(false);
          setProgressText("");
        }
      }
    },
    [cancelActiveScan],
  );

  const applyImage = async (file: File, side: ScanSide) => {
    const skipAutomaticScan = Boolean(qrScannedSide && qrScannedSide !== side);
    const resetSuccessfulScan = qrScannedSide === side;

    if (side === "front") onFrontFileChange(file);
    else onBackFileChange(file);

    setFailure(null);
    if (resetSuccessfulScan) setQrScannedSide(null);
    if (!skipAutomaticScan) await runScan(file, side, "auto");
  };

  const handleImagePick = async (file: File | null, side: ScanSide) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error(`Vui lòng chọn ảnh CCCD ${side === "front" ? "mặt trước" : "mặt sau"}`);
      return;
    }

    if (enableImagePasteAndCrop) {
      setCropRequest({ side, file });
      return;
    }
    await applyImage(file, side);
  };

  const pasteImage = async (side: ScanSide) => {
    const result = await readClipboardImage(side === "front" ? "Mặt trước" : "Mặt sau");
    setCropRequest(
      result.status === "success"
        ? { side, file: result.file }
        : { side, file: null, fallbackMessage: result.message },
    );
  };

  const recropImage = (side: ScanSide) => {
    const file = side === "front" ? frontFile : backFile;
    if (file) setCropRequest({ side, file });
  };

  const handleFrontPick = (file: File | null) => handleImagePick(file, "front");
  const handleBackPick = (file: File | null) => handleImagePick(file, "back");

  const applyQrData = () => {
    if (!confirmDraft) return;
    onChange({
      worker_name_snapshot: confirmDraft.fullName.trim(),
      worker_cccd_snapshot: confirmDraft.cccd.replace(/\D/g, ""),
      worker_date_of_birth_snapshot: displayDateToPocketBase(confirmDraft.dateOfBirth),
      cccd_issue_date: displayDateToPocketBase(confirmDraft.issueDate),
    });
    updateLocation(confirmDraft.address.trim());
    setConfirmDraft(null);
    toast.success("Đã áp dụng thông tin CCCD");
  };

  return (
    <>
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Họ tên tại nhà máy</Label>
          <Input
            value={value.worker_name_snapshot}
            onChange={(event) => onChange({ worker_name_snapshot: event.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Số CCCD tại nhà máy</Label>
          <div className="relative">
            <Input
              value={value.worker_cccd_snapshot}
              onChange={(event) =>
                onChange({ worker_cccd_snapshot: event.target.value.replace(/\D/g, "") })
              }
              inputMode="numeric"
              className="pr-16"
            />
            <CccdQrPasteButton
              className="absolute right-1 top-1/2 -translate-y-1/2 bg-background/90"
              disabled={scanning}
              onData={(data) => {
                cancelActiveScan();
                setFailure(null);
                setConfirmDraft(toQrConfirmDraft(data));
              }}
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Ngày sinh</Label>
          <DateInput
            value={value.worker_date_of_birth_snapshot}
            onChange={(worker_date_of_birth_snapshot) =>
              onChange({ worker_date_of_birth_snapshot })
            }
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Ngày cấp CCCD</Label>
          <DateInput
            value={value.cccd_issue_date}
            onChange={(cccd_issue_date) => onChange({ cccd_issue_date })}
          />
        </div>
        <div className="space-y-1 min-[420px]:col-span-2">
          <Label className="text-xs">{locationLabel}</Label>
          <Input
            value={locationValue}
            onChange={(event) => updateLocation(event.target.value)}
            placeholder={locationPlaceholder}
          />
        </div>
        <div className="space-y-1.5 min-[420px]:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <Label className="text-xs font-semibold">Ảnh CCCD (tùy chọn)</Label>
            {scanning && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                {progressText || "Đang đọc mã QR…"}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <CccdFileSlot
              label="Mặt trước"
              file={frontFile}
              existingUrl={frontImageUrl}
              scanning={scanning}
              cameraInputRef={frontCameraInputRef}
              libraryInputRef={frontLibraryInputRef}
              onPick={handleFrontPick}
              enableImagePasteAndCrop={enableImagePasteAndCrop}
              onPasteImage={() => void pasteImage("front")}
              onCropImage={() => recropImage("front")}
              onRescan={() => frontFile && runScan(frontFile, "front", "full")}
              onClear={() => {
                cancelActiveScan();
                setFailure(null);
                if (qrScannedSide === "front") setQrScannedSide(null);
                onFrontFileChange(null);
              }}
            />
            <CccdFileSlot
              label="Mặt sau"
              file={backFile}
              existingUrl={backImageUrl}
              scanning={scanning}
              cameraInputRef={backCameraInputRef}
              libraryInputRef={backLibraryInputRef}
              onPick={handleBackPick}
              enableImagePasteAndCrop={enableImagePasteAndCrop}
              onPasteImage={() => void pasteImage("back")}
              onCropImage={() => recropImage("back")}
              onRescan={() => backFile && runScan(backFile, "back", "full")}
              onClear={() => {
                cancelActiveScan();
                setFailure(null);
                if (qrScannedSide === "back") setQrScannedSide(null);
                onBackFileChange(null);
              }}
            />
          </div>
          <p className="text-[11px] leading-4 text-muted-foreground">
            Chụp hoặc chọn ảnh có mã QR ở mặt trước hoặc mặt sau để tự đọc thông tin. Dữ liệu chỉ
            được điền sau khi bạn xác nhận.
          </p>
        </div>
      </div>

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
          void applyImage(file, cropRequest.side);
        }}
      />

      {failure && (
        <CccdQrScanFeedbackDialog
          open
          reason={failure.reason}
          scanning={scanning}
          progressText={progressText}
          onRetry={() => void runScan(failure.file, failure.side, "full")}
          onCapture={() => {
            const input =
              failure.side === "front" ? frontCameraInputRef.current : backCameraInputRef.current;
            setFailure(null);
            input?.click();
          }}
          onChooseImage={() => {
            const input =
              failure.side === "front" ? frontLibraryInputRef.current : backLibraryInputRef.current;
            setFailure(null);
            input?.click();
          }}
          onDismiss={() => {
            cancelActiveScan();
            setFailure(null);
          }}
        />
      )}

      <Dialog
        open={Boolean(confirmDraft)}
        onOpenChange={(open) => {
          if (!open) setConfirmDraft(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Xác nhận thông tin CCCD</DialogTitle>
            <DialogDescription>
              Kiểm tra trước khi áp dụng vào biểu mẫu báo đi làm. Các thông tin có thể chỉnh sửa
              trước khi áp dụng.
            </DialogDescription>
          </DialogHeader>
          {confirmDraft && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">Họ tên</Label>
                  <Input
                    value={confirmDraft.fullName}
                    onChange={(event) =>
                      setConfirmDraft((current) =>
                        current ? { ...current, fullName: event.target.value } : current,
                      )
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Số CCCD</Label>
                  <Input
                    value={confirmDraft.cccd}
                    inputMode="numeric"
                    onChange={(event) =>
                      setConfirmDraft((current) =>
                        current
                          ? { ...current, cccd: event.target.value.replace(/\D/g, "") }
                          : current,
                      )
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">Ngày sinh</Label>
                  <DateInput
                    value={displayDateToPocketBase(confirmDraft.dateOfBirth)}
                    onChange={(dateOfBirth) =>
                      setConfirmDraft((current) =>
                        current ? { ...current, dateOfBirth } : current,
                      )
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Ngày cấp CCCD</Label>
                  <DateInput
                    value={displayDateToPocketBase(confirmDraft.issueDate)}
                    onChange={(issueDate) =>
                      setConfirmDraft((current) => (current ? { ...current, issueDate } : current))
                    }
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{locationLabel}</Label>
                <Textarea
                  value={confirmDraft.address}
                  rows={2}
                  onChange={(event) =>
                    setConfirmDraft((current) =>
                      current ? { ...current, address: event.target.value } : current,
                    )
                  }
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmDraft(null)}>
              Huỷ
            </Button>
            <Button type="button" onClick={applyQrData}>
              Áp dụng dữ liệu
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function toQrConfirmDraft(data: CccdQrData): QrConfirmDraft {
  return {
    fullName: data.fullName || "",
    cccd: data.cccd || "",
    dateOfBirth: displayDateToPocketBase(data.dateOfBirth),
    issueDate: displayDateToPocketBase(data.issuedDate),
    address: data.address || "",
  };
}

function CccdFileSlot({
  label,
  file,
  existingUrl,
  scanning,
  cameraInputRef,
  libraryInputRef,
  onPick,
  enableImagePasteAndCrop,
  onPasteImage,
  onCropImage,
  onRescan,
  onClear,
}: {
  label: string;
  file: File | null;
  existingUrl?: string;
  scanning: boolean;
  cameraInputRef: React.RefObject<HTMLInputElement | null>;
  libraryInputRef: React.RefObject<HTMLInputElement | null>;
  onPick: (file: File | null) => void | Promise<void>;
  enableImagePasteAndCrop: boolean;
  onPasteImage: () => void;
  onCropImage: () => void;
  onRescan: () => void;
  onClear: () => void;
}) {
  const filePreview = useFilePreview(file);
  const preview = filePreview || existingUrl || "";

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="relative aspect-[1.586/1] overflow-hidden rounded-xl border border-dashed border-border bg-white">
        {preview ? (
          <>
            <img
              src={preview}
              alt={`CCCD ${label.toLowerCase()}`}
              className="h-full w-full object-cover"
            />
            {file && (
              <button
                type="button"
                onClick={onClear}
                className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/95 text-destructive shadow"
                aria-label={`Bỏ ảnh CCCD ${label.toLowerCase()} vừa chọn`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => libraryInputRef.current?.click()}
              disabled={scanning}
              className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-gradient-to-t from-black/70 to-transparent px-2 pb-2 pt-6 text-[11px] font-medium text-white"
            >
              <RefreshCw className="h-3 w-3" /> Đổi ảnh
            </button>
          </>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-2 text-muted-foreground">
            <IdCard className="h-6 w-6" />
            <div className="grid w-full grid-cols-2 gap-1">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-8 px-2 text-xs"
                onClick={() => cameraInputRef.current?.click()}
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
                onClick={() => libraryInputRef.current?.click()}
                disabled={scanning}
              >
                Thư viện
              </Button>
            </div>
          </div>
        )}
      </div>
      {file && (
        <div className="grid grid-cols-2 gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 px-2 text-xs"
            onClick={onRescan}
            disabled={scanning}
            aria-busy={scanning}
          >
            <ScanLine className="h-4 w-4" />
            Quét kỹ lại
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 px-2 text-xs"
            onClick={() => cameraInputRef.current?.click()}
            disabled={scanning}
          >
            <Camera className="h-4 w-4" />
            Chụp lại
          </Button>
        </div>
      )}
      {enableImagePasteAndCrop && (
        <div className="grid grid-cols-2 gap-1">
          {file && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 px-2 text-xs"
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
            className={`h-8 px-2 text-xs ${file ? "" : "col-span-2"}`}
            onClick={onPasteImage}
            disabled={scanning}
          >
            <ClipboardPaste className="h-4 w-4" />
            Dán ảnh
          </Button>
        </div>
      )}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(event) => {
          void onPick(event.target.files?.[0] || null);
          event.target.value = "";
        }}
      />
      <input
        ref={libraryInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          void onPick(event.target.files?.[0] || null);
          event.target.value = "";
        }}
      />
    </div>
  );
}

function useFilePreview(file: File | null) {
  const [preview, setPreview] = useState("");

  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return preview;
}
