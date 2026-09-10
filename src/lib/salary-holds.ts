import { pb, type UserRecord } from "@/lib/pocketbase";
import type { EmploymentHistoryRecord } from "@/lib/employment";
import { companyPayload } from "@/lib/tenant";

export type SalaryHoldStatus = "received" | "approved" | "rejected" | "disbursed" | "cancelled";

export type SalaryHoldRecord = {
  id: string;
  tenant_company: string;
  worker: string;
  employment_history: string;
  staff: string;
  factory: string;
  worker_name: string;
  employee_code?: string;
  company_name: string;
  staff_bank_name: string;
  staff_bank_account_number: string;
  staff_bank_account_name: string;
  amount: number;
  content: string;
  status: SalaryHoldStatus;
  approved_by?: string;
  approved_at?: string;
  rejected_by?: string;
  rejected_at?: string;
  rejection_reason?: string;
  disbursed_by?: string;
  disbursed_at?: string;
  cancelled_at?: string;
  created?: string;
  updated?: string;
  expand?: {
    worker?: UserRecord;
    staff?: UserRecord;
    employment_history?: EmploymentHistoryRecord;
  };
};

export const SALARY_HOLD_STATUS = {
  received: { label: "Tiếp nhận", tone: "warning" as const },
  approved: { label: "Đã duyệt", tone: "primary" as const },
  disbursed: { label: "Đã giải ngân", tone: "success" as const },
  rejected: { label: "Từ chối", tone: "danger" as const },
  cancelled: { label: "Đã hủy", tone: "neutral" as const },
};

export function canCreateSalaryHold(
  viewer: Partial<UserRecord> | null | undefined,
  latest: EmploymentHistoryRecord | null | undefined,
) {
  return viewer?.role === "staff" && !!viewer.id && latest?.recruiter_staff === viewer.id;
}

export function hasCompleteBank(user: Partial<UserRecord> | null | undefined) {
  return !!(user?.bank_name && user.bank_account_number && user.bank_account_name);
}

export function createSalaryHoldPayload(
  viewer: UserRecord,
  worker: UserRecord,
  history: EmploymentHistoryRecord,
  amount: number,
  content: string,
) {
  return {
    ...companyPayload(viewer),
    worker: worker.id,
    employment_history: history.id,
    staff: viewer.id,
    factory: history.factory,
    worker_name: history.worker_name_snapshot || worker.full_name || worker.username || "",
    employee_code: history.employee_code || "",
    company_name: history.expand?.factory?.name || "",
    staff_bank_name: viewer.bank_name || "",
    staff_bank_account_number: viewer.bank_account_number || "",
    staff_bank_account_name: viewer.bank_account_name || "",
    amount,
    content: content.trim(),
    status: "received" as const,
  };
}

export async function createSalaryHold(payload: ReturnType<typeof createSalaryHoldPayload>) {
  return pb.collection("salary_holds").create<SalaryHoldRecord>(payload);
}

export function removeVietnameseTone(value: string) {
  return value
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function buildSalaryHoldTransferDescription(template: string, workerName: string) {
  const replaced = template.replace(/\+\s*(?:tên|ten)/gi, workerName.trim());
  return removeVietnameseTone(replaced).replace(/\s+/g, " ").trim() || "Giai ngan giu luong";
}
