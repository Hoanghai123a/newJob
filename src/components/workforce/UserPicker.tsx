import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useDebouncedSearch } from "@/hooks/use-debounced-search";
import type { FactoryRecord } from "@/lib/factories";
import type { MainHouseRecord } from "@/lib/main-houses";
import type { UserRecord } from "@/lib/pocketbase";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { accountLoginName } from "@/lib/login-identity";

const COMBINING_DIACRITICS = /[̀-ͯ]/g;

export function normalizeUserPickerSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(COMBINING_DIACRITICS, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/\s+/g, " ")
    .trim();
}

export function UserPicker({
  label,
  users,
  value,
  onChange,
  placeholder,
  allowClear,
}: {
  label?: string;
  users: UserRecord[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedSearch(query);
  const selected = users.find((u) => u.id === value);

  const filteredUsers = useMemo(() => {
    const keyword = normalizeUserPickerSearch(debouncedQuery);
    if (!keyword) return users;
    return users.filter((u) =>
      normalizeUserPickerSearch(
        `${u.full_name || ""} ${accountLoginName(u)} ${u.username || ""} ${u.phone || ""} ${u.uid || ""} ${u.cccd || ""}`,
      ).includes(keyword),
    );
  }, [debouncedQuery, users]);

  return (
    <div className="space-y-1">
      {label && <Label className="text-xs">{label}</Label>}
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery("");
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-white px-3 text-left text-sm text-slate-900"
          >
            <span className={cn("truncate", !selected && "text-muted-foreground")}>
              {selected
                ? `${selected.full_name || accountLoginName(selected)} · ${selected.phone || "—"}`
                : placeholder || "Chọn..."}
            </span>
            <ChevronRight className="h-4 w-4 rotate-90 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder="Tìm kiếm..." value={query} onValueChange={setQuery} />
            <CommandList>
              <CommandEmpty>Không tìm thấy.</CommandEmpty>
              <CommandGroup>
                {allowClear && value && (
                  <CommandItem
                    value="__clear__"
                    onSelect={() => {
                      onChange("");
                      setOpen(false);
                    }}
                  >
                    <span className="text-muted-foreground">Bỏ chọn</span>
                  </CommandItem>
                )}
                {filteredUsers.map((u) => (
                  <CommandItem
                    key={u.id}
                    value={`${u.full_name || ""} ${accountLoginName(u)} ${u.username || ""} ${u.phone || ""} ${u.uid || ""} ${u.cccd || ""}`}
                    onSelect={() => {
                      onChange(u.id);
                      setOpen(false);
                    }}
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium">
                        {u.full_name || accountLoginName(u) || "—"}
                      </span>
                      <span className="truncate text-[11px] text-muted-foreground">
                        {[accountLoginName(u), u.phone, u.uid, u.cccd].filter(Boolean).join(" · ")}
                      </span>
                    </div>
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

export function FactoryPicker({
  factories,
  value,
  onChange,
  placeholder = "Chọn nhà máy...",
  triggerClassName,
  allowClear = false,
}: {
  factories: FactoryRecord[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  triggerClassName?: string;
  allowClear?: boolean;
}) {
  const options = useMemo(
    () =>
      factories.map((factory) => ({
        value: factory.id,
        label: factory.name,
        description: [factory.code, factory.address].filter(Boolean).join(" · "),
        keywords: `${factory.code || ""} ${factory.address || ""} ${factory.hotline || ""}`,
      })),
    [factories],
  );

  return (
    <SearchableSelect
      value={value}
      onValueChange={onChange}
      options={options}
      placeholder={placeholder}
      searchPlaceholder="Tìm tên hoặc mã nhà máy..."
      emptyText="Không tìm thấy nhà máy phù hợp."
      allowClear={allowClear}
      triggerClassName={triggerClassName}
    />
  );
}

export function MainHousePicker({
  mainHouses,
  value,
  onChange,
  placeholder = "Chọn nhà chính...",
  triggerClassName,
  allowClear = false,
}: {
  mainHouses: MainHouseRecord[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  triggerClassName?: string;
  allowClear?: boolean;
}) {
  const options = useMemo(
    () =>
      mainHouses.map((house) => ({
        value: house.id,
        label: house.name,
        description: house.note || house.address || house.hotline || "",
        keywords: `${house.address || ""} ${house.hotline || ""} ${house.legacy_username || ""}`,
      })),
    [mainHouses],
  );

  return (
    <SearchableSelect
      value={value}
      onValueChange={onChange}
      options={options}
      placeholder={placeholder}
      searchPlaceholder="Tìm nhà chính..."
      emptyText="Không tìm thấy nhà chính phù hợp."
      allowClear={allowClear}
      triggerClassName={triggerClassName}
    />
  );
}
