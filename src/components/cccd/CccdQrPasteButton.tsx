import { useState } from "react";
import { AlertCircle, ClipboardPaste } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { parseCccdPastedText, type CccdQrData } from "@/lib/cccd-qr";
import { cn } from "@/lib/utils";

const PASTE_EXAMPLE = `Số CCCD: 001234567890
Họ và tên: NGUYỄN VĂN A
Giới tính: Nam
Ngày sinh: 01/01/2000
Nơi thường trú: Phường Minh Khai, Quận Bắc Từ Liêm, Hà Nội
Ngày cấp CCCD: 01/01/2022`;

export function CccdQrPasteButton({
  onData,
  disabled,
  className,
}: {
  onData: (data: CccdQrData) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [manualOpen, setManualOpen] = useState(false);
  const [pastedText, setPastedText] = useState("");
  const [errorText, setErrorText] = useState("");

  const resetDialog = () => {
    setManualOpen(false);
    setPastedText("");
    setErrorText("");
  };

  const applyText = (text: string) => {
    const data = parseCccdPastedText(text);
    if (!data) return false;
    resetDialog();
    onData(data);
    return true;
  };

  const openFallback = (text = "", error = "") => {
    setPastedText(text);
    setErrorText(error);
    setManualOpen(true);
  };

  const pasteFromClipboard = async () => {
    if (!navigator.clipboard?.readText) {
      openFallback("", "Trình duyệt không hỗ trợ đọc clipboard tự động. Hãy dán vào ô bên dưới.");
      return;
    }

    try {
      const text = await navigator.clipboard.readText();
      if (applyText(text)) return;
      openFallback(
        text,
        text.trim()
          ? "Chưa nhận diện được thông tin CCCD. Hãy kiểm tra lại định dạng bên dưới."
          : "Clipboard đang trống. Hãy dán thông tin CCCD vào ô bên dưới.",
      );
    } catch {
      openFallback(
        "",
        "Trình duyệt chưa cho phép đọc clipboard. Hãy dán thông tin CCCD vào ô bên dưới.",
      );
    }
  };

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className={cn("h-8 gap-1 rounded-lg px-2 text-xs", className)}
        onClick={() => void pasteFromClipboard()}
        disabled={disabled}
        aria-label="Dán thông tin CCCD từ clipboard"
        title="Dán thông tin CCCD"
      >
        <ClipboardPaste className="h-3.5 w-3.5" />
        Dán
      </Button>

      <Dialog
        open={manualOpen}
        onOpenChange={(open) => {
          if (!open) resetDialog();
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Dán thông tin CCCD</DialogTitle>
            <DialogDescription>
              Dán nội dung đã đọc từ mã QR. Dữ liệu chỉ được xử lý trên thiết bị và chưa được lưu
              cho đến khi bạn áp dụng biểu mẫu.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Textarea
              value={pastedText}
              onChange={(event) => {
                setPastedText(event.target.value);
                if (errorText) setErrorText("");
              }}
              rows={8}
              autoFocus
              spellCheck={false}
              autoComplete="off"
              placeholder={PASTE_EXAMPLE}
              className="min-h-44 resize-y text-sm"
              aria-invalid={Boolean(errorText)}
            />
            {errorText && (
              <p className="flex items-start gap-1.5 text-xs leading-5 text-destructive">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {errorText}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={resetDialog}>
              Huỷ
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (applyText(pastedText)) return;
                setErrorText(
                  "Cần có họ tên và số CCCD gồm đúng 12 chữ số. Ngày tháng phải theo định dạng ngày/tháng/năm.",
                );
              }}
            >
              Áp dụng
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
