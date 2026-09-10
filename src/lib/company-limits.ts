import { pb } from "./pocketbase";

export type CompanyRecordKind = "factories" | "recruitment_entities" | "staff_accounts";

export async function createCompanyRecord(
  kind: CompanyRecordKind,
  payload: Record<string, unknown>,
) {
  const response = await fetch("/api/admin/company-records", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${pb.authStore.token}`,
    },
    body: JSON.stringify({ kind, payload }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.message || "Không tạo được dữ liệu.");
  return body;
}

async function updateCompanyUser(userId: string, payload: Record<string, unknown>) {
  const response = await fetch("/api/admin/company-records", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${pb.authStore.token}`,
    },
    body: JSON.stringify({ userId, ...payload }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.message || "Không cập nhật được tài khoản.");
  return body;
}

export async function updateCompanyUserRole(userId: string, role: "user" | "staff" | "admin") {
  return updateCompanyUser(userId, { role });
}

export async function updateCompanyUserStatus(userId: string, status: "active" | "disabled") {
  return updateCompanyUser(userId, { status });
}
