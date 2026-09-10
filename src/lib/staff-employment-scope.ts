import type { FactoryRecord } from "@/lib/factories";
import type { UserRecord } from "@/lib/pocketbase";

export type StaffEmploymentFactoryScope = "assigned" | "all";

export function normalizeStaffEmploymentFactoryScope(value?: unknown): StaffEmploymentFactoryScope {
  return value === "all" ? "all" : "assigned";
}

export function canUseEmploymentFactory(
  viewer: Pick<UserRecord, "role"> | null | undefined,
  factoryId: string,
  managedFactoryIds: Set<string>,
  scope?: unknown,
) {
  if (viewer?.role === "admin") return true;
  if (viewer?.role !== "staff") return false;
  return normalizeStaffEmploymentFactoryScope(scope) === "all" || managedFactoryIds.has(factoryId);
}

export function filterEmploymentFactories(
  viewer: Pick<UserRecord, "role"> | null | undefined,
  factories: FactoryRecord[],
  managedFactoryIds: Set<string>,
  scope?: unknown,
) {
  return factories.filter(
    (factory) =>
      factory.status !== "inactive" &&
      canUseEmploymentFactory(viewer, factory.id, managedFactoryIds, scope),
  );
}
