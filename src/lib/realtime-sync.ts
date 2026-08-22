import type { UnsubscribeFunc } from "pocketbase";
import { pb, type UserRecord } from "./pocketbase";
import type { WorkerRecord } from "./workers";
import type { EmploymentHistoryRecord } from "./employment";
import type { CccdVersionRecord } from "./cccd-versions";
import type { FactoryRecord } from "./factories";
import type { RecruitmentEntityRecord } from "./recruitment-entities";
import { buildScopedHistoryFilter } from "./staff-permissions";
import { companyIdOf } from "./tenant";
import {
  deleteCachedHistory,
  deleteCachedUser,
  deleteCachedCccdVersion,
  deleteCachedFactory,
  deleteCachedRecruitmentEntity,
  upsertCachedHistoryIfNewer,
  upsertCachedUserIfNewer,
  upsertCachedCccdVersionIfNewer,
  updateCachedFactory,
  updateCachedRecruitmentEntity,
  readCachedHistory,
  readCachedUser,
  getCachedUserIds,
  factoryExistsInCache,
  recruitmentEntityExistsInCache,
  buildScopeFingerprint,
  reconcileStaffData,
  saveScopeFingerprint,
} from "./staff-cache";

const SIGNAL_EVENT = "jobconnect:staff-cache-changed";
const CATCHUP_DEBOUNCE_MS = 5000;

type Action = "create" | "update" | "delete";
interface RealtimeEvent<T> {
  action: Action;
  record: T;
}

interface SyncState {
  key: string;
  viewerId: string;
  managedFactoryIds: Set<string>;
  unsubs: UnsubscribeFunc[];
  catchupTimer: number | null;
  catchupPromise: Promise<void> | null;
  visibilityHandler: (() => void) | null;
  onlineHandler: (() => void) | null;
}

let state: SyncState | null = null;
let requestedVersion = 0;
let operationQueue: Promise<void> = Promise.resolve();

function syncKey(viewer: UserRecord, managedFactoryIds: Set<string>) {
  return buildScopeFingerprint(viewer.id, managedFactoryIds, viewer.role, companyIdOf(viewer));
}

function enqueue(operation: () => Promise<void>): Promise<void> {
  const task = operationQueue.then(operation);
  operationQueue = task.catch(() => undefined);
  return task;
}

function dispatchSignal(detail: { collection: string; action: Action; id: string }) {
  try {
    window.dispatchEvent(new CustomEvent(SIGNAL_EVENT, { detail }));
  } catch {
    // ignore dispatch failures (e.g. SSR / no window)
  }
}

function isHistoryInScope(
  viewer: { id: string; role?: string },
  record: EmploymentHistoryRecord,
  managedFactoryIds: Set<string>,
): boolean {
  if (viewer.role === "admin") return true;
  if (record.recruiter_staff === viewer.id) return true;
  return managedFactoryIds.has(record.factory);
}

async function handleHistoryEvent(
  event: RealtimeEvent<EmploymentHistoryRecord>,
  viewer: { id: string; role?: string },
  managedFactoryIds: Set<string>,
) {
  const { action, record } = event;
  if (!record?.id) return;

  if (action === "delete") {
    await deleteCachedHistory(record.id);
    dispatchSignal({ collection: "employment_histories", action, id: record.id });
    return;
  }

  const inScope = isHistoryInScope(viewer, record, managedFactoryIds);
  if (!inScope) {
    const cached = await readCachedHistory(record.id);
    if (cached) {
      await deleteCachedHistory(record.id);
      dispatchSignal({ collection: "employment_histories", action: "delete", id: record.id });
    }
    return;
  }

  let relatedUser = record.expand?.user;
  if (!relatedUser && record.user) {
    relatedUser = await pb
      .collection("workers")
      .getOne<WorkerRecord>(record.user)
      .catch(() => undefined);
  }

  const userChanged = relatedUser ? await upsertCachedUserIfNewer(relatedUser) : false;
  const historyChanged = await upsertCachedHistoryIfNewer(record);
  if (!historyChanged && !userChanged) {
    console.debug("[realtime-sync] skip stale echo history", record.id);
    return;
  }
  dispatchSignal({ collection: "employment_histories", action, id: record.id });
}

function syncAuthenticatedUser(record: UserRecord) {
  const current = pb.authStore.record as (UserRecord & { expand?: Record<string, unknown> }) | null;
  if (!current || current.id !== record.id) return;

  pb.authStore.save(pb.authStore.token, {
    ...current,
    ...record,
    expand: {
      ...current.expand,
      ...(record as UserRecord & { expand?: Record<string, unknown> }).expand,
    },
  } as unknown as NonNullable<typeof pb.authStore.record>);
}

async function handleWorkerEvent(event: RealtimeEvent<WorkerRecord>) {
  const { action, record } = event;
  if (!record?.id) return;

  if (action === "delete") {
    await deleteCachedUser(record.id);
    dispatchSignal({ collection: "workers", action, id: record.id });
    return;
  }

  const userIds = await getCachedUserIds();
  if (!userIds.has(record.id)) {
    const cached = await readCachedUser(record.id);
    if (!cached) return;
  }

  const changed = await upsertCachedUserIfNewer(record);
  if (!changed) {
    console.debug("[realtime-sync] skip stale echo worker", record.id);
    return;
  }
  dispatchSignal({ collection: "workers", action, id: record.id });
}
async function handleCccdVersionEvent(event: RealtimeEvent<CccdVersionRecord>) {
  const { action, record } = event;
  if (!record?.id) return;

  if (action === "delete") {
    await deleteCachedCccdVersion(record.id);
    dispatchSignal({ collection: "cccd_versions", action, id: record.id });
    return;
  }

  const userIds = await getCachedUserIds();
  if (!userIds.has(record.user)) return;

  const changed = await upsertCachedCccdVersionIfNewer(record);
  if (!changed) return;
  dispatchSignal({ collection: "cccd_versions", action, id: record.id });
}

async function handleFactoryEvent(event: RealtimeEvent<FactoryRecord>) {
  const { action, record } = event;
  if (!record?.id) return;

  if (action === "delete") {
    await deleteCachedFactory(record.id);
    dispatchSignal({ collection: "factories", action, id: record.id });
    return;
  }

  const exists = await factoryExistsInCache(record.id);
  if (!exists) return;

  await updateCachedFactory(record);
  dispatchSignal({ collection: "factories", action, id: record.id });
}

async function handleRecruitmentEntityEvent(event: RealtimeEvent<RecruitmentEntityRecord>) {
  const { action, record } = event;
  if (!record?.id) return;

  if (action === "delete") {
    await deleteCachedRecruitmentEntity(record.id);
    dispatchSignal({ collection: "recruitment_entities", action, id: record.id });
    return;
  }

  const exists = await recruitmentEntityExistsInCache(record.id);
  if (!exists) return;

  await updateCachedRecruitmentEntity(record);
  dispatchSignal({ collection: "recruitment_entities", action, id: record.id });
}

async function cleanupSubscriptions(unsubs: UnsubscribeFunc[], viewerId?: string) {
  // PocketBase ties a realtime client to the token that opened it. After logout or
  // account switching, submitting an unsubscribe with the new token returns 403.
  const authenticatedUser = pb.authStore.record as UserRecord | null;
  if (viewerId && authenticatedUser?.id !== viewerId) {
    pb.realtime.disconnect();
    return;
  }
  for (const unsub of unsubs) {
    try {
      await unsub();
    } catch (error) {
      console.warn("[realtime-sync] unsubscribe failed", error);
    }
  }
}
async function unsubscribeRealtimeTopics() {
  for (const collection of [
    "employment_histories",
    "users",
    "cccd_versions",
    "factories",
    "recruitment_entities",
  ]) {
    try {
      await pb.collection(collection).unsubscribe("*");
    } catch {
      // ignore cleanup failures
    }
  }
}

async function runStopStaffRealtimeSync(): Promise<void> {
  if (!state) return;
  const current = state;
  state = null;

  if (current.catchupTimer !== null) window.clearTimeout(current.catchupTimer);
  if (current.visibilityHandler)
    document.removeEventListener("visibilitychange", current.visibilityHandler);
  if (current.onlineHandler) window.removeEventListener("online", current.onlineHandler);
  await cleanupSubscriptions(current.unsubs, current.viewerId);
  if (current.catchupPromise) await current.catchupPromise;
}

async function runStartStaffRealtimeSync(
  viewer: UserRecord,
  managedFactoryIds: Set<string>,
  version: number,
): Promise<void> {
  const key = syncKey(viewer, managedFactoryIds);
  if (state?.key === key) return;
  if (state) await runStopStaffRealtimeSync();
  if (version !== requestedVersion) return;

  const unsubs: UnsubscribeFunc[] = [];
  // Ensure an SSE client created by a previous login cannot reuse another account token.
  pb.realtime.disconnect();
  try {
    const historyFilter = buildScopedHistoryFilter(viewer, managedFactoryIds);
    const historyUnsub = await pb
      .collection("employment_histories")
      .subscribe(
        "*",
        (e) =>
          handleHistoryEvent(
            e as unknown as RealtimeEvent<EmploymentHistoryRecord>,
            { id: viewer.id, role: viewer.role },
            managedFactoryIds,
          ).catch((err) => console.warn("[realtime-sync] history handler", err)),
        {
          filter: historyFilter || undefined,
          expand: "user,factory,recruiter_staff,recruiter_partner,main_house",
        },
      );
    unsubs.push(historyUnsub);
    if (version !== requestedVersion) {
      await cleanupSubscriptions(unsubs);
      return;
    }

    const workerUnsub = await pb
      .collection("workers")
      .subscribe("*", (e) =>
        handleWorkerEvent(e as unknown as RealtimeEvent<WorkerRecord>).catch((err) =>
          console.warn("[realtime-sync] worker handler", err),
        ),
      );
    unsubs.push(workerUnsub);
    if (version !== requestedVersion) {
      await cleanupSubscriptions(unsubs);
      return;
    }

    const cccdUnsub = await pb
      .collection("cccd_versions")
      .subscribe("*", (e) =>
        handleCccdVersionEvent(e as unknown as RealtimeEvent<CccdVersionRecord>).catch((err) =>
          console.warn("[realtime-sync] cccd handler", err),
        ),
      );
    unsubs.push(cccdUnsub);
    if (version !== requestedVersion) {
      await cleanupSubscriptions(unsubs);
      return;
    }

    const factoryUnsub = await pb
      .collection("factories")
      .subscribe("*", (e) =>
        handleFactoryEvent(e as unknown as RealtimeEvent<FactoryRecord>).catch((err) =>
          console.warn("[realtime-sync] factory handler", err),
        ),
      );
    unsubs.push(factoryUnsub);
    if (version !== requestedVersion) {
      await cleanupSubscriptions(unsubs);
      return;
    }

    const recruitmentEntityUnsub = await pb
      .collection("recruitment_entities")
      .subscribe("*", (e) =>
        handleRecruitmentEntityEvent(e as unknown as RealtimeEvent<RecruitmentEntityRecord>).catch(
          (err) => console.warn("[realtime-sync] recruitment-entity handler", err),
        ),
      );
    unsubs.push(recruitmentEntityUnsub);
  } catch (error) {
    console.warn("[realtime-sync] failed to subscribe", error);
    await cleanupSubscriptions(unsubs);
    if (version === requestedVersion) await unsubscribeRealtimeTopics();
    return;
  }

  if (version !== requestedVersion) {
    await cleanupSubscriptions(unsubs);
    return;
  }

  const visibilityHandler = () => {
    if (document.visibilityState === "visible") scheduleCatchUp(viewer);
  };
  const onlineHandler = () => scheduleCatchUp(viewer);
  document.addEventListener("visibilitychange", visibilityHandler);
  window.addEventListener("online", onlineHandler);

  state = {
    key,
    viewerId: viewer.id,
    managedFactoryIds,
    unsubs,
    catchupTimer: null,
    catchupPromise: null,
    visibilityHandler,
    onlineHandler,
  };
  scheduleCatchUp(viewer);
}

export function startStaffRealtimeSync(
  viewer: UserRecord,
  managedFactoryIds: Set<string>,
): Promise<void> {
  const version = ++requestedVersion;
  return enqueue(() => runStartStaffRealtimeSync(viewer, managedFactoryIds, version));
}

export function stopStaffRealtimeSync(): Promise<void> {
  ++requestedVersion;
  return enqueue(runStopStaffRealtimeSync);
}

function scheduleCatchUp(viewer: UserRecord) {
  if (!state) return;
  if (state.catchupTimer !== null) window.clearTimeout(state.catchupTimer);
  state.catchupTimer = window.setTimeout(() => {
    const current = state;
    if (current) current.catchupTimer = null;
    void catchUpStaffRealtimeSync(viewer).catch((err) =>
      console.warn("[realtime-sync] catch-up failed", err),
    );
  }, CATCHUP_DEBOUNCE_MS);
}

export function catchUpStaffRealtimeSync(viewer: UserRecord): Promise<void> {
  const current = state;
  if (!current) return Promise.resolve();
  if (current.catchupPromise) return current.catchupPromise;

  const promise = (async () => {
    try {
      const historyFilter = buildScopedHistoryFilter(viewer, current.managedFactoryIds);
      await reconcileStaffData({
        historyFilter,
        includeCccdVersions: true,
      });
      await saveScopeFingerprint(
        buildScopeFingerprint(
          viewer.id,
          current.managedFactoryIds,
          viewer.role,
          companyIdOf(viewer),
        ),
      );
      if (state === current) {
        dispatchSignal({ collection: "employment_histories", action: "update", id: "__catchup__" });
        console.debug("[realtime-sync] catch-up done");
      }
    } catch (error) {
      console.warn("[realtime-sync] catch-up error", error);
    }
  })();

  const trackedPromise = promise.finally(() => {
    if (current.catchupPromise === trackedPromise) current.catchupPromise = null;
  });
  current.catchupPromise = trackedPromise;
  return trackedPromise;
}
