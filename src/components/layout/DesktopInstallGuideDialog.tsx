import { Monitor } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface DesktopInstallGuideDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DesktopInstallGuideDialog({ open, onOpenChange }: DesktopInstallGuideDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88dvh] max-w-[26rem] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Monitor className="h-5 w-5 text-primary" />
            Cài ứng dụng trên máy tính
          </DialogTitle>
          <DialogDescription>
            Làm theo hướng dẫn bên dưới để cài app vào máy tính.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                1
              </span>
              <span className="font-medium leading-6">
                Mở trang này bằng trình duyệt Chrome hoặc Edge
              </span>
            </div>
            <div className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                2
              </span>
              <div>
                <span className="font-medium leading-6">
                  Nhấn vào biểu tượng cài đặt trên thanh địa chỉ
                </span>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Biểu tượng hình màn hình có mũi tên (⊞) nằm ở góc phải thanh địa chỉ. Hoặc bấm dấu
                  3 chấm (⋮) → "Cài đặt ứng dụng..." / "Install app..."
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                3
              </span>
              <span className="font-medium leading-6">Bấm "Cài đặt" trong hộp thoại xuất hiện</span>
            </div>
          </div>
          <div className="rounded-xl bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
            Sau khi cài, app sẽ mở như một ứng dụng riêng trên máy tính — không cần mở trình duyệt.
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
