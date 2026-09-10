import * as XLSX from "xlsx";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { renderSVG } from "uqr";
import { findBankByCode, getQrBankLabel, type VnBank } from "@/lib/vn-banks";

export const QR_BULK_LIMIT = 200;
export const QR_DESCRIPTION_MAX_BYTES = 95;
export const QR_EXCEL_HEADERS = [
  "Mã ngân hàng",
  "Số tài khoản",
  "Chủ tài khoản",
  "Số tiền",
  "Nội dung chuyển khoản",
] as const;

export type QrTransferData = {
  bank: VnBank;
  accountNumber: string;
  accountName: string;
  amount?: number;
  description: string;
};

export type QrImportError = { row: number; message: string };
export type QrImportResult = {
  valid: Array<QrTransferData & { row: number }>;
  errors: QrImportError[];
};

export function removeVietnameseTone(value: string) {
  return value
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function normalizeAccountNumber(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, "")
    .trim();
}

export function normalizeAccountName(value: unknown) {
  return removeVietnameseTone(
    String(value ?? "")
      .replace(/\s+/g, " ")
      .trim(),
  ).toUpperCase();
}

export function normalizeTransferDescription(value: unknown) {
  return removeVietnameseTone(
    String(value ?? "")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

export function parseQrAmount(value: unknown): { amount?: number; error?: string } {
  const raw = String(value ?? "").trim();
  if (!raw) return {};
  const digits = raw.replace(/[.,\s]/g, "");
  if (!/^\d+$/.test(digits)) return { error: "Số tiền không hợp lệ" };
  const amount = Number(digits);
  if (!Number.isSafeInteger(amount) || amount <= 0)
    return { error: "Số tiền phải là số nguyên dương" };
  return { amount };
}

export function buildQrTransferData(input: {
  bankCode: unknown;
  accountNumber: unknown;
  accountName?: unknown;
  amount?: unknown;
  description?: unknown;
}): { data?: QrTransferData; errors: string[] } {
  const errors: string[] = [];
  const bankCode = String(input.bankCode ?? "").trim();
  const bank = findBankByCode(bankCode);
  const accountNumber = normalizeAccountNumber(input.accountNumber);
  const parsedAmount = parseQrAmount(input.amount);
  const description = normalizeTransferDescription(input.description);
  if (!bank)
    errors.push(bankCode ? `Mã ngân hàng “${bankCode}” không tồn tại` : "Thiếu mã ngân hàng");
  if (!accountNumber) errors.push("Thiếu số tài khoản");
  if (parsedAmount.error) errors.push(parsedAmount.error);
  if (new TextEncoder().encode(description).length > QR_DESCRIPTION_MAX_BYTES) {
    errors.push(
      `Nội dung chuyển khoản tối đa ${QR_DESCRIPTION_MAX_BYTES} byte theo cấu trúc VietQR`,
    );
  }
  if (errors.length || !bank) return { errors };
  return {
    errors,
    data: {
      bank,
      accountNumber,
      accountName: normalizeAccountName(input.accountName),
      amount: parsedAmount.amount,
      description,
    },
  };
}

function cell(row: Record<string, unknown>, aliases: string[]) {
  const key = Object.keys(row).find((candidate) =>
    aliases.includes(candidate.trim().toLowerCase()),
  );
  return key ? row[key] : "";
}

export async function parseQrExcel(file: File): Promise<QrImportResult> {
  const workbook = XLSX.read(await file.arrayBuffer(), {
    type: "array",
    cellText: true,
    raw: false,
  });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("File Excel không có sheet dữ liệu.");
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
  const valid: QrImportResult["valid"] = [];
  const errors: QrImportError[] = [];
  if (rows.length > QR_BULK_LIMIT)
    errors.push({
      row: 0,
      message: `File có ${rows.length} dòng, chỉ xử lý tối đa ${QR_BULK_LIMIT} dòng đầu tiên.`,
    });
  rows.slice(0, QR_BULK_LIMIT).forEach((row, index) => {
    const excelRow = index + 2;
    const result = buildQrTransferData({
      bankCode: cell(row, ["mã ngân hàng", "ma ngan hang", "bank_code"]),
      accountNumber: cell(row, ["số tài khoản", "so tai khoan", "account_number"]),
      accountName: cell(row, ["chủ tài khoản", "chu tai khoan", "account_name"]),
      amount: cell(row, ["số tiền", "so tien", "amount"]),
      description: cell(row, ["nội dung chuyển khoản", "noi dung chuyen khoan", "description"]),
    });
    if (result.data) valid.push({ ...result.data, row: excelRow });
    else errors.push({ row: excelRow, message: result.errors.join("; ") });
  });
  return { valid, errors };
}

export function downloadQrExcelTemplate() {
  const sheet = XLSX.utils.aoa_to_sheet([
    [...QR_EXCEL_HEADERS],
    ["ICB", "0012345678", "Nguyễn Văn Ánh", 1500000, "Thanh toán tháng 8"],
    ["MB", "0987654321", "Trần Thị Bình", "", "Chuyển tiền"],
  ]);
  sheet["!cols"] = [{ wch: 18 }, { wch: 20 }, { wch: 26 }, { wch: 16 }, { wch: 32 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Tao QR");
  XLSX.writeFile(workbook, "Mau_tao_ma_QR_ngan_hang.xlsx");
}

function vietQrField(id: string, value: string) {
  const length = new TextEncoder().encode(value).length;
  if (length > 99) throw new Error(`Trường VietQR ${id} vượt quá độ dài cho phép.`);
  return `${id}${String(length).padStart(2, "0")}${value}`;
}

function crc16Ccitt(value: string) {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(value)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export function buildVietQrPayload(data: QrTransferData) {
  const accountInfo = vietQrField("00", data.bank.bin) + vietQrField("01", data.accountNumber);
  const merchantInfo =
    vietQrField("00", "A000000727") +
    vietQrField("01", accountInfo) +
    vietQrField("02", "QRIBFTTA");
  let payload =
    vietQrField("00", "01") +
    vietQrField("01", data.amount ? "12" : "11") +
    vietQrField("38", merchantInfo);
  payload += vietQrField("53", "704");
  if (data.amount) payload += vietQrField("54", String(data.amount));
  payload += vietQrField("58", "VN");
  if (data.description) payload += vietQrField("62", vietQrField("08", data.description));
  payload += "6304";
  return payload + crc16Ccitt(payload);
}

export function getQrImageUrl(data: QrTransferData) {
  const svg = renderSVG(buildVietQrPayload(data), { ecc: "M", border: 4, pixelSize: 8 });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

async function loadImage(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Không tải được ảnh QR từ VietQR.");
  const objectUrl = URL.createObjectURL(await response.blob());
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Không đọc được ảnh QR."));
      image.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
) {
  const words = text.split(" ");
  let line = "";
  let currentY = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, currentY);
      line = word;
      currentY += lineHeight;
    } else line = test;
  }
  if (line) ctx.fillText(line, x, currentY);
  return currentY;
}

export async function renderQrCard(data: QrTransferData): Promise<Blob> {
  const qrUrl = getQrImageUrl(data);
  if (!qrUrl) throw new Error("Không thể tạo URL mã QR.");
  const qr = await loadImage(qrUrl);
  const canvas = document.createElement("canvas");
  canvas.width = 900;
  canvas.height = 1240;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Thiết bị không hỗ trợ tạo ảnh.");
  ctx.fillStyle = "#f4f7fb";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.roundRect(45, 40, 810, 1160, 36);
  ctx.fill();
  ctx.fillStyle = "#0f766e";
  ctx.font = "700 42px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("MA QR CHUYEN KHOAN", 450, 105);
  ctx.drawImage(qr, 170, 135, 560, 560);
  ctx.textAlign = "left";
  ctx.fillStyle = "#64748b";
  ctx.font = "600 22px sans-serif";
  ctx.fillText("NGAN HANG", 100, 750);
  ctx.fillStyle = "#0f172a";
  ctx.font = "700 27px sans-serif";
  let y = drawWrappedText(ctx, getQrBankLabel(data.bank), 100, 785, 700, 34) + 60;
  const details: Array<[string, string]> = [
    ["SỐ TÀI KHOẢN", data.accountNumber],
    ["CHỦ TÀI KHOẢN", data.accountName || "Không cố định"],
    ["SỐ TIỀN", data.amount ? `${data.amount.toLocaleString("vi-VN")} đ` : "Không cố định"],
    ["NỘI DUNG", data.description || "Không cố định"],
  ];
  for (const [label, value] of details) {
    ctx.fillStyle = "#64748b";
    ctx.font = "600 21px sans-serif";
    ctx.fillText(label, 100, y);
    ctx.fillStyle = "#0f172a";
    ctx.font = "700 27px sans-serif";
    y = drawWrappedText(ctx, value, 100, y + 35, 700, 34) + 58;
  }
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Không xuất được ảnh PNG."))),
      "image/png",
    ),
  );
}

export function qrPngFilename(data: QrTransferData, prefix = "QR") {
  const safeAccount = data.accountNumber.replace(/[^a-zA-Z0-9_-]/g, "");
  return `${prefix}_${data.bank.code}_${safeAccount || "tai-khoan"}.png`;
}

export async function downloadQrCard(data: QrTransferData) {
  saveAs(await renderQrCard(data), qrPngFilename(data));
}

export async function createQrZip(
  rows: Array<QrTransferData & { row: number }>,
  onProgress?: (done: number, total: number) => void,
) {
  const zip = new JSZip();
  const failures: QrImportError[] = [];
  const names = new Map<string, number>();
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    try {
      const base = qrPngFilename(row, String(index + 1).padStart(3, "0")).replace(/\.png$/, "");
      const count = (names.get(base) || 0) + 1;
      names.set(base, count);
      const filename = `${base}${count > 1 ? `_${count}` : ""}.png`;
      zip.file(filename, await renderQrCard(row));
    } catch (error) {
      failures.push({
        row: row.row,
        message: error instanceof Error ? error.message : "Không tạo được ảnh QR",
      });
    }
    onProgress?.(index + 1, rows.length);
  }
  if (rows.length === failures.length)
    throw new Error("Không tạo được ảnh QR nào. Vui lòng kiểm tra kết nối mạng.");
  saveAs(
    await zip.generateAsync({ type: "blob" }),
    `Ma_QR_ngan_hang_${new Date().toISOString().slice(0, 10)}.zip`,
  );
  return failures;
}
