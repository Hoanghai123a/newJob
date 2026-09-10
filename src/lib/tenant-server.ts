import { getPBUpstream } from "@/lib/pocketbase-config";
import type { CompanyStatus } from "@/lib/tenant";

export type ServerAuthUser = {
  id: string;
  role?: string;
  tenant_company?: string;
  status?: string;
  username?: string;
  email?: string;
  full_name?: string;
};

function env(name: string) {
  return (typeof process !== "undefined" ? process.env[name] : "") || "";
}

export function escapePb(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export async function pbServerFetch(path: string, init: RequestInit = {}, token?: string) {
  const headers = new Headers(init.headers);
  headers.set("ngrok-skip-browser-warning", "true");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${getPBUpstream()}${path}`, { ...init, headers });
}

export async function readPbJson(response: Response): Promise<any> {
  return response.json().catch(() => null);
}

export function bearerToken(request: Request) {
  return /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") || "")?.[1] || "";
}

export async function getServerAuthUser(
  request: Request,
): Promise<{ token: string; user: ServerAuthUser } | null> {
  const token = bearerToken(request);
  if (!token) return null;
  const response = await pbServerFetch(
    "/api/collections/users/auth-refresh",
    { method: "POST" },
    token,
  );
  if (!response.ok) return null;
  const body = await readPbJson(response);
  return body?.record?.id ? { token, user: body.record } : null;
}

type CachedAdminToken = { token: string; expiresAt: number };

const ADMIN_TOKEN_REFRESH_SKEW_MS = 60_000;
let cachedAdminToken: CachedAdminToken | null = null;
let adminTokenRequest: Promise<string> | null = null;

function tokenExpiry(token: string) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof decoded.exp === "number" ? decoded.exp * 1000 : null;
  } catch {
    return null;
  }
}

function usableCachedToken(entry: CachedAdminToken | null) {
  return Boolean(entry && entry.expiresAt > Date.now() + ADMIN_TOKEN_REFRESH_SKEW_MS);
}

async function requestAdminToken() {
  const direct = env("PB_ADMIN_TOKEN").trim();
  const directExpiry = direct ? tokenExpiry(direct) : null;
  if (
    direct &&
    (directExpiry === null || directExpiry > Date.now() + ADMIN_TOKEN_REFRESH_SKEW_MS)
  ) {
    // Tokens without an exp claim are deliberately not cached indefinitely.
    if (directExpiry === null) return direct;
    cachedAdminToken = { token: direct, expiresAt: directExpiry };
    return direct;
  }

  const identity = env("PB_ADMIN_EMAIL");
  const password = env("PB_ADMIN_PASSWORD");
  if (!identity || !password) return "";
  for (const path of [
    "/api/collections/_superusers/auth-with-password",
    "/api/admins/auth-with-password",
  ]) {
    const response = await pbServerFetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity, password }),
    });
    const body = await readPbJson(response);
    if (response.ok && typeof body?.token === "string") {
      const expiresAt = tokenExpiry(body.token);
      if (expiresAt && expiresAt > Date.now()) {
        cachedAdminToken = { token: body.token, expiresAt };
      } else {
        cachedAdminToken = null;
      }
      return body.token;
    }
  }
  return "";
}

export async function getPocketBaseAdminToken() {
  if (usableCachedToken(cachedAdminToken)) return cachedAdminToken!.token;
  if (adminTokenRequest) return adminTokenRequest;
  adminTokenRequest = requestAdminToken().finally(() => {
    adminTokenRequest = null;
  });
  return adminTokenRequest;
}

export function invalidatePocketBaseAdminToken(token?: string) {
  if (!token || cachedAdminToken?.token === token) cachedAdminToken = null;
}

export async function getCompanyForUser(user: ServerAuthUser, adminToken?: string) {
  if (user.role === "super_admin") return null;
  if (!user.tenant_company) return null;
  const token = adminToken || (await getPocketBaseAdminToken());
  if (!token) return null;
  const response = await pbServerFetch(
    `/api/collections/companies/records/${encodeURIComponent(user.tenant_company)}`,
    {},
    token,
  );
  if (!response.ok) return null;
  return (await readPbJson(response)) as { id: string; code?: string; status?: CompanyStatus };
}

export async function requireActiveCompany(request: Request) {
  const auth = await getServerAuthUser(request);
  if (!auth)
    return {
      error: Response.json({ message: "Phiên đăng nhập không hợp lệ." }, { status: 401 }),
    } as const;
  if (auth.user.role === "super_admin") return { auth, company: null } as const;
  const company = await getCompanyForUser(auth.user);
  if (!company)
    return {
      error: Response.json({ message: "Tài khoản chưa được gán công ty hợp lệ." }, { status: 403 }),
    } as const;
  if (company.status !== "active")
    return {
      error: Response.json(
        { message: company.status === "closed" ? "Công ty đã đóng." : "Công ty đang tạm khóa." },
        { status: 403 },
      ),
    } as const;
  return { auth, company } as const;
}
