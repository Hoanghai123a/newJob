import type { UserRecord } from "./pocketbase";
import type {
  WorkforceDashboardDay,
  WorkforceDashboardResponse,
  WorkforceLookups,
  WorkforceRecruitmentScope,
} from "./workforce-dashboard";

const DB_NAME = "jobconnect-workforce-dashboard";
const DB_VERSION = 1;
const DAYS = "days";
const LOOKUPS = "lookups";
const META = "meta";

type DayRecord = {
  key: string;
  viewerKey: string;
  fingerprint: string;
  scope: WorkforceRecruitmentScope;
  date: string;
  generatedAt: string;
  value: WorkforceDashboardDay;
};
type MetaRecord = { key: string; fingerprint: string };
type LookupRecord = { key: string; value: WorkforceLookups };

function viewerKey(viewer: Pick<UserRecord, "id" | "role">) {
  return `${viewer.id}|${viewer.role || ""}`;
}
function dayKey(
  viewer: Pick<UserRecord, "id" | "role">,
  fingerprint: string,
  scope: WorkforceRecruitmentScope,
  date: string,
) {
  return `${viewerKey(viewer)}|${fingerprint}|${scope}|${date}`;
}
function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DAYS)) db.createObjectStore(DAYS, { keyPath: "key" });
      if (!db.objectStoreNames.contains(LOOKUPS)) db.createObjectStore(LOOKUPS, { keyPath: "key" });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function requestValue<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function readWorkforceDayCache(
  viewer: Pick<UserRecord, "id" | "role">,
  scope: WorkforceRecruitmentScope,
  dates: string[],
) {
  try {
    const db = await openDb();
    const metaTx = db.transaction(META, "readonly");
    const meta = (await requestValue(metaTx.objectStore(META).get(viewerKey(viewer)))) as
      | MetaRecord
      | undefined;
    if (!meta?.fingerprint)
      return { fingerprint: "", days: [] as WorkforceDashboardDay[], generatedAt: "" };
    const tx = db.transaction(DAYS, "readonly");
    const store = tx.objectStore(DAYS);
    const records = await Promise.all(
      dates.map(
        (date) =>
          requestValue(store.get(dayKey(viewer, meta.fingerprint, scope, date))) as Promise<
            DayRecord | undefined
          >,
      ),
    );
    const found = records.filter((record): record is DayRecord => Boolean(record));
    return {
      fingerprint: meta.fingerprint,
      days: found.map((record) => record.value).sort((a, b) => a.date.localeCompare(b.date)),
      generatedAt: found.reduce(
        (latest, record) => (record.generatedAt > latest ? record.generatedAt : latest),
        "",
      ),
    };
  } catch {
    return { fingerprint: "", days: [] as WorkforceDashboardDay[], generatedAt: "" };
  }
}

export async function writeWorkforceDayCache(
  viewer: Pick<UserRecord, "id" | "role">,
  response: WorkforceDashboardResponse,
) {
  const db = await openDb();
  const tx = db.transaction([DAYS, META], "readwrite");
  const key = viewerKey(viewer);
  tx.objectStore(META).put({ key, fingerprint: response.scopeFingerprint } satisfies MetaRecord);
  const store = tx.objectStore(DAYS);
  for (const day of response.days) {
    store.put({
      key: dayKey(viewer, response.scopeFingerprint, response.scope, day.date),
      viewerKey: key,
      fingerprint: response.scopeFingerprint,
      scope: response.scope,
      date: day.date,
      generatedAt: response.generatedAt,
      value: day,
    } satisfies DayRecord);
  }
  await transactionDone(tx);
}

export async function readWorkforceLookupCache(viewer: Pick<UserRecord, "id" | "role">) {
  try {
    const db = await openDb();
    const metaTx = db.transaction(META, "readonly");
    const meta = (await requestValue(metaTx.objectStore(META).get(viewerKey(viewer)))) as
      | MetaRecord
      | undefined;
    if (!meta?.fingerprint) return null;
    const tx = db.transaction(LOOKUPS, "readonly");
    const record = (await requestValue(
      tx.objectStore(LOOKUPS).get(`${viewerKey(viewer)}|${meta.fingerprint}`),
    )) as LookupRecord | undefined;
    return record?.value || null;
  } catch {
    return null;
  }
}

export async function writeWorkforceLookupCache(
  viewer: Pick<UserRecord, "id" | "role">,
  lookups: WorkforceLookups,
) {
  const db = await openDb();
  const tx = db.transaction([LOOKUPS, META], "readwrite");
  const key = viewerKey(viewer);
  tx.objectStore(META).put({ key, fingerprint: lookups.scopeFingerprint } satisfies MetaRecord);
  tx.objectStore(LOOKUPS).put({
    key: `${key}|${lookups.scopeFingerprint}`,
    value: lookups,
  } satisfies LookupRecord);
  await transactionDone(tx);
}
