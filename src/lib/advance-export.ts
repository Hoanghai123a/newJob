import { formatDateOnly } from "./excel.ts";

export const ADVANCE_EXPORT_COLUMNS = [
  "Nhà máy",
  "Mã nhân viên",
  "Họ tên",
  "Số tiền",
  "Ngày vào làm",
  "Hình thức nhận tiền",
  "Ngân hàng",
  "Số tài khoản",
  "Tên chủ tài khoản",
  "Số điện thoại",
  "Người báo ứng",
  "Số tiền ban đầu",
  "Lý do",
  "Trạng thái",
  "Đã giải ngân",
  "Thu hồi",
  "Ghi chú admin",
  "Ghi chú người tuyển",
  "Ghi chú thu hồi",
  "Ngày gửi",
  "Ngày duyệt",
  "Ngày giải ngân",
  "Ngày thu hồi",
] as const;

export type AdvanceExportRow = {
  employee_code: string;
  full_name: string;
  company: string;
  phone: string;
  join_date?: string;
  bank_name?: string;
  bank_account_number?: string;
  bank_account_name?: string;
  payout_method?: string;
  amount: number;
  original_amount?: number;
  reason: string;
  status?: string;
  recovery_status?: string;
  admin_note?: string;
  recruiter_note?: string;
  recovery_note?: string;
  resolved_at?: string;
  recovered_at?: string;
  disbursed?: boolean;
  disbursed_at?: string;
  created: string;
  requester_name: string;
};

function payoutMethodLabel(value?: string) {
  return value === "cash" ? "Tiền mặt" : "Chuyển khoản";
}

function statusLabel(value?: string) {
  switch (value) {
    case "recruiter_approved":
      return "Chờ admin duyệt";
    case "accepted":
      return "Đã tiếp nhận";
    case "rejected":
      return "Đã từ chối";
    default:
      return "Chờ người tuyển duyệt";
  }
}

function recoveryLabel(value?: string) {
  switch (value) {
    case "recovered":
      return "Đã thu hồi";
    case "unrecoverable":
      return "Không thu hồi";
    default:
      return "Chờ thu hồi";
  }
}

export function buildAdvanceExportRows(rows: AdvanceExportRow[]) {
  return rows.map((row) => ({
    "Nhà máy": row.company,
    "Mã nhân viên": row.employee_code,
    "Họ tên": row.full_name,
    "Số tiền": row.amount,
    "Ngày vào làm": formatDateOnly(row.join_date),
    "Hình thức nhận tiền": payoutMethodLabel(row.payout_method),
    "Ngân hàng": row.bank_name || "",
    "Số tài khoản": row.bank_account_number || "",
    "Tên chủ tài khoản": row.bank_account_name || "",
    "Số điện thoại": row.phone,
    "Người báo ứng": row.requester_name,
    "Số tiền ban đầu":
      row.original_amount && row.original_amount !== row.amount ? row.original_amount : "",
    "Lý do": row.reason,
    "Trạng thái": statusLabel(row.status),
    "Đã giải ngân": row.status === "accepted" ? (row.disbursed ? "Có" : "Không") : "",
    "Thu hồi": recoveryLabel(row.recovery_status),
    "Ghi chú admin": row.admin_note || "",
    "Ghi chú người tuyển": row.recruiter_note || "",
    "Ghi chú thu hồi": row.recovery_note || "",
    "Ngày gửi": formatDateOnly(row.created),
    "Ngày duyệt": formatDateOnly(row.resolved_at),
    "Ngày giải ngân": formatDateOnly(row.disbursed_at),
    "Ngày thu hồi": formatDateOnly(row.recovered_at),
  }));
}

export function buildAdvanceExportFilename(tenantCode: string, now = new Date()) {
  const tenant =
    tenantCode
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_.-]/g, "_") || "TENANT";
  const pad = (value: number) => String(value).padStart(2, "0");
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `ung_luong_${tenant}_${timestamp}.xlsx`;
}
