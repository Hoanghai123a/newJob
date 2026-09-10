import { CheckCircle2, Smartphone } from "lucide-react";
import { useAppSettings } from "@/lib/app-settings";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const IOS_GUIDE_STEPS = [
  {
    title: "Nhấp vào dấu 3 chấm",
    imageUrl: "/install-guide/ios-step-1.jpg",
  },
  {
    title: "Chọn Chia sẻ",
    imageUrl: "/install-guide/ios-step-2.jpg",
  },
  {
    title: "Chọn Xem thêm",
    imageUrl: "/install-guide/ios-step-3.jpg",
  },
  {
    title: "Chọn Thêm vào Màn hình chính",
    imageUrl: "/install-guide/ios-step-4.jpg",
  },
  {
    title: "Chọn Thêm",
    imageUrl: "/install-guide/ios-step-5.jpg",
  },
];

interface IosInstallGuideDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function IosInstallGuideDialog({ open, onOpenChange }: IosInstallGuideDialogProps) {
  const { data: settings, logoUrl } = useAppSettings();
  const guideSteps = IOS_GUIDE_STEPS;
  const appName = settings.company_name?.trim() || "app";
  const appIconUrl = logoUrl || "/pwa-icon.svg";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        layout="raw"
        className="bottom-0 top-auto grid max-h-[92dvh] w-full max-w-[30rem] translate-y-0 grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-b-none rounded-t-3xl border-x-0 border-b-0 bg-background p-0 shadow-[0_-18px_50px_-24px_rgba(15,23,42,0.48)] sm:rounded-t-3xl [&>button]:hidden"
      >
        <DialogHeader className="flex-row items-center justify-between space-y-0 border-b border-border/60 px-4 py-3 text-left">
          <DialogTitle className="text-[15px] font-semibold leading-6">
            Cài {appName} ra màn hình chính
          </DialogTitle>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="shrink-0 rounded-lg px-2 py-1 text-sm font-semibold text-muted-foreground active:scale-95"
          >
            Đóng
          </button>
        </DialogHeader>

        <div className="space-y-3 overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3">
          <div className="flex items-center gap-3 rounded-2xl bg-muted/45 p-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border/60 bg-background">
              {appIconUrl ? (
                <img src={appIconUrl} alt="" className="logo-fit p-1.5" />
              ) : (
                <Smartphone className="h-5 w-5 text-primary" />
              )}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-foreground">{appName}</div>
              <div className="mt-0.5 text-xs leading-snug text-muted-foreground">
                Biểu tượng sẽ hiển thị trên màn hình chính.
              </div>
            </div>
          </div>

          <p className="rounded-2xl bg-muted/35 px-3.5 py-3 text-xs leading-5 text-muted-foreground">
            Làm theo 5 bước trên iPhone/iPad để thêm app vào màn hình chính.
          </p>

          <div className="space-y-3">
            {guideSteps.map((step, index) => (
              <section
                key={step.title}
                className="rounded-2xl border border-border/75 bg-card p-3 shadow-soft"
              >
                <div className="mb-3 flex items-center gap-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                    {index + 1}
                  </span>
                  <h3 className="min-w-0 text-sm font-semibold leading-5 text-foreground">
                    Bước {index + 1}: {step.title}
                  </h3>
                </div>
                <div className="overflow-hidden rounded-xl bg-[#f7fbfb]">
                  <img
                    src={step.imageUrl}
                    alt={`Bước ${index + 1}: ${step.title}`}
                    className="w-full object-contain"
                    loading="lazy"
                  />
                </div>
              </section>
            ))}
          </div>

          <div className="flex items-start gap-2 rounded-2xl bg-primary px-3.5 py-3 text-sm font-semibold leading-5 text-primary-foreground">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Hoàn thành: mở app từ biểu tượng trên màn hình chính.</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
