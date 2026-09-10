import { useMemo, useState } from "react";
import { BriefcaseBusiness, Check, ChevronDown, Handshake } from "lucide-react";
import type { UserRecord } from "@/lib/pocketbase";
import type { RecruitmentEntityRecord } from "@/lib/recruitment-entities";
import {
  encodeInternalRecruiter,
  encodePartnerRecruiter,
  filterInternalRecruiters,
  parseRecruiterSelection,
  type RecruiterSelectionValue,
} from "@/lib/recruiters";
import { normalizeUserPickerSearch } from "@/components/workforce/UserPicker";
import { useDebouncedSearch } from "@/hooks/use-debounced-search";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

export function RecruiterPicker({
  label,
  value,
  onChange,
  internalUsers,
  partners,
  placeholder = "Chọn người tuyển",
  allowClear = false,
  triggerClassName,
}: {
  label?: string;
  value: RecruiterSelectionValue;
  onChange: (value: RecruiterSelectionValue) => void;
  internalUsers: UserRecord[];
  partners: RecruitmentEntityRecord[];
  placeholder?: string;
  allowClear?: boolean;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedSearch(query);
  const parsed = parseRecruiterSelection(value);
  const selectedInternalId = parsed?.type === "internal" ? parsed.id : undefined;
  const selectedInternal =
    selectedInternalId !== undefined
      ? internalUsers.find((user) => user.id === selectedInternalId)
      : undefined;
  const availableInternalUsers = useMemo(
    () => filterInternalRecruiters(internalUsers, selectedInternalId),
    [internalUsers, selectedInternalId],
  );
  const activePartners = useMemo(
    () => partners.filter((partner) => partner.status !== "inactive"),
    [partners],
  );
  const selectedPartner =
    parsed?.type === "partner" ? partners.find((partner) => partner.id === parsed.id) : undefined;

  const keyword = normalizeUserPickerSearch(debouncedQuery);
  const filteredInternal = useMemo(() => {
    const filtered = !keyword
      ? availableInternalUsers
      : availableInternalUsers.filter((user) =>
          normalizeUserPickerSearch(
            `${user.full_name || ""} ${user.username || ""} ${user.phone || ""} ${user.uid || ""}`,
          ).includes(keyword),
      );

    if (selectedInternal && !filtered.some((user) => user.id === selectedInternal.id)) {
      return [selectedInternal, ...filtered];
    }

    return filtered;
  }, [availableInternalUsers, keyword, selectedInternal]);
  const filteredPartners = useMemo(() => {
    if (!keyword) return activePartners;
    return activePartners.filter((partner) =>
      normalizeUserPickerSearch(
        `${partner.name} ${partner.address || ""} ${partner.hotline || ""}`,
      ).includes(keyword),
    );
  }, [activePartners, keyword]);

  const selectedName =
    selectedPartner?.name || selectedInternal?.full_name || selectedInternal?.username;
  const selectedType = selectedPartner ? "partner" : selectedInternal ? "internal" : null;

  return (
    <div className="space-y-1">
      {label ? <Label className="text-xs">{label}</Label> : null}
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
            className={cn(
              "h-11 w-full justify-between gap-2 rounded-xl bg-white px-3 text-left font-normal text-slate-900",
              triggerClassName,
            )}
          >
            <span
              className={cn(
                "flex min-w-0 items-center gap-2",
                !selectedName && "text-muted-foreground",
              )}
            >
              {selectedType === "partner" ? (
                <Handshake className="h-4 w-4 shrink-0 text-amber-600" />
              ) : selectedType === "internal" ? (
                <BriefcaseBusiness className="h-4 w-4 shrink-0 text-sky-600" />
              ) : null}
              <span className="truncate">{selectedName || placeholder}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {selectedType ? (
                <Badge
                  variant="outline"
                  className={cn(
                    "px-1.5 py-0 text-[10px]",
                    selectedType === "partner"
                      ? "border-amber-300 bg-amber-50 text-amber-700"
                      : "border-sky-300 bg-sky-50 text-sky-700",
                  )}
                >
                  {selectedType === "partner" ? "Đối tác" : "Nội bộ"}
                </Badge>
              ) : null}
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[min(var(--radix-popover-trigger-width),calc(100vw-2rem))] p-0"
        >
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Tìm nhân sự hoặc đối tác..."
              value={query}
              onValueChange={setQuery}
            />
            <CommandList className="max-h-[min(22rem,60dvh)]">
              <CommandEmpty>Không tìm thấy nhân sự hoặc đối tác phù hợp.</CommandEmpty>
              {allowClear && value ? (
                <CommandGroup>
                  <CommandItem
                    value="__clear__"
                    onSelect={() => {
                      onChange("");
                      setOpen(false);
                    }}
                  >
                    <span className="text-muted-foreground">Bỏ chọn người tuyển</span>
                  </CommandItem>
                </CommandGroup>
              ) : null}
              {filteredInternal.length ? (
                <CommandGroup heading="Nhân sự nội bộ">
                  {filteredInternal.map((user) => {
                    const itemValue = encodeInternalRecruiter(user.id);
                    return (
                      <CommandItem
                        key={itemValue}
                        value={itemValue}
                        onSelect={() => {
                          onChange(itemValue);
                          setOpen(false);
                        }}
                        className="min-h-12 items-center gap-2 py-2"
                      >
                        <Check
                          className={cn(
                            "h-4 w-4",
                            value === itemValue ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <BriefcaseBusiness className="h-4 w-4 shrink-0 text-sky-600" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium">
                              {user.full_name || user.username || "Nhân sự chưa có tên"}
                            </span>
                            <Badge
                              variant="outline"
                              className="border-sky-300 bg-sky-50 px-1.5 py-0 text-[10px] text-sky-700"
                            >
                              Nội bộ
                            </Badge>
                          </div>
                          <div className="truncate text-[11px] text-muted-foreground">
                            {[user.username && `@${user.username}`, user.phone, user.uid]
                              .filter(Boolean)
                              .join(" · ") || "Chưa có thông tin phụ"}
                          </div>
                        </div>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ) : null}
              {filteredPartners.length ? (
                <CommandGroup heading="Đối tác">
                  {filteredPartners.map((partner) => {
                    const itemValue = encodePartnerRecruiter(partner.id);
                    return (
                      <CommandItem
                        key={itemValue}
                        value={itemValue}
                        onSelect={() => {
                          onChange(itemValue);
                          setOpen(false);
                        }}
                        className="min-h-12 items-center gap-2 py-2"
                      >
                        <Check
                          className={cn(
                            "h-4 w-4",
                            value === itemValue ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <Handshake className="h-4 w-4 shrink-0 text-amber-600" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium">{partner.name}</span>
                            <Badge
                              variant="outline"
                              className="border-amber-300 bg-amber-50 px-1.5 py-0 text-[10px] text-amber-700"
                            >
                              Đối tác
                            </Badge>
                          </div>
                          <div className="truncate text-[11px] text-muted-foreground">
                            {partner.hotline || partner.address || "Chưa có thông tin phụ"}
                          </div>
                        </div>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
