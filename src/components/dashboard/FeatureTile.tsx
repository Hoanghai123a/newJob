import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Lock, LucideIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LoginRequiredDialog } from "@/components/auth/LoginRequiredDialog";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

interface Props {
  to: string;
  onClick?: () => void;
  label: string;
  description?: string;
  icon: LucideIcon;
  variant?: "default" | "accent";
  size?: "default" | "compact";
  align?: "start" | "center";
  badge?: string;
  disabled?: boolean;
  disabledReason?: string;
  allowGuest?: boolean;
}

export function FeatureTile({
  to,
  onClick,
  label,
  description,
  icon: Icon,
  variant = "default",
  size = "default",
  align,
  badge,
  disabled = false,
  disabledReason,
  allowGuest = false,
}: Props) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const isLoginRequired = !user && !allowGuest;
  const isLocked = disabled || isLoginRequired;
  const isCompact = size === "compact";
  const isCentered = isCompact && align !== "start";

  const tileClass = cn(
    "group relative flex rounded-2xl border border-border/70 bg-card text-left transition-colors",
    isCompact ? "min-h-[94px] flex-col gap-2 p-3" : "min-h-[124px] flex-col gap-3 p-4",
    isCentered ? "items-center" : "items-start",
    disabled
      ? "cursor-pointer opacity-60"
      : "shadow-soft hover:border-primary/40 active:scale-[0.98]",
  );

  const iconClass = cn(
    "flex shrink-0 items-center justify-center rounded-xl text-primary-foreground",
    isCompact ? "h-10 w-10" : "h-11 w-11",
    variant === "accent" ? "gradient-accent text-accent-foreground" : "gradient-primary",
    isLocked && "grayscale",
  );

  const content = (
    <>
      <div className={iconClass}>
        <Icon className={isCompact ? "h-[18px] w-[18px]" : "h-5 w-5"} />
      </div>
      {isLocked ? (
        <span
          className={cn(
            "absolute inline-flex items-center justify-center rounded-full bg-muted p-1.5 text-muted-foreground",
            isCompact ? "right-2 top-2" : "right-3 top-3",
          )}
        >
          <Lock className="h-3 w-3" />
        </span>
      ) : badge ? (
        <span
          className={cn(
            "absolute inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 py-0.5 text-[11px] font-semibold leading-4 text-white shadow-sm",
            isCompact ? "right-2 top-2" : "right-3 top-3",
          )}
        >
          {badge}
        </span>
      ) : null}
      <div className={cn("min-w-0 w-full", isCentered && "text-center")}>
        <div
          className={cn("truncate font-semibold tracking-tight", isCompact ? "text-xs" : "text-sm")}
        >
          {label}
        </div>
        {description && !isCompact && (
          <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
            {description}
          </div>
        )}
      </div>
    </>
  );

  if (isLocked) {
    return (
      <>
        <button type="button" onClick={() => setOpen(true)} className={tileClass}>
          {content}
        </button>
        {isLoginRequired ? (
          <LoginRequiredDialog open={open} onOpenChange={setOpen} redirectTo={to} />
        ) : (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{label}</DialogTitle>
                <DialogDescription>
                  {disabledReason ||
                    "Tính năng này dành cho nhân sự đã được admin xác nhận. Vui lòng liên hệ admin để được cập nhật hồ sơ."}
                </DialogDescription>
              </DialogHeader>
            </DialogContent>
          </Dialog>
        )}
      </>
    );
  }

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={tileClass}>
        {content}
      </button>
    );
  }

  return (
    <Link to={to as never} className={tileClass}>
      {content}
    </Link>
  );
}
