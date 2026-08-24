import { useMemo } from "react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { getQrBankLabel, VN_BANKS } from "@/lib/vn-banks";

export function QrBankPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const options = useMemo(
    () =>
      VN_BANKS.map((bank) => ({
        value: bank.code,
        label: getQrBankLabel(bank),
        description: `BIN ${bank.bin}`,
        keywords: `${bank.code} ${bank.name} ${bank.bin}`,
      })),
    [],
  );

  return (
    <SearchableSelect
      value={value}
      onValueChange={onChange}
      options={options}
      placeholder="Chọn ngân hàng"
      searchPlaceholder="Tìm theo mã, tên hoặc BIN..."
      emptyText="Không tìm thấy ngân hàng phù hợp."
      disabled={disabled}
      triggerClassName="h-12 rounded-xl"
      listClassName="max-h-[min(28rem,65dvh)]"
    />
  );
}
