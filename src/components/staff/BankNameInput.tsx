import { useMemo } from "react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { resolveBankName, VN_BANKS } from "@/lib/vn-banks";

export function BankPicker({
  value,
  onChange,
  disabled = false,
  triggerClassName,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  triggerClassName?: string;
}) {
  const options = useMemo(
    () =>
      VN_BANKS.map((bank) => ({
        value: bank.name,
        label: bank.name,
        description: `${bank.code} · BIN ${bank.bin}`,
        keywords: `${bank.code} ${bank.bin}`,
      })),
    [],
  );

  return (
    <SearchableSelect
      value={value}
      onValueChange={(nextValue) => onChange(resolveBankName(nextValue))}
      options={options}
      placeholder="Chọn ngân hàng"
      searchPlaceholder="Tìm tên, mã hoặc BIN ngân hàng..."
      emptyText="Không tìm thấy ngân hàng phù hợp."
      allowCustomValue
      customValueLabel={(customValue) => `Dùng tên ngân hàng “${customValue}”`}
      disabled={disabled}
      triggerClassName={triggerClassName}
    />
  );
}

// Giữ tương thích cho các màn hình đang dùng tên component cũ.
export const BankNameInput = BankPicker;
