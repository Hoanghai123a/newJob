import { pb, type UserRecord } from "./pocketbase";
import { escapePb } from "./delegations";
import { companyIdOf } from "./tenant";

export type RecruitmentEntityStatus = "active" | "inactive";

export interface RecruitmentEntityRecord {
  id: string;
  tenant_company?: string;
  name: string;
  address?: string;
  hotline?: string;
  note?: string;
  status?: RecruitmentEntityStatus;
  legacy_user_id?: string;
  legacy_username?: string;
  created?: string;
  updated?: string;
}

export function isRecruitmentEntityActive(entity: Partial<RecruitmentEntityRecord>) {
  return entity.status !== "inactive";
}

export async function fetchRecruitmentEntities(options?: {
  includeInactive?: boolean;
  user?: Pick<UserRecord, "tenant_company"> | null;
}) {
  const tenant = companyIdOf(options?.user || (pb.authStore.record as UserRecord | null));
  if (!tenant) throw new Error("Tài khoản chưa được gán công ty.");
  const tenantFilter = `tenant_company = "${escapePb(tenant)}"`;
  const statusFilter = options?.includeInactive ? "" : 'status="active" || status=""';
  const filter = [tenantFilter, statusFilter].filter(Boolean).join(" && ");

  return (await pb.collection("recruitment_entities").getFullList({
    filter,
    sort: "name",
  })) as unknown as RecruitmentEntityRecord[];
}
