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

async function fetchAppSettingsRecordUncached(
  companyId?: string,
): Promise<CachedAppSettingsRecord> {
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

// ---------------------------------------------------------------------------
// Logo hệ thống (dùng khi không có company ID): đọc file tĩnh trong public/icons
// thay vì mượn app_settings của một tenant bất kỳ.
// ---------------------------------------------------------------------------

const SYSTEM_ICON_CONTENT_TYPES: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export type SystemIconFile = { buffer: Buffer; contentType: string; version: string };

async function systemIconDir() {
  const path = await import("path");
  return path.join(process.cwd(), "public", "icons");
}

/**
 * Đọc file logo hệ thống mới nhất trong danh sách ứng viên (theo mtime),
 * để bản upload mới không bị file cũ khác extension che mất.
 */
export async function readNewestSystemIcon(fileNames: string[]): Promise<SystemIconFile | null> {
  const fs = await import("fs/promises");
  const path = await import("path");
  const dir = await systemIconDir();

  let best: (SystemIconFile & { mtimeMs: number }) | null = null;
  for (const name of fileNames) {
    const filePath = path.join(dir, name);
    try {
      const stat = await fs.stat(filePath);
      if (best && stat.mtimeMs <= best.mtimeMs) continue;
      const buffer = await fs.readFile(filePath);
      const ext = path.extname(name).toLowerCase();
      best = {
        buffer,
        contentType: SYSTEM_ICON_CONTENT_TYPES[ext] || "application/octet-stream",
        version: `${Math.round(stat.mtimeMs)}-${stat.size}`,
        mtimeMs: stat.mtimeMs,
      };
    } catch {
      continue;
    }
  }

  if (!best) return null;
  return { buffer: best.buffer, contentType: best.contentType, version: best.version };
}

/** Phiên bản logo hệ thống (mtime lớn nhất) dùng để cache-busting trong manifest. */
export async function getSystemIconVersion(fileNames: string[]): Promise<string> {
  const fs = await import("fs/promises");
  const path = await import("path");
  const dir = await systemIconDir();

  let newest = 0;
  for (const name of fileNames) {
    try {
      const stat = await fs.stat(path.join(dir, name));
      if (stat.mtimeMs > newest) newest = stat.mtimeMs;
    } catch {
      continue;
    }
  }
  return newest ? Math.round(newest).toString() : Date.now().toString();
}

/**
 * Trả về response cho logo hệ thống với ETag + no-cache để trình duyệt luôn
 * revalidate (304 khi chưa đổi), tránh giữ logo cũ tới 5 phút.
 */
export function systemIconResponse(
  request: Request,
  icon: { buffer: Buffer | string; contentType: string; version: string },
) {
  const etag = `"sys-${icon.version}"`;
  const headers = {
    "Content-Type": icon.contentType,
    "Cache-Control": "no-cache, must-revalidate",
    ETag: etag,
  };

  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }

  const body =
    typeof icon.buffer === "string" ? icon.buffer : new Uint8Array(icon.buffer);
  return new Response(body, { status: 200, headers });
}

