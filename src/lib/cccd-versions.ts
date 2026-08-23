import { pb, type UserRecord } from "./pocketbase";
import { updateCachedCccdVersion } from "./staff-cache";
import { relationInFilter } from "./delegations";
import { companyFilter, companyPayload, joinTenantFilters } from "./tenant";
import { getWorker } from "./workers";

export const VALID_CCCD_LENGTHS = new Set([9, 12]);

function tenantUser() {
  return pb.authStore.record as UserRecord | null;
}

export function normalizeCccdNumber(value?: string | null) {
  return String(value ?? "").replace(/\D/g, "");
}

export function requireValidCccdNumber(value?: string | null) {
  const normalized = normalizeCccdNumber(value);
  if (!VALID_CCCD_LENGTHS.has(normalized.length)) {
    throw new Error("Số CMND/CCCD phải có đúng 9 hoặc 12 chữ số.");
  }
  return normalized;
}

export interface CccdVersionRecord {
  id: string;
  tenant_company: string;
  user?: string;
  worker: string;
  cccd_number: string;
  front_image?: string;
  back_image?: string;
  is_current: boolean;
  note?: string;
  created?: string;
  updated?: string;
  collectionId?: string;
  collectionName?: string;
}

export async function getCurrentCccdVersion(workerId: string): Promise<CccdVersionRecord | null> {
  try {
    const record = (await pb.collection("cccd_versions").getFirstListItem(joinTenantFilters(tenantUser(), `worker="${workerId}" && is_current=true`))) as unknown as CccdVersionRecord;
    return { ...record, user: record.worker } as CccdVersionRecord;
  } catch {
    return null;
  }
}

export async function getCccdVersionByNumber(
  userId: string,
  cccdNumber: string,
): Promise<CccdVersionRecord | null> {
  const normalized = normalizeCccdNumber(cccdNumber);
  if (!userId || !normalized) return null;
  try {
    const records = (await pb.collection("cccd_versions").getFullList({
      filter: joinTenantFilters(tenantUser(), `worker="${userId}"`),
      sort: "-updated,-created",
    })) as unknown as CccdVersionRecord[];
    const found = records.find((version) => normalizeCccdNumber(version.cccd_number) === normalized) || null;
    return found ? ({ ...found, user: found.worker } as CccdVersionRecord) : null;
  } catch {
    return null;
  }
}

async function resolveCccdWorkerId(workerId: string) {
  if (!workerId) throw new Error("Thiếu hồ sơ NLĐ để tạo phiên bản CCCD.");
  const worker = await getWorker(workerId).catch(() => null);
  if (!worker?.id) throw new Error("Không tìm thấy hồ sơ NLĐ.");
  return worker.id;
}

function isUniqueConflict(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  const response =
    typeof error === "object" && error !== null && "response" in error
      ? (error as { response?: { message?: string; data?: Record<string, unknown> } }).response
      : undefined;
  return /unique|already exists|đã tồn tại/i.test(
    [message, response?.message, JSON.stringify(response?.data || {})].filter(Boolean).join(" "),
  );
}

/** Bảo đảm cặp người dùng + số CCCD luôn có đúng một phiên bản. */
export async function ensureCccdVersion(
  userId: string,
  cccdNumber: string,
): Promise<CccdVersionRecord> {
  if (!userId) throw new Error("Thiếu người lao động để tạo phiên bản CCCD.");
  const workerId = await resolveCccdWorkerId(userId);
  const normalized = requireValidCccdNumber(cccdNumber);
  const existing = await getCccdVersionByNumber(workerId, normalized);
  if (existing) {
    await updateCachedCccdVersion(existing);
    return existing;
  }

  const currentVersion = await getCurrentCccdVersion(workerId);
  if (currentVersion && normalizeCccdNumber(currentVersion.cccd_number) !== normalized) {
    await updateCccdVersionAndCache(currentVersion.id, { is_current: false });
  }

  try {
    const created = ({ ...(await pb.collection("cccd_versions").create({
      ...companyPayload(tenantUser()),
      worker: userId,
      cccd_number: normalized,
      is_current: true,
    })) as unknown as CccdVersionRecord, user: workerId });
    await updateCachedCccdVersion(created);
    return created;
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const concurrent = await getCccdVersionByNumber(workerId, normalized);
    if (!concurrent) throw error;
    await updateCachedCccdVersion(concurrent);
    return concurrent;
  }
}

export async function assertCccdVersionMatches(
  versionId: string,
  userId: string,
  cccdNumber: string,
): Promise<CccdVersionRecord> {
  const normalized = requireValidCccdNumber(cccdNumber);
  const workerId = await resolveCccdWorkerId(userId);
  const version = (await pb
    .collection("cccd_versions")
    .getOne(versionId)) as unknown as CccdVersionRecord;
  if (version.worker !== workerId || normalizeCccdNumber(version.cccd_number) !== normalized) {
    throw new Error("Phiên bản CCCD không khớp người lao động hoặc số CCCD của lịch sử.");
  }
  return version;
}

export async function findOrCreateCccdVersion(
  userId: string,
  cccdNumber: string,
  frontFile?: File | null,
  backFile?: File | null,
): Promise<CccdVersionRecord> {
  const version = await ensureCccdVersion(userId, cccdNumber);
  if (!frontFile && !backFile) return version;
  return updateCccdVersionImages(version.id, frontFile, backFile);
}

export async function updateCccdVersionImages(
  versionId: string,
  frontFile?: File | null,
  backFile?: File | null,
): Promise<CccdVersionRecord> {
  const fd = new FormData();
  if (frontFile) fd.append("front_image", frontFile);
  if (backFile) fd.append("back_image", backFile);

  return updateCccdVersionAndCache(versionId, fd);
}

export async function updateCccdVersionAndCache(
  versionId: string,
  payload: Record<string, unknown> | FormData,
): Promise<CccdVersionRecord> {
  const updated = (await pb
    .collection("cccd_versions")
    .update(versionId, payload)) as unknown as CccdVersionRecord;
  await updateCachedCccdVersion(updated);
  return updated;
}

export async function fetchCccdVersionsByIds(ids: string[]): Promise<CccdVersionRecord[]> {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (!uniqueIds.length) return [];

  const items: CccdVersionRecord[] = [];
  for (let i = 0; i < uniqueIds.length; i += 50) {
    const batch = uniqueIds.slice(i, i + 50);
    const records = (await pb.collection("cccd_versions").getFullList({
      filter: joinTenantFilters(tenantUser(), relationInFilter("id", batch)),
      sort: "-updated,-created",
    })) as unknown as CccdVersionRecord[];
    items.push(...records);
  }
  return items;
}

export async function fetchCccdVersionsByUser(userId: string): Promise<CccdVersionRecord[]> {
  return (await pb.collection("cccd_versions").getFullList({
    filter: joinTenantFilters(tenantUser(), `worker="${userId}"`),
    sort: "-created",
  })) as unknown as CccdVersionRecord[];
}

export async function fetchCccdVersionsByUsers(
  userIds: string[],
  signal?: AbortSignal,
): Promise<CccdVersionRecord[]> {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (!uniqueIds.length) return [];

  const items: CccdVersionRecord[] = [];
  for (let i = 0; i < uniqueIds.length; i += 50) {
    signal?.throwIfAborted();
    const batch = uniqueIds.slice(i, i + 50);
    const records = (await pb.collection("cccd_versions").getFullList({
      filter: joinTenantFilters(tenantUser(), relationInFilter("user", batch)),
      sort: "-updated,-created",
      signal,
    })) as unknown as CccdVersionRecord[];
    items.push(...records);
  }
  return items;
}
