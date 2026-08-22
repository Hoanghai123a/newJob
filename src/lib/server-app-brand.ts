import { getPBUpstream } from "@/lib/pocketbase-config";

export type AppSettingsRecord = {
  id?: string;
  collectionId?: string;
  collectionName?: string;
  tenant_company?: string;
  company_name?: string;
  slogan?: string;
  logo?: string;
  updated?: string;
};

type ListResponse = {
  items?: AppSettingsRecord[];
};

type CachedAppSettingsRecord = { upstream: string; item: AppSettingsRecord } | null;

const CACHE_SUCCESS_MS = 60 * 1000;
const CACHE_FAILURE_MS = 15 * 1000;
const cache = new Map<string, { value: CachedAppSettingsRecord; expiresAt: number }>();
const pendingFetches = new Map<string, Promise<CachedAppSettingsRecord>>();

function normalizeUpstream(url: string) {
  return url.replace(/\/+$/, "");
}

function cacheKey(companyId?: string) {
  return companyId?.trim() || "default";
}

function escapePb(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export async function fetchAppSettingsRecord(companyId?: string) {
  const key = cacheKey(companyId);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;

  const pending = pendingFetches.get(key);
  if (pending) return pending;

  const request = fetchAppSettingsRecordUncached(companyId).then(
    (value) => {
      cache.set(key, {
        value,
        expiresAt: Date.now() + (value ? CACHE_SUCCESS_MS : CACHE_FAILURE_MS),
      });
      pendingFetches.delete(key);
      return value;
    },
    (error) => {
      cache.set(key, { value: null, expiresAt: Date.now() + CACHE_FAILURE_MS });
      pendingFetches.delete(key);
      throw error;
    },
  );
  pendingFetches.set(key, request);
  return request;
}

async function fetchAppSettingsRecordUncached(companyId?: string): Promise<CachedAppSettingsRecord> {
  const upstream = normalizeUpstream(getPBUpstream());
  const filter = companyId?.trim()
    ? `&filter=${encodeURIComponent(`tenant_company = "${escapePb(companyId)}"`)}`
    : "";
  const res = await fetch(
    `${upstream}/api/collections/app_settings/records?page=1&perPage=1&sort=-updated${filter}`,
    { headers: { "ngrok-skip-browser-warning": "true" } },
  );
  if (!res.ok) return null;

  const json = (await res.json().catch(() => null)) as ListResponse | null;
  const item = json?.items?.[0];
  if (!item?.id) return null;

  return { upstream, item };
}

export function buildPocketBaseFileUrl(params: {
  upstream: string;
  collectionIdOrName: string;
  recordId: string;
  fileName: string;
}) {
  const { upstream, collectionIdOrName, recordId, fileName } = params;
  return `${upstream}/api/files/${encodeURIComponent(collectionIdOrName)}/${encodeURIComponent(recordId)}/${encodeURIComponent(fileName)}`;
}

export function getAppLogoFileUrl(app: NonNullable<CachedAppSettingsRecord>) {
  if (!app.item.logo || !app.item.id) return null;

  return buildPocketBaseFileUrl({
    upstream: app.upstream,
    collectionIdOrName: app.item.collectionId || app.item.collectionName || "app_settings",
    recordId: app.item.id,
    fileName: app.item.logo,
  });
}
