import { Search, SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusChip, type ChipTone } from "@/components/ui/status-chip";

export interface FilterChip {
  key: string;
  label: string;
  tone?: ChipTone;
  count?: number;
}

export type MobileListToolbarProps = {
  search?: string;
  onSearchChange?: (value: string) => void;
  placeholder?: string;
  chips?: FilterChip[];
  activeChip?: string;
  onChipChange?: (key: string) => void;
  actions?: React.ReactNode;
  chipActions?: React.ReactNode;
  filterCount?: number;
  onOpenFilters?: () => void;
  className?: string;
  desktopSearchAfterChips?: boolean;
  searchClassName?: string;
};

export function MobileListToolbar({
  search,
  onSearchChange,
  placeholder = "Tìm kiếm…",
  chips,
  activeChip,
  onChipChange,
  actions,
  chipActions,
  filterCount = 0,
  onOpenFilters,
  className,
  desktopSearchAfterChips = false,
  searchClassName,
}: MobileListToolbarProps) {
  const filterButton = onOpenFilters ? (
    <button
      type="button"
      onClick={onOpenFilters}
      className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs font-semibold text-foreground transition active:scale-[0.98]"
      aria-label="Mở bộ lọc nâng cao"
    >
      <SlidersHorizontal className="h-4 w-4" />
      <span>Bộ lọc</span>
      {filterCount > 0 && (
        <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[11px] leading-4 text-primary-foreground">
          {filterCount > 9 ? "9+" : filterCount}
        </span>
      )}
    </button>
  ) : null;

  return (
    <div
      className={cn(
        "mobile-list-toolbar sticky top-[var(--header-h,3.5rem)] z-20 -mx-4 space-y-2 bg-background/92 px-4 py-2.5 backdrop-blur-md",
        className,
      )}
    >
      <div
        className={cn(desktopSearchAfterChips && "desktop:flex desktop:items-center desktop:gap-3")}
      >
        {onSearchChange && (
          <div
            className={cn(
              "flex items-center gap-2",
              desktopSearchAfterChips && "desktop:order-2 desktop:ml-auto desktop:w-[22rem]",
              searchClassName,
            )}
          >
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search || ""}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder={placeholder}
                className="h-11 w-full rounded-full border border-border bg-white px-10 text-base text-slate-900 outline-none placeholder:text-slate-500 transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => onSearchChange("")}
                  className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
                  aria-label="Xoá tìm kiếm"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            {filterButton}
            {actions}
          </div>
        )}
        {!onSearchChange && (filterButton || actions) && (
          <div className="flex items-center justify-end gap-2">
            {filterButton}
            {actions}
          </div>
        )}
        {chips && chips.length > 0 && (
          <div
            className={cn(
              "-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5 scrollbar-none",
              desktopSearchAfterChips && "desktop:order-1 desktop:min-w-0 desktop:flex-1",
            )}
          >
            {chips.map((chip) => {
              const active = (activeChip ?? chips[0]?.key) === chip.key;
              return (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => onChipChange?.(chip.key)}
                  className={cn(
                    "min-h-9 shrink-0 rounded-full px-3 text-xs font-semibold transition",
                    active
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "border border-border bg-card text-muted-foreground",
                  )}
                >
                  {chip.label}
                  {typeof chip.count === "number" && (
                    <span
                      className={cn("ml-1.5 text-[11px]", active ? "opacity-80" : "opacity-70")}
                    >
                      {chip.count}
                    </span>
                  )}
                </button>
              );
            })}
            {chipActions}
          </div>
        )}
      </div>
    </div>
  );
}

export const FilterBar = MobileListToolbar;
export { StatusChip };
