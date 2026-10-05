import { pb } from "./pocketbase";

export type UidCounterType = "user" | "employment_history";

export interface AllocateUidResponse {
  type: UidCounterType;
  prefix: string;
  period: string;
  startValue: number;
  endValue: number;
  uids: string[];
}

async function requestCounter(body: Record<string, unknown>) {
  const response = await fetch("/api/uid-counter", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(pb.authStore.token ? { Authorization: `Bearer ${pb.authStore.token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || "Không cấp được UID.");
  return payload;
}

export function isUniqueConstraintError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /value must be unique/i.test(msg) || /unique.*constraint/i.test(msg);
}

export async function allocateUserUids(count = 1, opts?: { forceScan?: boolean }): Promise<string[]> {
  const result = (await requestCounter({
    action: "allocate",
    type: "user",
    count,
    ...(opts?.forceScan ? { forceScan: true } : {}),
  })) as AllocateUidResponse;
  return result.uids;
}

export async function allocateEmploymentHistoryUids(
  count = 1,
  referenceDate = new Date(),
  opts?: { forceScan?: boolean },
): Promise<string[]> {
  const result = (await requestCounter({
    action: "allocate",
    type: "employment_history",
    count,
    referenceDate: referenceDate.toISOString(),
    ...(opts?.forceScan ? { forceScan: true } : {}),
  })) as AllocateUidResponse;
  return result.uids;
}

export async function observeManualUid(
  type: UidCounterType,
  uid: string,
  referenceDate = new Date(),
) {
  await requestCounter({
    action: "observe",
    type,
    uid,
    referenceDate: referenceDate.toISOString(),
  });
}
