import { pb, type UserRecord } from "./pocketbase";
import { escapePb } from "./delegations";
import { companyIdOf } from "./tenant";

export type FactoryStatus = "active" | "inactive";

export interface FactoryRecord {
  id: string;
  tenant_company?: string;
  code?: string;
  name: string;
  address?: string;
  hotline?: string;
  attendance_cutoff_day?: number;
  advance_limit?: number;
  status?: FactoryStatus;
  note?: string;
  created?: string;
  updated?: string;
}

export interface FactoryManagerRecord {
  id: string;
  tenant_company?: string;
  factory: string;
  staff: string;
  active_from?: string;
  active_to?: string;
  status?: FactoryStatus;
  note?: string;
  expand?: {
    factory?: FactoryRecord;
  };
}

export async function fetchFactories(user?: Pick<UserRecord, "tenant_company"> | null) {
  const tenant = companyIdOf(user || (pb.authStore.record as UserRecord | null));
  if (!tenant) throw new Error("Tài khoản chưa được gán công ty.");
  const filter = `tenant_company = "${escapePb(tenant)}"`;
  return (await pb.collection("factories").getFullList({
    filter,
    sort: "name",
  })) as unknown as FactoryRecord[];
}

export async function fetchFactoryManagers(
  staffId?: string,
  user?: Pick<UserRecord, "tenant_company"> | null,
) {
  const tenant = companyIdOf(user || (pb.authStore.record as UserRecord | null));
  if (!tenant) throw new Error("Tài khoản chưa được gán công ty.");
  const filters = [`tenant_company = "${escapePb(tenant)}"`];
  if (staffId) filters.push(`staff = "${escapePb(staffId)}"`);
  const filter = filters.join(" && ");
  return (await pb.collection("factory_managers").getFullList({
    filter,
    sort: "-created",
    expand: "factory",
  })) as unknown as FactoryManagerRecord[];
}

export function isFactoryAssignmentActive(
  record: FactoryManagerRecord,
  referenceDate = new Date(),
) {
  if (record.status === "inactive") return false;

  const refTime = referenceDate.getTime();
  const fromTime = record.active_from
    ? new Date(record.active_from).getTime()
    : Number.NEGATIVE_INFINITY;
  const toTime = record.active_to ? new Date(record.active_to).getTime() : Number.POSITIVE_INFINITY;

  return fromTime <= refTime && toTime >= refTime;
}

export function factoryDisplayName(factory?: Partial<FactoryRecord> | null) {
  if (!factory) return "Chưa gán nhà máy";
  return [factory.code, factory.name].filter(Boolean).join(" - ");
}
