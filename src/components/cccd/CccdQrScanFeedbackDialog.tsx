import { AlertTriangle, Camera, ImagePlus, LoaderCircle, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CccdQrScanFailureReason } from "@/lib/cccd-qr";

type VisibleFailureReason = Exclude<CccdQrScanFailureReason, "cancelled">;

const REASON_TEXT: Record<VisibleFailureReason, string> = {
  not_found: "Không tìm thấy mã QR trong ảnh CCCD.",
  invalid_qr: "Ảnh có mã QR nhưng dữ liệu không đúng định dạng CCCD.",
  timeout: "Ảnh cần nhiều thời gian xử lý hơn lượt quét hiện tại.",
  unsupported_image: "Trình duyệt không thể đọc định dạng ảnh này.",
};

export function CccdQrScanFeedbackDialog({
  open,
  reason,
  scanning,
  progressText,
  onRetry,
  onCapture,
  onChooseImage,
  onDismiss,
}: {
  open: boolean;
  reason: VisibleFailureReason;
  scanning: boolean;
  progressText?: string;
  onRetry: () => void;
  onCapture?: () => void;
  onChooseImage: () => void;
  onDismiss: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onDismiss()}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {scanning ? (
              <LoaderCircle className="h-5 w-5 animate-spin text-primary" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-amber-600" />
            )}
            {scanning ? "Đang quét kỹ mã QR" : "Chưa đọc được mã QR"}
          </DialogTitle>
          <DialogDescription>
            {scanning ? progressText || "Đang phân tích lại ảnh CCCD…" : REASON_TEXT[reason]}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="rounded-xl border border-border/70 bg-muted/35 p-3">
            <p className="font-medium">Để mã QR dễ đọc hơn</p>
            <ul className="mt-2 space-y-1 text-sm leading-5 text-muted-foreground">
              <li>• Giữ thẻ thẳng, lấy nét rõ và để QR đủ lớn trong ảnh.</li>
              <li>• Tránh ánh sáng phản chiếu trực tiếp lên bề mặt thẻ.</li>
              <li>• Không cắt mất cạnh hoặc góc của mã QR.</li>
            </ul>
          </div>

          {!scanning && (
            <div className={`grid gap-2 ${onCapture ? "grid-cols-2" : "grid-cols-1"}`}>
              {onCapture && (
                <Button type="button" variant="outline" onClick={onCapture}>
                  <Camera className="h-4 w-4" />
                  Chụp lại
                </Button>
              )}
              <Button type="button" variant="outline" onClick={onChooseImage}>
                <ImagePlus className="h-4 w-4" />
                Chọn ảnh khác
              </Button>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDismiss}>
            Nhập tay
          </Button>
          <Button type="button" onClick={onRetry} disabled={scanning}>
            {scanning ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <ScanLine className="h-4 w-4" />
            )}
            {scanning ? "Đang quét kỹ…" : "Quét kỹ lại"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
