import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

export function ReloadButton({
  showLabel = false,
  className,
}: {
  showLabel?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className={cn(
        "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground active:scale-95",
        !showLabel && "w-10 rounded-full px-0",
        className,
      )}
      aria-label="Tải lại toàn bộ trang"
      title="Tải lại toàn bộ trang"
    >
      <RefreshCw className="h-4 w-4" />
      {showLabel && <span>Tải lại</span>}
    </button>
  );
}
