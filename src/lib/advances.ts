import { pb } from "@/lib/pocketbase";
import { escapePb } from "@/lib/delegations";
import type { UserRecord } from "@/lib/pocketbase";

export type AdvanceStatus = "pending" | "recruiter_approved" | "accepted" | "rejected";
export type RecoveryStatus = "none" | "recovered" | "unrecoverable";
export type AdvancePayoutMethod = "bank_transfer" | "cash";
export type AdminTab =
  | "pending"
  | "recruiter_approved"
  | "accepted"
  | "recovered"
  | "unrecoverable"
  | "rejected"
  | "all";

export type AdminAdvanceSegment = "workers" | "staff";

export type AdvanceRecord = {
  id: string;
  tenant_company: string;
  worker?: string;
  requested_by?: string;
  recruiter_id?: string;
  target_admins?: string[];
  expand?: {
    requested_by?: UserRecord;
  };
  employee_code: string;
  full_name: string;
  company: string;
  phone: string;
  join_date?: string;
  bank_name?: string;
  bank_account_number?: string;
  bank_account_name?: string;
  payout_method?: AdvancePayoutMethod;
  amount: number;
  original_amount?: number;
  reason: string;
  status?: AdvanceStatus;
  recovery_status?: RecoveryStatus;
  admin_note?: string;
  recruiter_note?: string;
  recovery_note?: string;
  resolved_at?: string;
  recovered_at?: string;
  disbursed?: boolean;
  disbursed_at?: string;
  created: string;
};

export const ADVANCE_TAB_FILTERS = {
  pending: 'status="pending"',
  recruiter_approved: 'status="recruiter_approved"',
  accepted: 'status="accepted" && (recovery_status="" || recovery_status="none")',
  recovered: 'status="accepted" && recovery_status="recovered"',
  unrecoverable: 'status="accepted" && recovery_status="unrecoverable"',
  rejected: 'status="rejected"',
  all: "",
} satisfies Record<AdminTab, string>;

export const LEGACY_STAFF_REQUESTED_PENDING_FILTER =
  '(status="pending" && (requested_by.role="staff" || requested_by.role="admin"))';

export const STATUS_META: Record<
  AdvanceStatus,
  { label: string; tone: "warning" | "success" | "danger" | "primary" }
> = {
  pending: { label: "Chờ người tuyển duyệt", tone: "warning" },
  recruiter_approved: { label: "Chờ admin duyệt", tone: "primary" },
  accepted: { label: "Đã tiếp nhận", tone: "success" },
  rejected: { label: "Đã từ chối", tone: "danger" },
};

export const PAYOUT_METHOD_META: Record<
  AdvancePayoutMethod,
  { label: string; description: string }
> = {
  bank_transfer: {
    label: "Chuyển khoản",
    description: "Nhận qua tài khoản ngân hàng",
  },
  cash: {
    label: "Tiền mặt",
    description: "Nhận tiền trực tiếp",
  },
};

export function normalizeAdvancePayoutMethod(value?: string | null): AdvancePayoutMethod {
  return value === "cash" ? "cash" : "bank_transfer";
}

export const RECOVERY_META: Record<
  RecoveryStatus,
  { label: string; tone: "neutral" | "success" | "danger" }
> = {
  none: { label: "Chờ thu hồi", tone: "neutral" },
  recovered: { label: "Đã thu hồi", tone: "success" },
  unrecoverable: { label: "Không thu hồi", tone: "danger" },
};

export function joinPbFilters(parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" && ");
}

export function buildAdminAdvanceSegmentFilter(segment: AdminAdvanceSegment) {
  return segment === "workers" ? "" : 'requested_by.role="staff"';
}

export function containsAny(fields: string[], keyword: string) {
  const q = escapePb(keyword.trim());
  if (!q) return "";
  return `(${fields.map((field) => `${field}~"${q}"`).join(" || ")})`;
}

export function buildAdvanceFilter(input: {
  isAdmin: boolean;
  isStaff: boolean;
  userId?: string;
  tab?: AdminTab;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  factoryName?: string;
  staffSelfOnly?: boolean;
  disbursed?: "all" | "yes" | "no";
}) {
  if (!input.isAdmin && !input.userId) return 'id=""';

  const searchFilter = containsAny(
    [
      "full_name",
      "employee_code",
      "company",
      "phone",
      "bank_name",
      "bank_account_number",
      "bank_account_name",
      "reason",
      "admin_note",
      "recovery_note",
    ],
    input.search || "",
  );

  let roleFilter = "";
  if (input.staffSelfOnly && input.userId) {
    const id = escapePb(input.userId);
    roleFilter = `(requested_by="${id}" && recruiter_id="" && worker="")`;
  } else if (!input.isAdmin && !input.isStaff && input.userId) {
    roleFilter = `worker="${escapePb(input.userId)}"`;
  } else if (input.isStaff && !input.isAdmin && input.userId) {
    const currentUserId = escapePb(input.userId);
    roleFilter = `(recruiter_id="${currentUserId}" || requested_by="${currentUserId}")`;
  }

  let tabFilter = "";
  if (input.tab) {
    if (input.isAdmin && input.tab === "pending") {
      tabFilter = `(status="recruiter_approved" || ${LEGACY_STAFF_REQUESTED_PENDING_FILTER})`;
    } else {
      tabFilter = ADVANCE_TAB_FILTERS[input.tab];
    }
  }

  const disbursedFilter =
    input.disbursed === "yes"
      ? "disbursed=true"
      : input.disbursed === "no"
        ? "disbursed!=true"
        : "";

  return joinPbFilters([
    roleFilter,
    tabFilter,
    input.factoryName ? `company="${escapePb(input.factoryName)}"` : "",
    input.dateFrom ? `created>="${input.dateFrom} 00:00:00"` : "",
    input.dateTo ? `created<="${input.dateTo} 23:59:59"` : "",
    disbursedFilter,
    searchFilter,
  ]);
}

export async function countAdvances(filter: string) {
  const res = await pb.collection("advances").getList(1, 1, { filter, fields: "id" });
  return res.totalItems || 0;
}

export function formatMoney(value: number) {
  return Number(value || 0).toLocaleString("vi-VN");
}
