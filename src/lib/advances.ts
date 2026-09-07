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

export async function hydrateAdvanceRequesters(rows: AdvanceRecord[]) {
  const requesterIds = [
    ...new Set(
      rows
        .filter((row) => {
          // Include rows where requested_by exists but expand failed or returned null
          if (!row.requested_by) return false;
          const hasValidExpand = row.expand?.requested_by?.id;
          return !hasValidExpand;
        })
        .map((row) => row.requested_by as string),
    ),
  ];

  if (!requesterIds.length) return rows;

  console.log(`Hydrating ${requesterIds.length} advance requesters:`, requesterIds);

  // Fallback: if we can't fetch users from PocketBase, try to get from API route
  // which uses admin token to bypass listRule restrictions
  try {
    const response = await fetch("/api/advances/hydrate-requesters", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: pb.authStore.token ? `Bearer ${pb.authStore.token}` : "",
      },
      body: JSON.stringify({ requesterIds }),
    });

    if (response.ok) {
      const requesters = (await response.json()) as UserRecord[];
      console.log(`Fetched ${requesters.length} requesters via API route`);
      const byId = new Map(requesters.map((requester) => [requester.id, requester]));

      return rows.map((row) => {
        if (!row.requested_by) return row;
        if (row.expand?.requested_by?.id) return row;

        const requester = byId.get(row.requested_by);
        if (!requester) {
          console.warn(
            `Could not hydrate requester ${row.requested_by} for advance ${row.id} (${row.employee_code || row.full_name})`
          );
          return row;
        }

        return { ...row, expand: { ...row.expand, requested_by: requester } };
      });
    }
  } catch (error) {
    console.warn("Failed to use API route for hydration, falling back to direct fetch:", error);
  }

  // Fallback to direct PocketBase fetch (will likely fail due to listRule)
  const batchSize = 50;
  const allRequesters: UserRecord[] = [];

  for (let i = 0; i < requesterIds.length; i += batchSize) {
    const batch = requesterIds.slice(i, i + batchSize);
    const filter = batch.map((id) => `id="${escapePb(id)}"`).join(" || ");

    try {
      const requesters = await pb
        .collection("users")
        .getFullList<UserRecord>({
          filter,
          fields: "id,full_name,username,phone,role,tenant_company",
        });
      allRequesters.push(...requesters);
      console.log(`Fetched ${requesters.length} requesters in batch`, requesters.map(r => r.id));
    } catch (error) {
      console.error(`Failed to fetch batch of ${batch.length} advance requesters:`, error);
      console.error(`Filter used: ${filter}`);
    }
  }

  const byId = new Map(allRequesters.map((requester) => [requester.id, requester]));

  return rows.map((row) => {
    if (!row.requested_by) return row;

    // Check if already has valid expand
    if (row.expand?.requested_by?.id) return row;

    const requester = byId.get(row.requested_by);
    if (!requester) {
      // User not found - likely deleted or in different tenant after migration
      console.warn(
        `Could not hydrate requester ${row.requested_by} for advance ${row.id} (${row.employee_code || row.full_name})`
      );
      return row;
    }

    return { ...row, expand: { ...row.expand, requested_by: requester } };
  });
}

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
  return segment === "workers" ? 'worker!=""' : 'worker=""';
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
