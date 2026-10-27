export function parseQrAmount(value: unknown): { amount?: number; error?: string } {
  const raw = String(value ?? "")
    .trim()
    .replace(/\s+/g, "");
  if (!raw) return {};
  if (!/^\d+(?:[.,]\d+)*$/.test(raw)) return { error: "Số tiền không hợp lệ" };

  const hasComma = raw.includes(",");
  const hasDot = raw.includes(".");
  let decimalSeparator: string | undefined;
  let groupSeparator: string | undefined;

  if (hasComma && hasDot) {
    decimalSeparator = raw.lastIndexOf(",") > raw.lastIndexOf(".") ? "," : ".";
    groupSeparator = decimalSeparator === "," ? "." : ",";
  } else if (hasComma || hasDot) {
    const separator = hasComma ? "," : ".";
    const parts = raw.split(separator);
    // shortcut: one separator plus three digits means grouping; add locale choice if decimals become ambiguous.
    const grouped =
      /^[1-9]\d{0,2}$/.test(parts[0]) && parts.slice(1).every((part) => part.length === 3);
    if (grouped) groupSeparator = separator;
    else {
      decimalSeparator = separator;
      groupSeparator = separator;
    }
  }

  const decimalIndex = decimalSeparator ? raw.lastIndexOf(decimalSeparator) : -1;
  const integerPart = decimalIndex < 0 ? raw : raw.slice(0, decimalIndex);
  const groups = groupSeparator ? integerPart.split(groupSeparator) : [integerPart];
  if (
    !groups.every((group) => /^\d+$/.test(group)) ||
    groups.slice(1).some((group) => group.length !== 3)
  ) {
    return { error: "Số tiền không hợp lệ" };
  }
  const amount = Number(groups.join(""));
  if (!Number.isSafeInteger(amount) || amount <= 0)
    return { error: "Số tiền phải là số nguyên dương" };
  return { amount };
}
