import { useMemo, useState } from "react";
import { Building2, Check, ChevronsUpDown } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { FactoryRecord } from "@/lib/factories";
import { cn } from "@/lib/utils";

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLocaleLowerCase("vi")
    .trim();
}

export function FactoryMultiSelect({
  factories,
  selectedIds,
  onChange,
  disabled = false,
  emptyMeansAll = false,
  label = "Nhà máy",
}: {
  factories: FactoryRecord[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  emptyMeansAll?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allSelected = factories.length > 0 && selectedIds.length === factories.length;
  const filteredFactories = useMemo(() => {
    const keyword = normalizeSearch(query);
    if (!keyword) return factories;
    return factories.filter((factory) =>
      normalizeSearch(`${factory.name} ${factory.code || ""}`).includes(keyword),
    );
  }, [factories, query]);

  const selectionLabel =
    selectedIds.length === 0
      ? emptyMeansAll
        ? "Tất cả nhà máy"
        : "Chọn nhà máy"
      : selectedIds.length === 1
        ? factories.find((factory) => factory.id === selectedIds[0])?.name || "1 nhà máy"
        : selectedIds.length === factories.length
          ? "Tất cả nhà máy"
          : `${selectedIds.length} nhà máy`;

  const toggleFactory = (factoryId: string) => {
    if (selectedSet.has(factoryId)) {
      onChange(selectedIds.filter((id) => id !== factoryId));
    } else {
      onChange([...selectedIds, factoryId]);
    }
  };

  const toggleAll = () => {
    if (emptyMeansAll) {
      onChange([]);
      return;
    }
    onChange(allSelected ? [] : factories.map((factory) => factory.id));
  };

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) setQuery("");
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className="flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-input bg-white px-3 text-left text-sm text-slate-900 shadow-sm outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span
              className={cn(
                "truncate",
                selectedIds.length === 0 && !emptyMeansAll && "text-muted-foreground",
              )}
            >
              {selectionLabel}
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[min(var(--radix-popover-trigger-width),calc(100vw-2rem))] p-0"
        >
          <Command shouldFilter={false}>
            <CommandInput placeholder="Tìm nhà máy..." value={query} onValueChange={setQuery} />
            <CommandList className="max-h-[min(18rem,55dvh)]">
              <CommandEmpty>Không tìm thấy nhà máy.</CommandEmpty>
              {!query && (
                <CommandGroup>
                  <CommandItem value="__all_factories__" onSelect={toggleAll}>
                    <span
                      className={cn(
                        "flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                        (emptyMeansAll ? selectedIds.length === 0 : allSelected)
                          ? "bg-primary text-primary-foreground"
                          : "opacity-50",
                      )}
                    >
                      {(emptyMeansAll ? selectedIds.length === 0 : allSelected) && (
                        <Check className="h-3 w-3" />
                      )}
                    </span>
                    <span className="font-medium">
                      {emptyMeansAll
                        ? "Tất cả nhà máy"
                        : allSelected
                          ? "Bỏ chọn tất cả"
                          : "Chọn tất cả"}
                    </span>
                  </CommandItem>
                </CommandGroup>
              )}
              <CommandGroup heading="Danh sách nhà máy">
                {filteredFactories.map((factory) => (
                  <CommandItem
                    key={factory.id}
                    value={`${factory.name} ${factory.code || ""}`}
                    onSelect={() => toggleFactory(factory.id)}
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                        selectedSet.has(factory.id)
                          ? "bg-primary text-primary-foreground"
                          : "opacity-50",
                      )}
                    >
                      {selectedSet.has(factory.id) && <Check className="h-3 w-3" />}
                    </span>
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    <span className="truncate">{factory.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
