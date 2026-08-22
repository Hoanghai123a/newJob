import { pb, type UserRecord } from "./pocketbase";
import {
  buildTechnicalUsername,
  isSupportedCompanyCode,
  loginNameFromUsername,
} from "./login-identity";

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

const companyCache = new Map<string, CompanyRecord>();

export type TenantAccountIdentity = {
  tenantCompany: string;
  company: CompanyRecord;
  loginName: string;
  username: string;
  hasLoginName: boolean;
};

export async function resolveTenantAccountIdentity(
  user: Pick<UserRecord, "tenant_company"> | null | undefined,
  value: unknown,
): Promise<TenantAccountIdentity> {
  const tenantCompany = companyIdOf(user);
  if (!tenantCompany) throw new Error("Tài khoản Admin chưa được gán công ty.");

  let company = companyCache.get(tenantCompany);
  let hasLoginName = false;
  if (!company) {
    const response = await fetch("/api/tenant-company", {
      headers: { Authorization: `Bearer ${pb.authStore.token}` },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.message || "Không đọc được thông tin công ty.");
    company = body as CompanyRecord;
    hasLoginName = Boolean(body?.hasLoginName);
    companyCache.set(tenantCompany, company);
  } else {
    const response = await fetch("/api/tenant-company", {
      headers: { Authorization: `Bearer ${pb.authStore.token}` },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.message || "Không đọc được thông tin công ty.");
    hasLoginName = Boolean(body?.hasLoginName);
  }
  if (!company.code?.trim() || !isSupportedCompanyCode(company.code)) {
    throw new Error("Mã công ty chưa được cấu hình hoặc không hợp lệ.");
  }
  if (company.status !== "active") throw new Error("Công ty hiện không hoạt động.");

  const loginName = loginNameFromUsername(value);
  if (!loginName) throw new Error("Tên đăng nhập không hợp lệ.");
  return {
    tenantCompany,
    company,
    loginName,
    username: buildTechnicalUsername(company.code, loginName),
    hasLoginName,
  };
}

export function isSuperAdmin(user?: Pick<UserRecord, "role"> | null) {
  return user?.role === "super_admin";
}

export function companyIdOf(user?: Pick<UserRecord, "tenant_company"> | null) {
  return typeof user?.tenant_company === "string" ? user.tenant_company : "";
}

export function companyFilter(
  user?: Pick<UserRecord, "tenant_company"> | null,
  field = "tenant_company",
) {
  const companyId = companyIdOf(user);
  if (!companyId) throw new Error("Tài khoản chưa được gán công ty.");
  return `${field} = "${companyId.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function companyPayload(user?: Pick<UserRecord, "tenant_company"> | null) {
  const tenant_company = companyIdOf(user);
  if (!tenant_company) throw new Error("Tài khoản chưa được gán công ty.");
  return { tenant_company };
}

export function joinTenantFilters(
  user: Pick<UserRecord, "tenant_company"> | null | undefined,
  ...filters: Array<string | false | null | undefined>
) {
  return [companyFilter(user), ...filters].filter(Boolean).join(" && ");
}

export function assertSameTenant(
  user: Pick<UserRecord, "tenant_company"> | null | undefined,
  record: { tenant_company?: string } | null | undefined,
) {
  const tenant = companyIdOf(user);
  if (!tenant) throw new Error("Tài khoản chưa được gán công ty.");
  if (!record?.tenant_company || record.tenant_company !== tenant) {
    throw new Error("Dữ liệu không thuộc công ty hiện tại.");
  }
  return tenant;
}

export function companyStatusLabel(status?: CompanyStatus) {
  if (status === "suspended") return "Tạm khóa";
  if (status === "closed") return "Đã đóng";
  return "Hoạt động";
}
