import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const COMBINING_DIACRITICS = /[\u0300-\u036f]/g;

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(COMBINING_DIACRITICS, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/\s+/g, " ")
    .trim();
}

export type SearchableSelectOption = {
  value: string;
  label: string;
  description?: string;
  keywords?: string;
};

export function SearchableSelect({
  value,
  onValueChange,
  options,
  placeholder = "Chọn...",
  searchPlaceholder = "Tìm kiếm...",
  emptyText = "Không tìm thấy kết quả phù hợp.",
  disabled = false,
  allowClear = false,
  clearLabel = "Bỏ chọn",
  allowCustomValue = false,
  customValueLabel = (customValue) => `Dùng “${customValue}”`,
  triggerClassName,
  contentClassName,
  listClassName,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  allowClear?: boolean;
  clearLabel?: string;
  allowCustomValue?: boolean;
  customValueLabel?: (value: string) => string;
  triggerClassName?: string;
  contentClassName?: string;
  listClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((option) => option.value === value);
  const normalizedQuery = normalizeSearchText(query);

  const filteredOptions = useMemo(() => {
    if (!normalizedQuery) return options;
    return options.filter((option) =>
      normalizeSearchText(
        `${option.label} ${option.description || ""} ${option.keywords || ""}`,
      ).includes(normalizedQuery),
    );
  }, [normalizedQuery, options]);

  const trimmedQuery = query.trim();
  const hasExactCustomMatch = options.some(
    (option) =>
      normalizeSearchText(option.value) === normalizeSearchText(trimmedQuery) ||
      normalizeSearchText(option.label) === normalizeSearchText(trimmedQuery),
  );
  const showCustomValue = allowCustomValue && Boolean(trimmedQuery) && !hasExactCustomMatch;
  const showUnknownCurrentValue = Boolean(value) && !selected && !normalizedQuery;

  const selectValue = (nextValue: string) => {
    onValueChange(nextValue);
    setOpen(false);
    setQuery("");
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "h-10 w-full justify-between gap-2 bg-white px-3 text-left font-normal text-slate-900",
            triggerClassName,
          )}
        >
          <span className={cn("min-w-0 flex-1 truncate", !value && "text-muted-foreground")}>
            {selected?.label || value || placeholder}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn(
          "w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] p-0",
          contentClassName,
        )}
      >
        <Command shouldFilter={false}>
          <CommandInput placeholder={searchPlaceholder} value={query} onValueChange={setQuery} />
          <CommandList className={cn("max-h-[min(22rem,60dvh)]", listClassName)}>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {allowClear && value ? (
                <CommandItem value="__clear__" onSelect={() => selectValue("")}>
                  <Check className="h-4 w-4 opacity-0" />
                  <span className="text-muted-foreground">{clearLabel}</span>
                </CommandItem>
              ) : null}
              {showUnknownCurrentValue ? (
                <CommandItem value={`__current__${value}`} onSelect={() => selectValue(value)}>
                  <Check className="h-4 w-4 opacity-100" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{value}</div>
                    <div className="text-[11px] text-muted-foreground">Giá trị hiện tại</div>
                  </div>
                </CommandItem>
              ) : null}
              {showCustomValue ? (
                <CommandItem
                  value={`__custom__${trimmedQuery}`}
                  onSelect={() => selectValue(trimmedQuery)}
                >
                  <Check className="h-4 w-4 opacity-0" />
                  <span className="truncate">{customValueLabel(trimmedQuery)}</span>
                </CommandItem>
              ) : null}
              {filteredOptions.map((option) => (
                <CommandItem
                  key={option.value}
                  value={`${option.label} ${option.description || ""} ${option.keywords || ""}`}
                  onSelect={() => selectValue(option.value)}
                  className="min-h-11 items-center gap-2 py-2"
                >
                  <Check
                    className={cn(
                      "h-4 w-4 shrink-0",
                      option.value === value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{option.label}</div>
                    {option.description ? (
                      <div className="truncate text-[11px] text-muted-foreground">
                        {option.description}
                      </div>
                    ) : null}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
