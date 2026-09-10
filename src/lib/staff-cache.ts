import { pb, type UserRecord } from "./pocketbase";
import type { WorkerRecord } from "./workers";
import { relationInFilter } from "./delegations";
import type { EmploymentHistoryRecord } from "./employment";
import type { CccdVersionRecord } from "./cccd-versions";
import type { FactoryRecord } from "./factories";
import type { RecruitmentEntityRecord } from "./recruitment-entities";

const DB_NAME = "jobconnect-staff-cache";
const DB_VERSION = 7;
const STORE_HISTORIES = "employment_histories";
const STORE_USERS = "workers";
const STORE_CCCD_VERSIONS = "cccd_versions";
const STORE_FACTORIES = "factories";
const STORE_RECRUITMENT_ENTITIES = "recruitment_entities";
const STORE_STAFF_USERS = "staff_users";
const STORE_META = "_meta";
const BATCH_SIZE = 50;
// Sau khoảng thời gian này, catch-up chạy full reconcile để dọn record bị xóa khi offline.
const FULL_RECONCILE_INTERVAL_MS = 6 * 60 * 60 * 1000;

function combineFilters(...parts: (string | undefined)[]): string {
  return parts
    .filter((part): part is string => Boolean(part))
    .map((part) => `(${part})`)
    .join(" && ");
}

const STAFF_SYNC_DEDUPE_TIME = 15_000;
const staffSyncInFlight = new Map<
  string,
  Promise<{ histories: EmploymentHistoryRecord[]; users: WorkerRecord[] }>
>();
const staffSyncRecent = new Map<
  string,
  { completedAt: number; result: { histories: EmploymentHistoryRecord[]; users: WorkerRecord[] } }
>();

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_HISTORIES)) {
        db.createObjectStore(STORE_HISTORIES, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_USERS)) {
        db.createObjectStore(STORE_USERS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_CCCD_VERSIONS)) {
        db.createObjectStore(STORE_CCCD_VERSIONS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_FACTORIES)) {
        db.createObjectStore(STORE_FACTORIES, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_RECRUITMENT_ENTITIES)) {
        db.createObjectStore(STORE_RECRUITMENT_ENTITIES, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_STAFF_USERS)) {
        db.createObjectStore(STORE_STAFF_USERS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META);
      }
      if (event.oldVersion < 7) {
        for (const store of [
          STORE_HISTORIES,
          STORE_USERS,
          STORE_CCCD_VERSIONS,
          STORE_FACTORIES,
          STORE_RECRUITMENT_ENTITIES,
          STORE_STAFF_USERS,
          STORE_META,
        ]) {
          if (db.objectStoreNames.contains(store)) request.transaction?.objectStore(store).clear();
        }
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      const requiredStores = [
        STORE_HISTORIES,
        STORE_USERS,
        STORE_CCCD_VERSIONS,
        STORE_FACTORIES,
        STORE_RECRUITMENT_ENTITIES,
        STORE_STAFF_USERS,
        STORE_META,
      ];
      if (requiredStores.some((store) => !db.objectStoreNames.contains(store))) {
        db.close();
        reject(new Error("Bộ nhớ đệm staff chưa được nâng cấp đầy đủ."));
        return;
      }
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  });
}

function idbGetAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbPutMany<T>(db: IDBDatabase, store: string, items: T[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const os = tx.objectStore(store);
    for (const item of items) os.put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbReplaceMany<T>(db: IDBDatabase, store: string, items: T[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const os = tx.objectStore(store);
    os.clear();
    for (const item of items) os.put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbPut(db: IDBDatabase, store: string, value: unknown, key?: IDBValidKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbGet<T>(db: IDBDatabase, store: string, key: IDBValidKey): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbDelete(db: IDBDatabase, store: string, key: IDBValidKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function usersFromExpandedHistories(histories: EmploymentHistoryRecord[]): WorkerRecord[] {
  const map = new Map<string, WorkerRecord>();
  for (const history of histories) {
    const user = history.expand?.worker;
    if (user?.id) map.set(user.id, user);
  }
  return [...map.values()];
}

function idbClear(db: IDBDatabase, store: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

const usersBatchInFlight = new Map<string, Promise<WorkerRecord[]>>();

export function fetchUsersBatched(userIds: string[]): Promise<WorkerRecord[]> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (!unique.length) return Promise.resolve([]);
  const key = unique.slice().sort().join(",");
  const pending = usersBatchInFlight.get(key);
  if (pending) return pending;

  const request = fetchUsersBatchedUncached(unique).finally(() => {
    usersBatchInFlight.delete(key);
  });
  usersBatchInFlight.set(key, request);
  return request;
}

async function fetchUsersBatchedUncached(unique: string[]): Promise<WorkerRecord[]> {
  const results: WorkerRecord[] = [];
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE);
    const items = (await pb.collection("workers").getFullList({
      filter: relationInFilter("id", batch),
      sort: "full_name,username",
    })) as unknown as WorkerRecord[];
    results.push(...items);
  }
  return results;
}

async function getLastSyncAt(db: IDBDatabase): Promise<string> {
  const val = await idbGet<string>(db, STORE_META, "lastSyncAt");
  return val || "";
}

async function setLastSyncAt(db: IDBDatabase, timestamp: string): Promise<void> {
  await idbPut(db, STORE_META, timestamp, "lastSyncAt");
}

async function getLastFullReconcileAt(db: IDBDatabase): Promise<number> {
  const val = await idbGet<number>(db, STORE_META, "lastFullReconcileAt");
  return val || 0;
}

async function setLastFullReconcileAt(db: IDBDatabase, timestamp: number): Promise<void> {
  await idbPut(db, STORE_META, timestamp, "lastFullReconcileAt");
}

function getLatestUpdatedAt(records: Array<{ updated?: string }>, fallback = ""): string {
  return records.reduce((latest, record) => {
    const updated = record.updated || "";
    return updated > latest ? updated : latest;
  }, fallback);
}

export async function readCachedStaffData(): Promise<{
  histories: EmploymentHistoryRecord[];
  users: WorkerRecord[];
} | null> {
  try {
    const db = await openDB();
    const lastSync = await getLastSyncAt(db);
    if (!lastSync) return null;

    const histories = await idbGetAll<EmploymentHistoryRecord>(db, STORE_HISTORIES);
    const users = await idbGetAll<WorkerRecord>(db, STORE_USERS);
    if (!histories.length) return null;
    return { histories, users };
  } catch {
    return null;
  }
}

async function syncStaffDataUncached(opts?: {
  historyFilter?: string;
  useCache?: boolean;
  includeCccdVersions?: boolean;
  hydrateCache?: boolean;
}): Promise<{
  histories: EmploymentHistoryRecord[];
  users: WorkerRecord[];
}> {
  const db = await openDB();
  const useCache = opts?.useCache ?? true;
  const includeCccdVersions = opts?.includeCccdVersions ?? true;
  const lastSync = useCache ? await getLastSyncAt(db) : "";

  const historyFilter = opts?.historyFilter || "";

  // Với cache: lấy incremental delta nếu có lastSync, fallback full nếu không.
  const deltaFilter = lastSync
    ? combineFilters(historyFilter, `updated>"${lastSync}"`)
    : historyFilter;

  const freshHistories = (await pb.collection("employment_histories").getFullList({
    filter: deltaFilter,
    sort: "-join_date,-created",
    expand: "worker,factory,recruiter_staff,recruiter_partner,main_house,cccd_version",
  })) as unknown as EmploymentHistoryRecord[];
  const expandedUsers = usersFromExpandedHistories(freshHistories);

  if (!useCache) {
    const userIds = [...new Set(freshHistories.map((h) => h.worker).filter(Boolean))];
    const expandedUserIds = new Set(expandedUsers.map((u) => u.id));
    const missingIds = userIds.filter((id) => !expandedUserIds.has(id));
    const fetched = await fetchUsersBatched(missingIds).catch(() => []);
    const users = [...expandedUsers, ...fetched];

    if (opts?.hydrateCache) {
      if (freshHistories.length) {
        await idbPutMany(db, STORE_HISTORIES, freshHistories);
      }
      if (users.length) {
        await idbPutMany(db, STORE_USERS, users);
      }
      const latestHistoryUpdate = getLatestUpdatedAt(freshHistories);
      if (latestHistoryUpdate) {
        await setLastSyncAt(db, latestHistoryUpdate);
      }
    }

    return { histories: freshHistories, users };
  }

  // Upsert delta vào cache (không xóa record cũ)
  if (freshHistories.length) {
    await idbPutMany(db, STORE_HISTORIES, freshHistories);
  }
  if (expandedUsers.length) {
    await idbPutMany(db, STORE_USERS, expandedUsers);
  }

  const allHistories = await idbGetAll<EmploymentHistoryRecord>(db, STORE_HISTORIES);

  // Delta: chỉ refresh worker của history vừa đổi. Full (lần đầu): refresh toàn scope.
  // Thay đổi profile worker khi không đụng history được realtime + full reconcile định kỳ lo.
  const userIdsToRefresh = lastSync
    ? [...new Set(freshHistories.map((h) => h.worker).filter(Boolean))]
    : [...new Set(allHistories.map((h) => h.worker).filter(Boolean))];

  const refreshedUsers = userIdsToRefresh.length
    ? await fetchUsersBatched(userIdsToRefresh).catch((error) => {
        console.warn("[staff-cache] scoped user refresh failed", error);
        return [] as WorkerRecord[];
      })
    : [];

  if (refreshedUsers.length) {
    await idbPutMany(db, STORE_USERS, refreshedUsers);
  }

  if (includeCccdVersions) {
    const cccdVerFilter = lastSync ? `updated>"${lastSync}"` : "";
    const freshCccdVersions = (await pb
      .collection("cccd_versions")
      .getFullList({
        filter: cccdVerFilter,
        sort: "-created",
      })
      .catch(() => [])) as unknown as CccdVersionRecord[];

    if (freshCccdVersions.length) {
      await idbPutMany(db, STORE_CCCD_VERSIONS, freshCccdVersions);
    }
  }

  const allUsers = await idbGetAll<WorkerRecord>(db, STORE_USERS);
  const latestHistoryUpdate = getLatestUpdatedAt(freshHistories, lastSync);
  if (latestHistoryUpdate) {
    await setLastSyncAt(db, latestHistoryUpdate);
  }

  return { histories: allHistories, users: allUsers };
}

export function syncStaffData(opts?: {
  historyFilter?: string;
  useCache?: boolean;
  includeCccdVersions?: boolean;
  hydrateCache?: boolean;
}) {
  const key = JSON.stringify({
    historyFilter: opts?.historyFilter || "",
    useCache: opts?.useCache ?? true,
    includeCccdVersions: opts?.includeCccdVersions ?? true,
    hydrateCache: opts?.hydrateCache ?? false,
  });
  const recent = staffSyncRecent.get(key);
  if (recent && Date.now() - recent.completedAt < STAFF_SYNC_DEDUPE_TIME) {
    return Promise.resolve(recent.result);
  }
  const pending = staffSyncInFlight.get(key);
  if (pending) return pending;

  const request = syncStaffDataUncached(opts)
    .then((result) => {
      staffSyncRecent.set(key, { completedAt: Date.now(), result });
      return result;
    })
    .finally(() => {
      staffSyncInFlight.delete(key);
    });
  staffSyncInFlight.set(key, request);
  return request;
}

export async function reconcileStaffData(opts: {
  historyFilter?: string;
  includeCccdVersions?: boolean;
}): Promise<void> {
  const db = await openDB();
  const lastFullReconcile = await getLastFullReconcileAt(db);
  const now = Date.now();
  const needsFullReconcile = now - lastFullReconcile > FULL_RECONCILE_INTERVAL_MS;

  // Full reconcile định kỳ để dọn tombstone (record bị xóa khi offline).
  // Delta path nhanh hơn nhưng không phát hiện được xóa cứng.
  if (needsFullReconcile) {
    console.debug("[staff-cache] running full reconcile (scheduled housekeeping)");
    await reconcileStaffDataFull(opts);
    await setLastFullReconcileAt(db, now);
    return;
  }

  // Delta reconcile: chỉ fetch history có updated > lastSync.
  const historyFilter = opts.historyFilter || "";
  const lastSync = await getLastSyncAt(db);
  const deltaFilter = lastSync
    ? combineFilters(historyFilter, `updated>"${lastSync}"`)
    : historyFilter;

  const freshHistories = (await pb.collection("employment_histories").getFullList({
    filter: deltaFilter,
    sort: "-join_date,-created",
    expand: "worker,factory,recruiter_staff,recruiter_partner,main_house,cccd_version",
  })) as unknown as EmploymentHistoryRecord[];

  if (freshHistories.length) {
    await idbPutMany(db, STORE_HISTORIES, freshHistories);
  }

  const expandedUsers = usersFromExpandedHistories(freshHistories);
  const scopeUserIds = [...new Set(freshHistories.map((h) => h.worker).filter(Boolean))];
  const expandedUserIds = new Set(expandedUsers.map((u) => u.id));
  const fetchedUsers = await fetchUsersBatched(
    scopeUserIds.filter((id) => !expandedUserIds.has(id)),
  ).catch(() => [] as WorkerRecord[]);
  const users = [...expandedUsers, ...fetchedUsers];

  if (users.length) {
    await idbPutMany(db, STORE_USERS, users);
  }

  // Factories/houses từ expand
  const factories = [
    ...new Map(
      freshHistories
        .map((history) => history.expand?.factory)
        .filter((factory): factory is FactoryRecord => !!factory?.id)
        .map((factory) => [factory.id, factory]),
    ).values(),
  ];
  const recruitmentEntities = [
    ...new Map(
      freshHistories
        .map((history) => history.expand?.main_house)
        .filter((mainHouse): mainHouse is RecruitmentEntityRecord => !!mainHouse?.id)
        .map((mainHouse) => [mainHouse.id, mainHouse]),
    ).values(),
  ];
  if (factories.length) await idbPutMany(db, STORE_FACTORIES, factories);
  if (recruitmentEntities.length)
    await idbPutMany(db, STORE_RECRUITMENT_ENTITIES, recruitmentEntities);

  if (opts.includeCccdVersions !== false && scopeUserIds.length) {
    const cccdVersions: CccdVersionRecord[] = [];
    for (let i = 0; i < scopeUserIds.length; i += 30) {
      const batch = scopeUserIds.slice(i, i + 30);
      const cccdFilter = lastSync
        ? combineFilters(relationInFilter("worker", batch), `updated>"${lastSync}"`)
        : relationInFilter("worker", batch);
      const items = (await pb
        .collection("cccd_versions")
        .getFullList({
          filter: cccdFilter,
          sort: "-created",
        })
        .catch(() => [])) as unknown as CccdVersionRecord[];
      cccdVersions.push(...items);
    }
    if (cccdVersions.length) {
      await idbPutMany(db, STORE_CCCD_VERSIONS, cccdVersions);
    }
  }

  const allHistories = await idbGetAll<EmploymentHistoryRecord>(db, STORE_HISTORIES);
  await setLastSyncAt(db, getLatestUpdatedAt(allHistories, "1970-01-01 00:00:00.000Z"));
}

async function reconcileStaffDataFull(opts: {
  historyFilter?: string;
  includeCccdVersions?: boolean;
}): Promise<void> {
  const db = await openDB();
  const historyFilter = opts.historyFilter || "";
  const scopedHistories = (await pb.collection("employment_histories").getFullList({
    filter: historyFilter,
    sort: "-join_date,-created",
    expand: "worker,factory,recruiter_staff,recruiter_partner,main_house,cccd_version",
  })) as unknown as EmploymentHistoryRecord[];

  const scopeUserIds = [
    ...new Set(scopedHistories.map((history) => history.worker).filter(Boolean)),
  ];
  const allHistories: EmploymentHistoryRecord[] = [];
  for (let i = 0; i < scopeUserIds.length; i += 30) {
    const batch = scopeUserIds.slice(i, i + 30);
    const items = (await pb.collection("employment_histories").getFullList({
      filter: relationInFilter("worker", batch),
      sort: "-join_date,-created",
      expand: "worker,factory,recruiter_staff,recruiter_partner,main_house,cccd_version",
    })) as unknown as EmploymentHistoryRecord[];
    allHistories.push(...items);
  }

  const historyById = new Map<string, EmploymentHistoryRecord>();
  for (const history of [...scopedHistories, ...allHistories]) historyById.set(history.id, history);
  const histories = [...historyById.values()];
  const expandedUsers = usersFromExpandedHistories(histories);
  const expandedUserIds = new Set(expandedUsers.map((user) => user.id));
  const fetchedUsers = await fetchUsersBatched(
    scopeUserIds.filter((id) => !expandedUserIds.has(id)),
  ).catch(() => [] as WorkerRecord[]);
  const users = [...expandedUsers, ...fetchedUsers];

  await idbReplaceMany(db, STORE_HISTORIES, histories);
  await idbReplaceMany(db, STORE_USERS, users);

  const factories = [
    ...new Map(
      histories
        .map((history) => history.expand?.factory)
        .filter((factory): factory is FactoryRecord => !!factory?.id)
        .map((factory) => [factory.id, factory]),
    ).values(),
  ];
  const recruitmentEntities = [
    ...new Map(
      histories
        .map((history) => history.expand?.main_house)
        .filter((mainHouse): mainHouse is RecruitmentEntityRecord => !!mainHouse?.id)
        .map((mainHouse) => [mainHouse.id, mainHouse]),
    ).values(),
  ];
  if (factories.length) await idbPutMany(db, STORE_FACTORIES, factories);
  if (recruitmentEntities.length)
    await idbPutMany(db, STORE_RECRUITMENT_ENTITIES, recruitmentEntities);

  if (opts.includeCccdVersions !== false) {
    const cccdVersions: CccdVersionRecord[] = [];
    for (let i = 0; i < scopeUserIds.length; i += 30) {
      const batch = scopeUserIds.slice(i, i + 30);
      const items = (await pb
        .collection("cccd_versions")
        .getFullList({
          filter: relationInFilter("worker", batch),
          sort: "-created",
        })
        .catch(() => [])) as unknown as CccdVersionRecord[];
      cccdVersions.push(...items);
    }
    await idbReplaceMany(db, STORE_CCCD_VERSIONS, cccdVersions);
  }

  await setLastSyncAt(db, getLatestUpdatedAt(histories, "1970-01-01 00:00:00.000Z"));
}

export async function updateCachedHistory(record: EmploymentHistoryRecord): Promise<boolean> {
  try {
    const db = await openDB();
    await idbPut(db, STORE_HISTORIES, record);
    return true;
  } catch (error) {
    console.warn("[staff-cache] updateCachedHistory failed", error);
    return false;
  }
}

export async function updateCachedUser(record: WorkerRecord): Promise<boolean> {
  try {
    const db = await openDB();
    await idbPut(db, STORE_USERS, record);
    return true;
  } catch (error) {
    console.warn("[staff-cache] updateCachedUser failed", error);
    return false;
  }
}

export async function updateCachedCccdVersion(record: CccdVersionRecord): Promise<void> {
  try {
    const db = await openDB();
    await idbPut(db, STORE_CCCD_VERSIONS, record);
  } catch {
    // Ignore IndexedDB cache failures.
  }
}

export async function clearStaffCache(): Promise<void> {
  try {
    const db = await openDB();
    await idbClear(db, STORE_HISTORIES);
    await idbClear(db, STORE_USERS);
    await idbClear(db, STORE_CCCD_VERSIONS);
    await idbClear(db, STORE_FACTORIES);
    await idbClear(db, STORE_RECRUITMENT_ENTITIES);
    await idbClear(db, STORE_STAFF_USERS);
    await idbClear(db, STORE_META);
  } catch {
    // Ignore IndexedDB cache failures.
  }
}

export function buildScopeFingerprint(
  viewerId: string,
  managedFactoryIds: Set<string>,
  role = "",
  tenantCompany = "",
): string {
  return [viewerId, role, tenantCompany, ...[...managedFactoryIds].sort()].join("|");
}

export async function isCacheScopeValid(currentFingerprint: string): Promise<boolean> {
  try {
    const db = await openDB();
    const stored = await idbGet<string>(db, STORE_META, "scopeFingerprint");
    return stored === currentFingerprint;
  } catch {
    return false;
  }
}

export async function saveScopeFingerprint(fingerprint: string): Promise<void> {
  try {
    const db = await openDB();
    await idbPut(db, STORE_META, fingerprint, "scopeFingerprint");
  } catch {
    // Ignore IndexedDB cache failures.
  }
}

export async function readCachedAuxData(): Promise<{
  factories: FactoryRecord[];
  recruitmentEntities: RecruitmentEntityRecord[];
  staffUsers: UserRecord[];
} | null> {
  try {
    const db = await openDB();
    const factories = await idbGetAll<FactoryRecord>(db, STORE_FACTORIES);
    const recruitmentEntities = await idbGetAll<RecruitmentEntityRecord>(
      db,
      STORE_RECRUITMENT_ENTITIES,
    );
    const staffUsers = await idbGetAll<UserRecord>(db, STORE_STAFF_USERS);
    if (!factories.length) return null;
    return { factories, recruitmentEntities, staffUsers };
  } catch {
    return null;
  }
}

export async function writeCachedAuxData(data: {
  factories: FactoryRecord[];
  recruitmentEntities: RecruitmentEntityRecord[];
  staffUsers: UserRecord[];
}): Promise<void> {
  try {
    const db = await openDB();
    await idbReplaceMany(db, STORE_FACTORIES, data.factories);
    await idbReplaceMany(db, STORE_RECRUITMENT_ENTITIES, data.recruitmentEntities);
    await idbReplaceMany(db, STORE_STAFF_USERS, data.staffUsers);
  } catch {
    // Ignore IndexedDB cache failures.
  }
}

export async function idbPutManyHistories(items: EmploymentHistoryRecord[]): Promise<void> {
  try {
    const db = await openDB();
    await idbPutMany(db, STORE_HISTORIES, items);
  } catch {
    // Ignore IndexedDB cache failures.
  }
}

export async function deleteCachedHistory(id: string): Promise<void> {
  try {
    const db = await openDB();
    await idbDelete(db, STORE_HISTORIES, id);
  } catch (error) {
    console.warn("[staff-cache] deleteCachedHistory failed", error);
  }
}

export async function deleteCachedUser(id: string): Promise<void> {
  try {
    const db = await openDB();
    await idbDelete(db, STORE_USERS, id);
  } catch (error) {
    console.warn("[staff-cache] deleteCachedUser failed", error);
  }
}

export async function deleteCachedCccdVersion(id: string): Promise<void> {
  try {
    const db = await openDB();
    await idbDelete(db, STORE_CCCD_VERSIONS, id);
  } catch (error) {
    console.warn("[staff-cache] deleteCachedCccdVersion failed", error);
  }
}

export async function deleteCachedFactory(id: string): Promise<void> {
  try {
    const db = await openDB();
    await idbDelete(db, STORE_FACTORIES, id);
  } catch (error) {
    console.warn("[staff-cache] deleteCachedFactory failed", error);
  }
}

export async function deleteCachedRecruitmentEntity(id: string): Promise<void> {
  try {
    const db = await openDB();
    await idbDelete(db, STORE_RECRUITMENT_ENTITIES, id);
  } catch (error) {
    console.warn("[staff-cache] deleteCachedRecruitmentEntity failed", error);
  }
}

export async function readCachedHistory(id: string): Promise<EmploymentHistoryRecord | undefined> {
  try {
    const db = await openDB();
    return await idbGet<EmploymentHistoryRecord>(db, STORE_HISTORIES, id);
  } catch {
    return undefined;
  }
}

export async function readCachedUser(id: string): Promise<WorkerRecord | undefined> {
  try {
    const db = await openDB();
    return await idbGet<WorkerRecord>(db, STORE_USERS, id);
  } catch {
    return undefined;
  }
}

export async function getCachedUserIds(): Promise<Set<string>> {
  try {
    const db = await openDB();
    const histories = await idbGetAll<EmploymentHistoryRecord>(db, STORE_HISTORIES);
    const users = await idbGetAll<WorkerRecord>(db, STORE_USERS);
    const ids = new Set<string>();
    for (const h of histories) if (h.worker) ids.add(h.worker);
    for (const u of users) if (u.id) ids.add(u.id);
    return ids;
  } catch {
    return new Set();
  }
}

export async function upsertCachedHistoryIfNewer(
  record: EmploymentHistoryRecord,
): Promise<boolean> {
  try {
    const db = await openDB();
    const cached = await idbGet<EmploymentHistoryRecord>(db, STORE_HISTORIES, record.id);
    if (cached?.updated && record.updated && cached.updated >= record.updated) return false;
    await idbPut(db, STORE_HISTORIES, record);
    return true;
  } catch (error) {
    console.warn("[staff-cache] upsertCachedHistoryIfNewer failed", error);
    return false;
  }
}

export async function upsertCachedUserIfNewer(record: WorkerRecord): Promise<boolean> {
  try {
    const db = await openDB();
    const cached = await idbGet<WorkerRecord & { updated?: string }>(db, STORE_USERS, record.id);
    const recordUpdated = (record as WorkerRecord & { updated?: string }).updated;
    if (cached?.updated && recordUpdated && cached.updated >= recordUpdated) return false;
    await idbPut(db, STORE_USERS, record);
    return true;
  } catch (error) {
    console.warn("[staff-cache] upsertCachedUserIfNewer failed", error);
    return false;
  }
}

export async function upsertCachedCccdVersionIfNewer(record: CccdVersionRecord): Promise<boolean> {
  try {
    const db = await openDB();
    const cached = await idbGet<CccdVersionRecord>(db, STORE_CCCD_VERSIONS, record.id);
    if (cached?.updated && record.updated && cached.updated >= record.updated) return false;
    await idbPut(db, STORE_CCCD_VERSIONS, record);
    return true;
  } catch (error) {
    console.warn("[staff-cache] upsertCachedCccdVersionIfNewer failed", error);
    return false;
  }
}

export async function updateCachedFactory(record: FactoryRecord): Promise<void> {
  try {
    const db = await openDB();
    await idbPut(db, STORE_FACTORIES, record);
  } catch (error) {
    console.warn("[staff-cache] updateCachedFactory failed", error);
  }
}

export async function updateCachedRecruitmentEntity(
  record: RecruitmentEntityRecord,
): Promise<void> {
  try {
    const db = await openDB();
    await idbPut(db, STORE_RECRUITMENT_ENTITIES, record);
  } catch (error) {
    console.warn("[staff-cache] updateCachedRecruitmentEntity failed", error);
  }
}

export async function factoryExistsInCache(id: string): Promise<boolean> {
  try {
    const db = await openDB();
    const rec = await idbGet<FactoryRecord>(db, STORE_FACTORIES, id);
    return !!rec;
  } catch {
    return false;
  }
}

export async function recruitmentEntityExistsInCache(id: string): Promise<boolean> {
  try {
    const db = await openDB();
    const rec = await idbGet<RecruitmentEntityRecord>(db, STORE_RECRUITMENT_ENTITIES, id);
    return !!rec;
  } catch {
    return false;
  }
}
