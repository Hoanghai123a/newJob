import { Banknote, Landmark } from "lucide-react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { PAYOUT_METHOD_META, type AdvancePayoutMethod } from "@/lib/advances";

type AdvancePayoutMethodPickerProps = {
  value: AdvancePayoutMethod;
  onChange: (value: AdvancePayoutMethod) => void;
  label?: string;
  className?: string;
};

const OPTIONS: Array<{ value: AdvancePayoutMethod; icon: typeof Landmark }> = [
  { value: "bank_transfer", icon: Landmark },
  { value: "cash", icon: Banknote },
];

export function AdvancePayoutMethodPicker({
  value,
  onChange,
  label = "Hình thức nhận tiền",
  className,
}: AdvancePayoutMethodPickerProps) {
  return (
    <div className={cn("space-y-2", className)}>
      <Label className="text-xs font-medium">{label}</Label>
      <div className="grid grid-cols-2 gap-2">
        {OPTIONS.map((option) => {
          const meta = PAYOUT_METHOD_META[option.value];
          const Icon = option.icon;
          const active = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              aria-pressed={active}
              className={cn(
                "min-w-0 rounded-xl border p-2.5 text-left transition-colors",
                active ? "border-primary bg-primary/5" : "border-border bg-card",
              )}
            >
              <div className="flex items-center gap-1.5 text-xs font-semibold">
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{meta.label}</span>
              </div>
              <div className="mt-1 text-[10px] leading-snug text-muted-foreground">
                {meta.description}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
