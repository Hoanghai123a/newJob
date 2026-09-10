import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import ReactCrop, { type Crop, type PixelCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { ClipboardPaste, LoaderCircle, RotateCcw } from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { getUserErrorMessage } from "@/lib/toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const FULL_IMAGE_CROP: Crop = { unit: "%", x: 0, y: 0, width: 100, height: 100 };
const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function CccdImageCropDialog({
  open,
  sourceFile,
  sideLabel,
  fallbackMessage,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  sourceFile: File | null;
  sideLabel: string;
  fallbackMessage?: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (file: File) => void | Promise<void>;
}) {
  const [workingFile, setWorkingFile] = useState<File | null>(sourceFile);
  const [imageUrl, setImageUrl] = useState("");
  const [crop, setCrop] = useState<Crop>(FULL_IMAGE_CROP);
  const [completedCrop, setCompletedCrop] = useState<PixelCrop | null>(null);
  const [saving, setSaving] = useState(false);
  const imageRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setWorkingFile(sourceFile);
    setCrop(FULL_IMAGE_CROP);
    setCompletedCrop(null);
  }, [open, sourceFile]);

  useEffect(() => {
    if (!workingFile) {
      setImageUrl("");
      return;
    }
    const nextUrl = URL.createObjectURL(workingFile);
    setImageUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [workingFile]);

  const acceptPastedFile = (file: File | null) => {
    if (!file || !SUPPORTED_IMAGE_TYPES.has(file.type)) {
      toast.error("Clipboard không chứa ảnh PNG, JPEG hoặc WebP");
      return;
    }
    setWorkingFile(blobToImageFile(file, sideLabel));
    setCrop(FULL_IMAGE_CROP);
    setCompletedCrop(null);
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const imageItem = Array.from(event.clipboardData.items).find((item) =>
      SUPPORTED_IMAGE_TYPES.has(item.type),
    );
    if (!imageItem) {
      toast.error("Nội dung vừa dán không phải ảnh PNG, JPEG hoặc WebP");
      return;
    }
    event.preventDefault();
    acceptPastedFile(imageItem.getAsFile());
  };

  const resetCrop = () => {
    setCrop(FULL_IMAGE_CROP);
    setCompletedCrop(null);
  };

  const confirmCrop = async () => {
    if (!workingFile || !imageRef.current) return;
    setSaving(true);
    try {
      const croppedFile = await createCroppedFile(
        imageRef.current,
        completedCrop,
        workingFile,
        sideLabel,
      );
      await onConfirm(croppedFile);
      onOpenChange(false);
    } catch (error) {
      toast.error(getUserErrorMessage(error, "Không cắt được ảnh CCCD"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !saving && onOpenChange(nextOpen)}>
      <DialogContent
        className="flex max-h-[94dvh] w-[calc(100vw-1rem)] max-w-3xl flex-col overflow-hidden rounded-2xl p-0"
        onPaste={handlePaste}
      >
        <DialogHeader className="shrink-0 border-b px-4 py-3 text-left sm:px-5">
          <DialogTitle>Cắt ảnh CCCD {sideLabel.toLowerCase()}</DialogTitle>
          <DialogDescription>
            Kéo và thay đổi kích thước khung để giữ lại phần ảnh cần sử dụng.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-auto bg-muted/35 p-3 sm:p-4">
          {imageUrl ? (
            <div className="flex min-h-56 items-center justify-center overflow-auto rounded-xl bg-black/90 p-2 sm:min-h-80">
              <ReactCrop
                crop={crop}
                onChange={(pixelCrop, percentCrop) => {
                  setCrop(percentCrop);
                  setCompletedCrop(pixelCrop);
                }}
                onComplete={(pixelCrop) => setCompletedCrop(pixelCrop)}
                minWidth={20}
                minHeight={20}
                keepSelection
              >
                <img
                  ref={imageRef}
                  src={imageUrl}
                  alt={`Ảnh CCCD ${sideLabel.toLowerCase()} cần cắt`}
                  className="max-h-[58dvh] max-w-full object-contain"
                  onLoad={(event) => {
                    const image = event.currentTarget;
                    setCompletedCrop({
                      unit: "px",
                      x: 0,
                      y: 0,
                      width: image.width,
                      height: image.height,
                    });
                  }}
                />
              </ReactCrop>
            </div>
          ) : (
            <div
              tabIndex={0}
              className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-primary/35 bg-white p-6 text-center text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ClipboardPaste className="h-10 w-10 text-primary" />
              <div>
                <p className="font-semibold">Dán ảnh CCCD {sideLabel.toLowerCase()}</p>
                <p className="mt-1 max-w-md text-sm text-muted-foreground">
                  {fallbackMessage || "Sao chép ảnh, chọn vùng này rồi nhấn Ctrl+V."}
                </p>
              </div>
              <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                Hỗ trợ ảnh PNG, JPEG và WebP
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 border-t bg-background px-4 py-3 sm:px-5">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Hủy
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={resetCrop}
            disabled={!workingFile || saving}
          >
            <RotateCcw className="h-4 w-4" />
            Đặt lại
          </Button>
          <Button
            type="button"
            onClick={() => void confirmCrop()}
            disabled={!workingFile || saving}
          >
            {saving && <LoaderCircle className="h-4 w-4 animate-spin" />}
            {saving ? "Đang xử lý..." : "Sử dụng ảnh"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function blobToImageFile(blob: Blob, sideLabel: string) {
  const type = SUPPORTED_IMAGE_TYPES.has(blob.type) ? blob.type : "image/png";
  const extension = type === "image/jpeg" ? "jpg" : type.split("/")[1] || "png";
  const safeSide = sideLabel.toLowerCase().includes("trước") ? "mat-truoc" : "mat-sau";
  return new File([blob], `cccd-${safeSide}-${Date.now()}.${extension}`, { type });
}

async function createCroppedFile(
  image: HTMLImageElement,
  crop: PixelCrop | null,
  sourceFile: File,
  sideLabel: string,
) {
  const renderedWidth = image.width;
  const renderedHeight = image.height;
  if (!renderedWidth || !renderedHeight) throw new Error("Không đọc được kích thước ảnh CCCD");

  const effectiveCrop = crop || {
    unit: "px" as const,
    x: 0,
    y: 0,
    width: renderedWidth,
    height: renderedHeight,
  };
  if (effectiveCrop.width < 1 || effectiveCrop.height < 1) {
    throw new Error("Vùng cắt ảnh không hợp lệ");
  }

  const scaleX = image.naturalWidth / renderedWidth;
  const scaleY = image.naturalHeight / renderedHeight;
  const outputWidth = Math.max(1, Math.round(effectiveCrop.width * scaleX));
  const outputHeight = Math.max(1, Math.round(effectiveCrop.height * scaleY));
  const canvas = document.createElement("canvas");
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Trình duyệt không hỗ trợ cắt ảnh");

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    effectiveCrop.x * scaleX,
    effectiveCrop.y * scaleY,
    effectiveCrop.width * scaleX,
    effectiveCrop.height * scaleY,
    0,
    0,
    outputWidth,
    outputHeight,
  );

  const outputType = SUPPORTED_IMAGE_TYPES.has(sourceFile.type) ? sourceFile.type : "image/jpeg";
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error("Không tạo được ảnh đã cắt"))),
      outputType,
      outputType === "image/png" ? undefined : 0.92,
    );
  });
  return blobToImageFile(blob, sideLabel);
}
