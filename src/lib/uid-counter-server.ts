import { getPBUpstream } from "./pocketbase-config";

export type UidCounterType = "user" | "employment_history";

type AuthUser = { id: string; role?: string; tenant_company?: string };
type CounterRecord = {
  id: string;
  counter_key: string;
  counter_type: UidCounterType;
  prefix: string;
  period?: string;
  current_value: number;
  tenant_company?: string;
};

type AllocateBody = {
  action?: "allocate" | "observe";
  type?: UidCounterType;
  count?: number;
  referenceDate?: string;
  uid?: string;
  actorId?: string;
};

const locks = new Map<string, Promise<void>>();
let cachedAdminToken = "";
let cachedAdminTokenExpiry = 0;

type AdminAuthResult =
  | { ok: true; token: string }
  | { ok: false; reason: "missing_config" | "unreachable" | "invalid_credentials" };

function env(name: string) {
  const value = typeof process !== "undefined" ? process.env[name] || "" : "";
  return value || (import.meta.env as Record<string, string | undefined>)?.[name] || "";
}

function escapePb(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// PocketBase JWT tokens hết hạn (mặc định 24h). Đọc exp để chủ động cấp lại
// trước khi hết hạn, tránh lỗi 500 do dùng token quản trị đã hết hạn từ cache.
function jwtExpiry(token: string): number {
  try {
    const payload = token.split(".")[1];
    if (!payload) return 0;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(
      typeof atob === "function"
        ? atob(normalized)
        : Buffer.from(normalized, "base64").toString("utf-8"),
    );
    return typeof decoded?.exp === "number" ? decoded.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

function cachedAdminTokenValid() {
  if (!cachedAdminToken) return false;
  // Cấp lại nếu còn dưới 60s hoặc không đọc được exp (0 -> coi như cần làm mới).
  return cachedAdminTokenExpiry > Date.now() + 60_000;
}

async function pbFetch(path: string, init: RequestInit = {}, token?: string) {
  const headers = new Headers(init.headers);
  headers.set("ngrok-skip-browser-warning", "true");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${getPBUpstream()}${path}`, { ...init, headers });
}

async function readJson(response: Response) {
  return response.json().catch(() => null);
}

function jsonError(message: string, status = 400) {
  return Response.json({ message }, { status });
}

function bearerToken(request: Request) {
  return /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") || "")?.[1] || "";
}

async function getAuthUser(request: Request): Promise<AuthUser | null> {
  const token = bearerToken(request);
  if (!token) return null;
  try {
    const response = await pbFetch(
      "/api/collections/users/auth-refresh",
      { method: "POST" },
      token,
    );
    if (!response.ok) return null;
    const body = await readJson(response);
    return body?.record?.id ? (body.record as AuthUser) : null;
  } catch (error) {
    console.error("[uid-counter] getAuthUser failed:", error);
    return null;
  }
}

async function getAdminToken(): Promise<AdminAuthResult> {
  if (cachedAdminTokenValid()) return { ok: true, token: cachedAdminToken };
  const direct = env("PB_ADMIN_TOKEN");
  if (direct) {
    cachedAdminToken = direct;
    cachedAdminTokenExpiry = jwtExpiry(direct);
    return { ok: true, token: cachedAdminToken };
  }

  const identity = env("PB_ADMIN_EMAIL");
  const password = env("PB_ADMIN_PASSWORD");
  if (!identity || !password) return { ok: false, reason: "missing_config" };

  for (const path of [
    "/api/collections/_superusers/auth-with-password",
    "/api/admins/auth-with-password",
  ]) {
    try {
      const response = await pbFetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity, password }),
      });
      const body = await readJson(response);
      if (response.ok && body?.token) {
        cachedAdminToken = body.token;
        cachedAdminTokenExpiry = jwtExpiry(body.token);
        return { ok: true, token: cachedAdminToken };
      }
    } catch {
      return { ok: false, reason: "unreachable" };
    }
  }

  return { ok: false, reason: "invalid_credentials" };
}

function adminAuthError(reason: Exclude<AdminAuthResult, { ok: true }>["reason"]) {
  if (reason === "missing_config") {
    return jsonError("Máy chủ thiếu cấu hình quản trị PocketBase.", 424);
  }
  if (reason === "unreachable") {
    return jsonError("Máy chủ không kết nối được PocketBase.", 503);
  }
  return jsonError("Thông tin đăng nhập quản trị PocketBase không hợp lệ.", 424);
}

async function withCounterLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => (release = resolve));
  const queued = previous.then(() => current);
  locks.set(key, queued);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (locks.get(key) === queued) locks.delete(key);
  }
}

async function getPrefix(companyId: string, token: string) {
  try {
    const params = new URLSearchParams({
      page: "1",
      perPage: "20",
      filter: `tenant_company="${escapePb(companyId)}"`,
      fields: "account_code_prefix",
    });
    const response = await pbFetch(`/api/collections/app_settings/records?${params}`, {}, token);
    if (!response.ok) {
      throw new Error(
        `Không đọc được tiền tố UID từ PocketBase. ` +
          `Kiểm tra collection app_settings có bản ghi với tenant_company="${companyId}".`,
      );
    }
    const body = await readJson(response);
    const rows: Array<{ account_code_prefix?: string }> = body?.items || [];

    // Nếu không tìm thấy app_settings nào
    if (rows.length === 0) {
      console.error(
        `[uid-counter] Công ty ${companyId} chưa có app_settings với tenant_company. ` +
          `Dùng prefix mặc định "TEMP".`,
      );
      return "TEMP";
    }

    // A company may have more than one app_settings row; prefer the one that
    // actually defines a prefix, else fall back to the first row.
    const withPrefix = rows.find((r) => String(r.account_code_prefix || "").trim() !== "");
    return String((withPrefix ?? rows[0])?.account_code_prefix || "")
      .trim()
      .toUpperCase();
  } catch (error) {
    console.error(`[uid-counter] getPrefix failed for company ${companyId}:`, error);
    throw new Error(
      `Không kết nối được PocketBase để lấy tiền tố UID. ` +
        `Chi tiết: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function counterMeta(
  type: UidCounterType,
  companyId: string,
  prefix: string,
  referenceDate?: string,
) {
  if (type === "user") return { key: `${companyId}:user:${prefix}`, period: "", limit: 999_999 };
  const date = referenceDate ? new Date(referenceDate) : new Date();
  if (Number.isNaN(date.getTime())) throw new Error("Ngày tham chiếu cấp UID không hợp lệ.");
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  return {
    key: `${companyId}:employment_history:${prefix}:${year}${String(month).padStart(2, "0")}`,
    period: `${year}${String(month).padStart(2, "0")}`,
    limit: 9_999,
  };
}

function formatUid(type: UidCounterType, prefix: string, period: string, value: number) {
  if (type === "user") return `${prefix}${String(value).padStart(6, "0")}`;
  return `${prefix}${period.slice(2, 4)}${period.slice(4, 6)}${String(value).padStart(4, "0")}`;
}

async function getCounter(key: string, token: string): Promise<CounterRecord | null> {
  const params = new URLSearchParams({
    page: "1",
    perPage: "1",
    filter: `counter_key="${escapePb(key)}"`,
  });
  const response = await pbFetch(`/api/collections/uid_counters/records?${params}`, {}, token);
  if (response.status === 404) throw new Error("PocketBase chưa có collection uid_counters.");
  if (!response.ok) throw new Error("Không đọc được bộ đếm UID.");
  return ((await readJson(response))?.items?.[0] as CounterRecord | undefined) || null;
}

async function scanMaximum(
  type: UidCounterType,
  companyId: string,
  prefix: string,
  period: string,
  token: string,
) {
  const collection = type === "user" ? "users" : "employment_histories";
  const buildUrl = (page: number) => {
    const params = new URLSearchParams({
      page: String(page),
      perPage: "500",
      fields: "uid",
      filter: `tenant_company="${escapePb(companyId)}"`,
    });
    return `/api/collections/${collection}/records?${params}`;
  };
  const response = await pbFetch(buildUrl(1), {}, token);
  if (!response.ok) throw new Error("Không thể khởi tạo bộ đếm từ dữ liệu UID hiện tại.");
  const body = await readJson(response);
  const totalPages = Math.max(1, Number(body?.totalPages || 1));
  let max = 0;
  const inspect = (items: Array<{ uid?: string }>) => {
    const pattern =
      type === "user"
        ? new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d{6})$`)
        : new RegExp(
            `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${period.slice(2, 6)}(\\d{4})$`,
          );
    for (const item of items || []) {
      const match = String(item.uid || "").match(pattern);
      if (match) max = Math.max(max, Number(match[1]));
    }
  };
  inspect(body?.items || []);
  for (let page = 2; page <= totalPages; page += 1) {
    const next = await pbFetch(buildUrl(page), {}, token);
    if (!next.ok) throw new Error("Không thể quét đầy đủ UID hiện tại.");
    inspect((await readJson(next))?.items || []);
  }
  return max;
}

async function saveCounter(
  input: Omit<CounterRecord, "id">,
  id: string | undefined,
  token: string,
) {
  const path = id
    ? `/api/collections/uid_counters/records/${encodeURIComponent(id)}`
    : "/api/collections/uid_counters/records";
  const response = await pbFetch(
    path,
    {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    token,
  );
  if (!response.ok) {
    const body = await readJson(response);
    throw new Error(body?.message || "Không cập nhật được bộ đếm UID.");
  }
  return (await readJson(response)) as CounterRecord;
}

async function allocate(body: AllocateBody, actor: AuthUser | null, adminToken: string) {
  const type = body.type;
  if (type !== "user" && type !== "employment_history") return jsonError("Loại UID không hợp lệ.");
  const count = Math.trunc(Number(body.count || 1));
  if (count < 1 || count > 1_000) return jsonError("Số lượng UID phải từ 1 đến 1000.");
  if (!actor) return jsonError("Cần đăng nhập để cấp UID.", 401);
  const companyId = String(actor.tenant_company || "").trim();
  if (!companyId) return jsonError("Tài khoản chưa gắn với công ty nào.", 403);

  const prefix = await getPrefix(companyId, adminToken);
  const meta = counterMeta(type, companyId, prefix, body.referenceDate);
  return withCounterLock(meta.key, async () => {
    let counter = await getCounter(meta.key, adminToken);
    if (!counter) {
      const current = await scanMaximum(type, companyId, prefix, meta.period, adminToken);
      counter = await saveCounter(
        {
          counter_key: meta.key,
          counter_type: type,
          prefix,
          period: meta.period,
          current_value: current,
          updated_by: actor?.id || body.actorId || "",
          note: "Khởi tạo tự động từ dữ liệu hiện có",
          tenant_company: companyId,
        },
        undefined,
        adminToken,
      );
    }
    const startValue = Number(counter.current_value || 0) + 1;
    const endValue = startValue + count - 1;
    if (endValue > meta.limit)
      return jsonError(
        type === "user"
          ? "Đã vượt giới hạn 999999 UID theo tiền tố hiện tại."
          : "Đã vượt giới hạn 9999 UID lịch sử trong tháng.",
        409,
      );
    await saveCounter(
      {
        counter_key: meta.key,
        counter_type: type,
        prefix,
        period: meta.period,
        current_value: endValue,
        updated_by: actor?.id || body.actorId || "",
        note: counter.note || "",
        tenant_company: companyId,
      },
      counter.id,
      adminToken,
    );
    const uids = Array.from({ length: count }, (_, index) =>
      formatUid(type, prefix, meta.period, startValue + index),
    );
    return Response.json({ type, prefix, period: meta.period, startValue, endValue, uids });
  });
}

async function observe(body: AllocateBody, actor: AuthUser | null, adminToken: string) {
  if (!actor || (actor.role !== "admin" && actor.role !== "staff"))
    return jsonError("Bạn không có quyền cập nhật bộ đếm UID.", 403);
  const companyId = String(actor.tenant_company || "").trim();
  if (!companyId) return jsonError("Tài khoản chưa gắn với công ty nào.", 403);
  const type = body.type;
  const uid = String(body.uid || "")
    .trim()
    .toUpperCase();
  if ((type !== "user" && type !== "employment_history") || !uid)
    return jsonError("UID quan sát không hợp lệ.");
  const prefix = await getPrefix(companyId, adminToken);
  const meta = counterMeta(type, companyId, prefix, body.referenceDate);
  const pattern =
    type === "user"
      ? new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d{6})$`)
      : new RegExp(
          `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${meta.period.slice(2, 6)}(\\d{4})$`,
        );
  const match = uid.match(pattern);
  if (!match) return Response.json({ observed: false });
  const observed = Number(match[1]);
  return withCounterLock(meta.key, async () => {
    const counter = await getCounter(meta.key, adminToken);
    if (counter && Number(counter.current_value || 0) >= observed)
      return Response.json({ observed: false });
    await saveCounter(
      {
        counter_key: meta.key,
        counter_type: type,
        prefix,
        period: meta.period,
        current_value: observed,
        updated_by: actor.id,
        note: "Nâng bộ đếm theo UID nhập thủ công",
        tenant_company: companyId,
      },
      counter?.id,
      adminToken,
    );
    return Response.json({ observed: true, currentValue: observed });
  });
}

export async function handleUidCounterRequest(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as AllocateBody | null;
    if (!body) return jsonError("Dữ liệu yêu cầu không hợp lệ.");
    const adminAuth = await getAdminToken();
    if (!adminAuth.ok) return adminAuthError(adminAuth.reason);
    const actor = await getAuthUser(request);
    return body.action === "observe"
      ? observe(body, actor, adminAuth.token)
      : allocate(body, actor, adminAuth.token);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Không cấp được UID.", 500);
  }
}
