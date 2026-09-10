import { pb, type UserRecord } from "./pocketbase";
import { escapePb } from "./delegations";
import { companyIdOf } from "./tenant";

export type FactoryStatus = "active" | "inactive";

export function factoryManagerTenantPayload(user?: Pick<UserRecord, "tenant_company"> | null) {
  const tenant_company = companyIdOf(user || (pb.authStore.record as UserRecord | null));
  if (!tenant_company) throw new Error("Tài khoản chưa được gán công ty.");
  return { tenant_company };
}

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

const FACTORY_MANAGER_CACHE_TIME = 15_000;
const factoryManagerInFlight = new Map<string, Promise<FactoryManagerRecord[]>>();
const factoryManagerCache = new Map<
  string,
  { expiresAt: number; records: FactoryManagerRecord[] }
>();

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
  const cacheKey = `${tenant}:${staffId || "all"}`;
  const cached = factoryManagerCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.records;
  const pending = factoryManagerInFlight.get(cacheKey);
  if (pending) return pending;

  const filters = [`tenant_company = "${escapePb(tenant)}"`];
  if (staffId) filters.push(`staff = "${escapePb(staffId)}"`);
  const filter = filters.join(" && ");
  const request = pb
    .collection("factory_managers")
    .getFullList({
      filter,
      sort: "-created",
      expand: "factory",
    })
    .then((records) => {
      const typedRecords = records as unknown as FactoryManagerRecord[];
      factoryManagerCache.set(cacheKey, {
        expiresAt: Date.now() + FACTORY_MANAGER_CACHE_TIME,
        records: typedRecords,
      });
      return typedRecords;
    })
    .finally(() => {
      factoryManagerInFlight.delete(cacheKey);
    });
  factoryManagerInFlight.set(cacheKey, request);
  return request;
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
