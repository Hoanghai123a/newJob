import { Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type DataLoadingStateProps = {
  variant?: "page" | "list" | "grid" | "inline";
  label?: string;
  rows?: number;
  className?: string;
};

export function RouteLoadingState() {
  return <DataLoadingState variant="page" label="Đang mở trang..." rows={4} />;
}

export function DataLoadingState({
  variant = "list",
  label = "Đang tải dữ liệu...",
  rows = 3,
  className,
}: DataLoadingStateProps) {
  const rowCount = Math.min(Math.max(Math.trunc(rows), 1), 12);

  if (variant === "inline") {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-busy="true"
        className={cn(
          "inline-flex min-w-0 items-center gap-2 text-xs text-muted-foreground",
          className,
        )}
      >
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </div>
    );
  }

  if (variant === "page") {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-busy="true"
        className={cn(
          "mobile-page min-h-[60dvh] space-y-4 px-4 py-5 desktop:mx-auto desktop:w-full desktop:max-w-[90rem] desktop:px-8 desktop:py-6",
          className,
        )}
      >
        <span className="sr-only">{label}</span>
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-6 w-40 max-w-[65%] rounded-xl" />
            <Skeleton className="h-3 w-56 max-w-[85%]" />
          </div>
          <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
        </div>
        <Skeleton className="h-11 w-full rounded-2xl" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: rowCount }).map((_, index) => (
            <div key={index} className="space-y-3 rounded-2xl border border-border/60 bg-card p-4">
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/5" />
                  <Skeleton className="h-3 w-4/5" />
                </div>
              </div>
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const content = Array.from({ length: rowCount }).map((_, index) => (
    <div
      key={index}
      className="space-y-3 rounded-2xl border border-border/60 bg-card p-4 shadow-sm"
    >
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-4/5" />
    </div>
  ));

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn(
        variant === "grid" ? "grid gap-3 sm:grid-cols-2 xl:grid-cols-3" : "space-y-3",
        className,
      )}
    >
      <span className="sr-only">{label}</span>
      {content}
    </div>
  );
}
