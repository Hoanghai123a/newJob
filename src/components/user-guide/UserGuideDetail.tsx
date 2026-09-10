import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, CheckCircle2, Info } from "lucide-react";
import type { GuideItem } from "@/lib/user-guide-data";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface UserGuideDetailProps {
  guide: GuideItem;
  onBack?: () => void;
}

export function UserGuideDetail({ guide, onBack }: UserGuideDetailProps) {
  const navigate = useNavigate();

  const handleStepClick = (route?: string) => {
    if (route) {
      navigate({ to: route as never });
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition hover:bg-muted hover:text-foreground"
            aria-label="Quay lại"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">{guide.title}</h2>
          <p className="text-xs text-muted-foreground">{guide.category}</p>
        </div>
      </div>

      {/* Steps */}
      <Card className="divide-y divide-border/50">
        {guide.steps.map((step, index) => {
          const isClickable = !!step.route;
          return (
            <div
              key={index}
              className={cn(
                "flex gap-3 p-4 transition",
                isClickable && "cursor-pointer hover:bg-muted/30 active:bg-muted/50",
              )}
              onClick={() => handleStepClick(step.route)}
              role={isClickable ? "button" : undefined}
              tabIndex={isClickable ? 0 : undefined}
              onKeyDown={(e) => {
                if (isClickable && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  handleStepClick(step.route);
                }
              }}
            >
              {/* Step number */}
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                {index + 1}
              </div>

              {/* Step content */}
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-sm font-medium leading-tight">{step.description}</p>
                {step.action && (
                  <p className="text-xs leading-relaxed text-muted-foreground">{step.action}</p>
                )}
                {step.route && (
                  <Link
                    to={step.route as never}
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span>→ {step.route}</span>
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                )}
              </div>

              {/* Checkmark icon */}
              <CheckCircle2 className="h-5 w-5 shrink-0 text-muted-foreground/40" />
            </div>
          );
        })}
      </Card>

      {/* Notes */}
      {guide.notes && (
        <Card className="flex gap-3 border-warning/30 bg-warning/5 p-4">
          <Info className="h-5 w-5 shrink-0 text-warning" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-warning-foreground">Lưu ý</p>
            <p className="mt-1 text-xs leading-relaxed text-warning-foreground/80">
              {guide.notes}
            </p>
          </div>
        </Card>
      )}

      {/* Back button */}
      {onBack && (
        <div className="flex justify-center pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onBack}
            className="rounded-full"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Quay lại danh sách
          </Button>
        </div>
      )}
    </div>
  );
}
