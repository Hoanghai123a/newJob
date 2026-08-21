import type { UserRecord } from "./pocketbase";

export type CompanyStatus = "active" | "suspended" | "closed";

export interface CompanyRecord {
  id: string;
  code: string;
  name: string;
  status: CompanyStatus;
  address?: string;
  hotline?: string;
  email?: string;
  max_accounts?: number;
  max_workers?: number;
  max_factories?: number;
  max_file_bytes?: number;
  max_employment_histories?: number;
  created?: string;
  updated?: string;
}

export function isSuperAdmin(user?: Pick<UserRecord, "role"> | null) {
  return user?.role === "super_admin";
}

export function companyIdOf(user?: Pick<UserRecord, "company" | "tenant_company"> | null) {
  return typeof user?.tenant_company === "string" ? user.tenant_company : "";
}

export function companyFilter(
  user?: Pick<UserRecord, "company" | "tenant_company"> | null,
  field = "company",
) {
  const companyId = companyIdOf(user);
  if (!companyId) throw new Error("Tài khoản chưa được gán công ty.");
  return `${field} = "${companyId.replace(/\\/g, '\\").replace(/' / g, '\\"')}"`;
}

export function companyPayload(user?: Pick<UserRecord, "company" | "tenant_company"> | null) {
  const company = companyIdOf(user);
  if (!company) throw new Error("Tài khoản chưa được gán công ty.");
  return { company };
}

export function companyStatusLabel(status?: CompanyStatus) {
  if (status === "suspended") return "Tạm khóa";
  if (status === "closed") return "Đã đóng";
  return "Hoạt động";
}
