import { TriangleAlert } from "lucide-react";
import { ADVANCE_INTERACTION_DISABLED_MESSAGE } from "@/lib/advance-policy";
import { cn } from "@/lib/utils";

export function AdvanceReadOnlyNotice({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900",
        className,
      )}
      role="status"
    >
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <div className="font-semibold">Chế độ chỉ xem</div>
        <div className="mt-0.5 leading-relaxed">{ADVANCE_INTERACTION_DISABLED_MESSAGE}</div>
      </div>
    </div>
  );
}
