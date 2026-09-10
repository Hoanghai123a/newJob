export function parseMoneyInput(value: string | number | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  return digits ? Number(digits) : 0;
}

export function formatMoneyInput(value: string | number | null | undefined) {
  const parsed = parseMoneyInput(value);
  return parsed ? parsed.toLocaleString("vi-VN") : "";
}

const DIGIT_WORDS = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];
const MONEY_GROUP_SCALES = ["", "nghìn", "triệu", "tỷ", "nghìn tỷ", "triệu tỷ"];

export const MAX_MONEY_TO_TEXT_DIGITS = 18;

export function normalizeMoneyDigits(value: string | number | null | undefined) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.replace(/^0+(?=\d)/, "");
}

export function formatMoneyDigits(value: string | number | null | undefined) {
  const digits = normalizeMoneyDigits(value);
  return digits ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".") : "";
}

function readThreeDigitGroup(group: string, readFullGroup: boolean) {
  const padded = group.padStart(3, "0");
  const hundreds = Number(padded[0]);
  const tens = Number(padded[1]);
  const units = Number(padded[2]);
  const words: string[] = [];

  if (hundreds > 0 || readFullGroup) words.push(`${DIGIT_WORDS[hundreds]} trăm`);

  if (tens > 1) words.push(`${DIGIT_WORDS[tens]} mươi`);
  else if (tens === 1) words.push("mười");
  else if (units > 0 && (hundreds > 0 || readFullGroup)) words.push("lẻ");

  if (units > 0) {
    if (units === 1 && tens > 1) words.push("mốt");
    else if (units === 4 && tens > 1) words.push("tư");
    else if (units === 5 && tens > 0) words.push("lăm");
    else words.push(DIGIT_WORDS[units]);
  }

  return words.join(" ");
}

export function moneyToVietnameseText(value: string | number | null | undefined) {
  const digits = normalizeMoneyDigits(value);
  if (!digits || /^0+$/.test(digits)) return "Không đồng";
  if (digits.length > MAX_MONEY_TO_TEXT_DIGITS) {
    throw new RangeError(`Số tiền không được vượt quá ${MAX_MONEY_TO_TEXT_DIGITS} chữ số.`);
  }

  const padded = digits.padStart(Math.ceil(digits.length / 3) * 3, "0");
  const groups = padded.match(/\d{3}/g) ?? [];
  const words: string[] = [];

  groups.forEach((group, index) => {
    const groupValue = Number(group);
    if (groupValue === 0) return;

    const hasPreviousValue = groups.slice(0, index).some((item) => Number(item) > 0);
    const groupWords = readThreeDigitGroup(group, hasPreviousValue && groupValue < 100);
    const scale = MONEY_GROUP_SCALES[groups.length - index - 1];
    words.push(groupWords, scale);
  });

  const result = words.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  return `${result.charAt(0).toLocaleUpperCase("vi-VN")}${result.slice(1)} đồng`;
}
