import { relationInFilter } from "./delegations";
import { getPBUpstream } from "./pocketbase-config";
import type { UserRecord } from "./pocketbase";
import {
  aggregateWorkforceDays,
  shiftWorkforceDate,
  validateWorkforceRange,
  type WorkforceDashboardResponse,
  type WorkforceHistoryInput,
  type WorkforceLookups,
  type WorkforceRecruitmentScope,
} from "./workforce-dashboard";

type PbList<T> = { page?: number; totalPages?: number; items?: T[] };
type Manager = {
  factory: string;
  status?: string;
  active_from?: string;
  active_to?: string;
  updated?: string;
};
type LookupRecord = {
  id: string;
  name?: string;
  full_name?: string;
  username?: string;
  updated?: string;
};

function escapePb(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
function bearerToken(request: Request) {
  return /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") || "")?.[1] || "";
}
function jsonError(message: string, status = 400) {
  return Response.json({ message }, { status });
}
async function readJson(response: Response) {
  return response.json().catch(() => null);
}
async function pbFetch(path: string, token: string) {
  return fetch(`${getPBUpstream()}${path}`, {
    headers: { Authorization: `Bearer ${token}`, "ngrok-skip-browser-warning": "true" },
  });
}
async function authenticate(request: Request) {
  const token = bearerToken(request);
  if (!token) return null;
  const response = await fetch(`${getPBUpstream()}/api/collections/users/auth-refresh`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "ngrok-skip-browser-warning": "true" },
  });
  const body = await readJson(response);
  const user = body?.record as UserRecord | undefined;
  return response.ok && user?.id && (user.role === "admin" || user.role === "staff")
    ? { token, user }
    : null;
}
async function fullList<T>(collection: string, params: Record<string, string>, token: string) {
  const output: T[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const query = new URLSearchParams({ page: String(page), perPage: "500", ...params });
    const response = await pbFetch(`/api/collections/${collection}/records?${query}`, token);
    if (!response.ok) throw new Error(`Không tải được dữ liệu ${collection}.`);
    const body = (await readJson(response)) as PbList<T> | null;
    output.push(...(body?.items || []));
    totalPages = Math.max(1, Number(body?.totalPages || 1));
    page += 1;
  } while (page <= totalPages);
  return output;
}
function managerActive(row: Manager, now = Date.now()) {
  if (row.status === "inactive") return false;
  const from = row.active_from ? Date.parse(row.active_from) : -Infinity;
  const to = row.active_to ? Date.parse(row.active_to) : Infinity;
  return (Number.isNaN(from) || from <= now) && (Number.isNaN(to) || to >= now);
}
async function context(request: Request) {
  const auth = await authenticate(request);
  if (!auth) return null;
  const managers =
    auth.user.role === "staff"
      ? await fullList<Manager>(
          "factory_managers",
          {
            filter: `staff="${escapePb(auth.user.id)}"`,
            fields: "factory,status,active_from,active_to,updated",
          },
          auth.token,
        )
      : [];
  const active = managers.filter((row) => managerActive(row));
  const factoryIds = [...new Set(active.map((row) => row.factory))];
  const fingerprint = [
    auth.user.id,
    auth.user.role,
    ...active.map((row) => `${row.factory}:${row.updated || ""}`).sort(),
  ].join("|");
  return { ...auth, factoryIds, fingerprint };
}
function permissionFilter(user: UserRecord, factoryIds: string[]) {
  if (user.role === "admin") return "";
  const filters = [`recruiter_staff="${escapePb(user.id)}"`];
  if (factoryIds.length) filters.unshift(`(${relationInFilter("factory", factoryIds)})`);
  return `(${filters.join(" || ")})`;
}
function sourceFilter(scope: WorkforceRecruitmentScope) {
  return scope === "internal"
    ? 'recruiter_staff!=""'
    : scope === "partner"
      ? 'recruiter_partner!=""'
      : "";
}
function historyFilter(from: string, to: string, permission: string, source: string) {
  const exclusiveTo = shiftWorkforceDate(to, 1);
  return [
    `join_date<"${exclusiveTo}"`,
    `(leave_date="" || leave_date>="${from}")`,
    permission,
    source,
  ]
    .filter(Boolean)
    .map((p) => `(${p})`)
    .join(" && ");
}
async function firstHistoryIds(
  rows: WorkforceHistoryInput[],
  permission: string,
  source: string,
  token: string,
) {
  const userIds = [...new Set(rows.filter((row) => row.join_date).map((row) => row.user))];
  if (!userIds.length) return new Set<string>();
  const all: { id: string; worker: string; join_date: string; created?: string }[] = [];
  for (let index = 0; index < userIds.length; index += 40) {
    const users = relationInFilter("worker", userIds.slice(index, index + 40));
    all.push(
      ...(await fullList<{ id: string; worker: string; join_date: string; created?: string }>(
        "employment_histories",
        {
          filter: [permission, source, `(${users})`].filter(Boolean).join(" && "),
          fields: "id,worker,join_date,created",
          sort: "join_date,created",
        },
        token,
      )),
    );
  }
  const mapped: WorkforceHistoryInput[] = all.map((h) => ({ ...h, user: h.worker }));
  const first = new Map<string, WorkforceHistoryInput>();
  for (const row of mapped) if (!first.has(row.user)) first.set(row.user, row);
  return new Set([...first.values()].map((row) => row.id));
}

export async function handleWorkforceDashboard(request: Request) {
  try {
    const ctx = await context(request);
    if (!ctx) return jsonError("Phiên đăng nhập không hợp lệ.", 401);
    const url = new URL(request.url);
    const from = url.searchParams.get("from") || "";
    const to = url.searchParams.get("to") || "";
    const scope = (url.searchParams.get("scope") || "all") as WorkforceRecruitmentScope;
    if (!["all", "internal", "partner"].includes(scope))
      return jsonError("Nguồn tuyển không hợp lệ.");
    const rangeError = validateWorkforceRange(from, to);
    if (rangeError) return jsonError(rangeError);
    const permission = permissionFilter(ctx.user, ctx.factoryIds);
    const rawHistories = await fullList<{ worker: string; [key: string]: unknown }>(
      "employment_histories",
      {
        filter: historyFilter(from, to, permission, sourceFilter(scope)),
        expand: "worker,factory,main_house,recruiter_staff,recruiter_partner",
        fields:
          "id,worker,factory,main_house,employee_code,worker_name_snapshot,recruiter_staff,recruiter_partner,join_date,leave_date,created,updated,expand.worker.id,expand.worker.full_name,expand.worker.username,expand.factory.id,expand.factory.name,expand.main_house.id,expand.main_house.name,expand.recruiter_staff.id,expand.recruiter_staff.full_name,expand.recruiter_staff.username,expand.recruiter_partner.id,expand.recruiter_partner.name",
        sort: "join_date,created",
      },
      ctx.token,
    );
    const histories: WorkforceHistoryInput[] = rawHistories.map((h) => ({
      ...h,
      user: h.worker,
      expand: h.expand
        ? {
            ...h.expand,
            user: (h.expand as { worker?: unknown }).worker as
              | { full_name?: string; username?: string }
              | undefined,
          }
        : undefined,
    })) as WorkforceHistoryInput[];
    const firstIds = await firstHistoryIds(
      histories.filter((row) => row.join_date.slice(0, 10) >= from),
      permission,
      sourceFilter(scope),
      ctx.token,
    );
    const payload: WorkforceDashboardResponse = {
      from,
      to,
      scope,
      generatedAt: new Date().toISOString(),
      scopeFingerprint: ctx.fingerprint,
      days: aggregateWorkforceDays({ histories, from, to, scope, firstHistoryIds: firstIds }),
    };
    return Response.json(payload);
  } catch (error) {
    console.error("[workforce-dashboard]", error);
    return jsonError("Không tải được dữ liệu nhân lực.", 502);
  }
}

export async function handleWorkforceLookups(request: Request) {
  try {
    const ctx = await context(request);
    if (!ctx) return jsonError("Phiên đăng nhập không hợp lệ.", 401);
    const [factories, staff, partners] = await Promise.all([
      fullList<LookupRecord>("factories", { fields: "id,name", sort: "name" }, ctx.token),
      fullList<LookupRecord>(
        "users",
        {
          filter: '(role="staff" || role="admin")',
          fields: "id,full_name,username",
          sort: "full_name,username",
        },
        ctx.token,
      ),
      fullList<LookupRecord>(
        "recruitment_entities",
        { filter: '(status="active" || status="")', fields: "id,name", sort: "name" },
        ctx.token,
      ),
    ]);
    const visibleFactories =
      ctx.user.role === "admin" || ctx.factoryIds.length === 0
        ? factories
        : factories.filter((row) => ctx.factoryIds.includes(row.id));
    const payload: WorkforceLookups = {
      factories: visibleFactories.map((row) => ({ id: row.id, name: row.name || "Chưa xác định" })),
      recruiters: [
        ...staff.map((row) => ({
          id: row.id,
          name: row.full_name || row.username || "Chưa xác định",
          source: "internal" as const,
        })),
        ...partners.map((row) => ({
          id: row.id,
          name: row.name || "Chưa xác định",
          source: "partner" as const,
        })),
      ],
      generatedAt: new Date().toISOString(),
      scopeFingerprint: ctx.fingerprint,
    };
    return Response.json(payload);
  } catch (error) {
    console.error("[workforce-lookups]", error);
    return jsonError("Không tải được danh mục nhân lực.", 502);
  }
}
