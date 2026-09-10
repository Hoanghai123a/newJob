import { pb } from "./pocketbase";
import { escapePb } from "./delegations";
import { companyFilter, companyPayload, joinTenantFilters } from "./tenant";
import type { UserRecord } from "./pocketbase";

export const WORK_PROGRESS_COLLECTIONS = {
  tabs: "work_progress_tabs",
  statuses: "work_progress_statuses",
  tasks: "work_progress_tasks",
} as const;

export interface WorkProgressTabRecord {
  id: string;
  tenant_company: string;
  name: string;
  position: number;
  created_by: string;
  created: string;
  updated: string;
}

export interface WorkProgressStatusRecord {
  id: string;
  tenant_company: string;
  tab: string;
  name: string;
  position: number;
  created_by: string;
  created: string;
  updated: string;
}

export interface WorkProgressTaskRecord {
  id: string;
  tenant_company: string;
  tab: string;
  status: string;
  name: string;
  position: number;
  created_by: string;
  created: string;
  updated: string;
}

export interface WorkProgressData {
  tabs: WorkProgressTabRecord[];
  statuses: WorkProgressStatusRecord[];
  tasks: WorkProgressTaskRecord[];
}

type OrderedRecord = { id: string; position: number };
function tenantUser() {
  return pb.authStore.record as UserRecord | null;
}

type OrderedCollection = (typeof WORK_PROGRESS_COLLECTIONS)[keyof typeof WORK_PROGRESS_COLLECTIONS];

export async function fetchWorkProgressData(): Promise<WorkProgressData> {
  const [tabs, statuses, tasks] = await Promise.all([
    pb.collection(WORK_PROGRESS_COLLECTIONS.tabs).getFullList<WorkProgressTabRecord>({
      filter: companyFilter(tenantUser()),
      sort: "position,created",
    }),
    pb.collection(WORK_PROGRESS_COLLECTIONS.statuses).getFullList<WorkProgressStatusRecord>({
      filter: companyFilter(tenantUser()),
      sort: "tab,position,created",
    }),
    pb.collection(WORK_PROGRESS_COLLECTIONS.tasks).getFullList<WorkProgressTaskRecord>({
      filter: companyFilter(tenantUser()),
      sort: "tab,position,created",
    }),
  ]);

  return { tabs, statuses, tasks };
}

async function nextPosition(collection: OrderedCollection, tabId?: string) {
  const record = await pb
    .collection(collection)
    .getFirstListItem<OrderedRecord>(
      joinTenantFilters(tenantUser(), tabId && `tab = "${escapePb(tabId)}"`),
      {
        sort: "-position",
        fields: "id,position",
      },
    )
    .catch(() => null);
  return Math.max(0, Number(record?.position) || 0) + 1;
}

export async function createWorkProgressTab(name: string, adminId: string) {
  return pb.collection(WORK_PROGRESS_COLLECTIONS.tabs).create<WorkProgressTabRecord>({
    ...companyPayload(tenantUser()),
    name,
    position: await nextPosition(WORK_PROGRESS_COLLECTIONS.tabs),
    created_by: adminId,
  });
}

export async function updateWorkProgressTab(
  id: string,
  data: Partial<Pick<WorkProgressTabRecord, "name" | "position">>,
) {
  return pb.collection(WORK_PROGRESS_COLLECTIONS.tabs).update<WorkProgressTabRecord>(id, data);
}

export async function deleteWorkProgressTab(id: string) {
  await pb.collection(WORK_PROGRESS_COLLECTIONS.tabs).delete(id);
}

export async function createWorkProgressStatus(tabId: string, name: string, adminId: string) {
  return pb.collection(WORK_PROGRESS_COLLECTIONS.statuses).create<WorkProgressStatusRecord>({
    ...companyPayload(tenantUser()),
    tab: tabId,
    name,
    position: await nextPosition(WORK_PROGRESS_COLLECTIONS.statuses, tabId),
    created_by: adminId,
  });
}

export async function updateWorkProgressStatus(
  id: string,
  data: Partial<Pick<WorkProgressStatusRecord, "name" | "position">>,
) {
  return pb
    .collection(WORK_PROGRESS_COLLECTIONS.statuses)
    .update<WorkProgressStatusRecord>(id, data);
}

export async function deleteWorkProgressStatus(id: string) {
  await pb.collection(WORK_PROGRESS_COLLECTIONS.statuses).delete(id);
}

export async function createWorkProgressTask(
  tabId: string,
  statusId: string,
  name: string,
  adminId: string,
) {
  return pb.collection(WORK_PROGRESS_COLLECTIONS.tasks).create<WorkProgressTaskRecord>({
    ...companyPayload(tenantUser()),
    tab: tabId,
    status: statusId,
    name,
    position: await nextPosition(WORK_PROGRESS_COLLECTIONS.tasks, tabId),
    created_by: adminId,
  });
}

export async function updateWorkProgressTask(
  id: string,
  data: Partial<Pick<WorkProgressTaskRecord, "name" | "status" | "position">>,
) {
  return pb.collection(WORK_PROGRESS_COLLECTIONS.tasks).update<WorkProgressTaskRecord>(id, data);
}

export async function deleteWorkProgressTask(id: string) {
  await pb.collection(WORK_PROGRESS_COLLECTIONS.tasks).delete(id);
}

export async function swapWorkProgressPositions(
  collection: OrderedCollection,
  current: OrderedRecord,
  adjacent: OrderedRecord,
) {
  await Promise.all([
    pb.collection(collection).update(current.id, { position: adjacent.position }),
    pb.collection(collection).update(adjacent.id, { position: current.position }),
  ]);
}

export async function subscribeWorkProgress(onChange: () => void) {
  const unsubscribers = await Promise.all(
    Object.values(WORK_PROGRESS_COLLECTIONS).map((collection) =>
      pb.collection(collection).subscribe("*", (event) => {
        if (
          (event.record as { tenant_company?: string }).tenant_company ===
          companyPayload(tenantUser()).tenant_company
        )
          onChange();
      }),
    ),
  );
  return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
}
