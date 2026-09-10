import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "primary",
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: LucideIcon;
  tone?: "primary" | "info" | "success" | "warning" | "danger";
  className?: string;
}) {
  const toneBg: Record<string, string> = {
    primary: "bg-primary/10 text-primary",
    info: "bg-[color:var(--status-info-bg)] text-[color:var(--status-info-fg)]",
    success: "bg-[color:var(--status-success-bg)] text-[color:var(--status-success-fg)]",
    warning: "bg-[color:var(--status-warning-bg)] text-[color:var(--status-warning-fg)]",
    danger: "bg-[color:var(--status-danger-bg)] text-[color:var(--status-danger-fg)]",
  };
  return (
    <div data-ui-card="stat" className={cn("stat-card", className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        {Icon && (
          <div className={cn("flex h-7 w-7 items-center justify-center rounded-lg", toneBg[tone])}>
            <Icon className="h-3.5 w-3.5" />
          </div>
        )}
      </div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
