import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function StickyFormActions({
  primary,
  secondary,
  className,
}: {
  primary: ReactNode;
  secondary?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex w-full gap-2", className)}>
      {secondary && <div className="min-w-0 flex-1">{secondary}</div>}
      <div className="min-w-0 flex-1">{primary}</div>
    </div>
  );
}
