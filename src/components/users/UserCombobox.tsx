import { useMemo, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { userDisplayName } from "@/lib/delegations";
import type { UserRecord } from "@/lib/pocketbase";
import { cn } from "@/lib/utils";
import { useDebouncedSearch } from "@/hooks/use-debounced-search";
import { normalizeUserPickerSearch } from "@/components/workforce/UserPicker";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { accountLoginName } from "@/lib/login-identity";

export function UserCombobox({
  value,
  onChange,
  users,
  currentUserId,
  placeholder = "Chọn user",
  searchPlaceholder = "Tìm tên, username, mã NV, SĐT...",
}: {
  value: string;
  onChange: (value: string) => void;
  users: UserRecord[];
  currentUserId?: string;
  placeholder?: string;
  searchPlaceholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedSearch(query);
  const selected = useMemo(() => users.find((item) => item.id === value), [users, value]);

  const filteredUsers = useMemo(() => {
    const keyword = normalizeUserPickerSearch(debouncedQuery);
    if (!keyword) return users;
    return users.filter((item) =>
      normalizeUserPickerSearch(
        `${item.full_name || ""} ${accountLoginName(item)} ${item.username || ""} ${item.phone || ""}`,
      ).includes(keyword),
    );
  }, [debouncedQuery, users]);

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
          className="h-10 w-full justify-between gap-2 rounded-xl bg-white px-3 text-left font-normal text-slate-900"
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected
              ? selected.id === currentUserId
                ? "Bạn"
                : userDisplayName(selected)
              : placeholder}
          </span>
          <ChevronDown className="h-4 w-4 flex-none text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(calc(100vw-3rem),24rem)] p-0">
        <Command shouldFilter={false}>
          <CommandInput placeholder={searchPlaceholder} value={query} onValueChange={setQuery} />
          <CommandList className="max-h-72">
            <CommandEmpty>Không tìm thấy user.</CommandEmpty>
            {filteredUsers.map((item) => (
              <CommandItem
                key={item.id}
                value={`${item.full_name || ""} ${accountLoginName(item)} ${item.username || ""} ${item.phone || ""}`}
                onSelect={() => {
                  onChange(item.id);
                  setOpen(false);
                }}
                className="items-center gap-2 py-2"
              >
                <Check className={cn("h-4 w-4", item.id === value ? "opacity-100" : "opacity-0")} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {item.id === currentUserId ? "Bạn" : userDisplayName(item)}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    @{accountLoginName(item) || "?"} · {item.phone || "?"}
                  </div>
                </div>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
