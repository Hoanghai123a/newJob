import { createFileRoute } from "@tanstack/react-router";
import {
  buildTechnicalUsername,
  isSupportedCompanyCode,
  normalizeCompanyCode,
  normalizeLoginName,
} from "@/lib/login-identity";
import {
  getPocketBaseAdminToken,
  getServerAuthUser,
  pbServerFetch,
  readPbJson,
  escapePb,
} from "@/lib/tenant-server";

const DEFAULT_LIMITS = {
  max_accounts: 0,
  max_workers: 0,
  max_factories: 0,
  max_file_bytes: 0,
  max_employment_histories: 0,
};

function error(message: string, status = 400) {
  return Response.json({ message }, { status });
}
function text(value: unknown, limit = 200) {
  return String(value || "")
    .trim()
    .slice(0, limit);
}
function number(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
}

async function requireSuperAdmin(request: Request) {
  const auth = await getServerAuthUser(request);
  if (!auth || auth.user.role !== "super_admin") return null;
  const adminToken = await getPocketBaseAdminToken();
  return adminToken ? { auth, adminToken } : null;
}

async function count(adminToken: string, collection: string, filter: string) {
  const response = await pbServerFetch(
    `/api/collections/${collection}/records?page=1&perPage=1&skipTotal=0&filter=${encodeURIComponent(filter)}&fields=id`,
    {},
    adminToken,
  );
  const body = await readPbJson(response);
  return response.ok ? Number(body?.totalItems || 0) : 0;
}

async function listCompanies(adminToken: string) {
  const response = await pbServerFetch(
    "/api/collections/companies/records?perPage=200",
    {},
    adminToken,
  );
  const body = await readPbJson(response);
  if (!response.ok) {
    throw new Error(body?.message || "Không tải được danh sách công ty từ PocketBase.");
  }
  return Promise.all(
    (body?.items || []).map(async (company: any) => ({
      ...company,
      usage: {
        accounts: await count(adminToken, "users", `tenant_company = "${escapePb(company.id)}"`),
        workers: await count(
          adminToken,
          "users",
          `tenant_company = "${escapePb(company.id)}" && role = "user"`,
        ),
        factories: await count(adminToken, "factories", `tenant_company = "${escapePb(company.id)}"`),
        employment_histories: await count(
          adminToken,
          "employment_histories",
          `tenant_company = "${escapePb(company.id)}"`,
        ),
      },
    })),
  );
}

export const Route = createFileRoute("/api/super-admin/companies")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const ctx = await requireSuperAdmin(request);
        if (!ctx) return error("Bạn không có quyền quản trị tối cao.", 403);
        try {
          return Response.json({ items: await listCompanies(ctx.adminToken) });
        } catch (cause: unknown) {
          const message =
            cause instanceof Error ? cause.message : "Không tải được danh sách công ty.";
          return error(message, 502);
        }
      },
      POST: async ({ request }) => {
        const ctx = await requireSuperAdmin(request);
        if (!ctx) return error("Bạn không có quyền quản trị tối cao.", 403);
        const body = await request.json().catch(() => null);
        const name = text(body?.name);
        const code = text(body?.code, 40).toUpperCase();
        const adminUsername = text(body?.admin_username, 100);
        const adminPassword = String(body?.admin_password || "");
        if (
          !name ||
          !code ||
          !isSupportedCompanyCode(code) ||
          !adminUsername ||
          adminPassword.length < 8
        )
          return error("Nhập đủ tên, mã công ty, tài khoản Admin và mật khẩu tối thiểu 8 ký tự.");
        const companyResponse = await pbServerFetch(
          "/api/collections/companies/records",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name,
              code,
              status: "active",
              address: text(body?.address),
              hotline: text(body?.hotline, 40),
              email: text(body?.email, 120),
              ...DEFAULT_LIMITS,
              ...Object.fromEntries(
                Object.keys(DEFAULT_LIMITS).map((key) => [key, number(body?.[key])]),
              ),
            }),
          },
          ctx.adminToken,
        );
        const company = await readPbJson(companyResponse);
        if (!companyResponse.ok)
          return error(company?.message || "Không tạo được công ty.", companyResponse.status);
        const adminResponse = await pbServerFetch(
          "/api/collections/users/records",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              username: buildTechnicalUsername(company.code, adminUsername),
              login_name: adminUsername,
              password: adminPassword,
              passwordConfirm: adminPassword,
              full_name: text(body?.admin_name, 120) || adminUsername,
              email: text(body?.admin_email, 120),
              role: "admin",
              tenant_company: company.id,
              status: "active",
              must_change_password: true,
            }),
          },
          ctx.adminToken,
        );
        const admin = await readPbJson(adminResponse);
        if (!adminResponse.ok) {
          await pbServerFetch(
            `/api/collections/companies/records/${company.id}`,
            { method: "DELETE" },
            ctx.adminToken,
          );
          return error(
            admin?.message || "Không tạo được tài khoản Admin đầu tiên.",
            adminResponse.status,
          );
        }
        await pbServerFetch(
          "/api/collections/app_settings/records",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ company: company.id, company_name: name }),
          },
          ctx.adminToken,
        ).catch(() => undefined);
        return Response.json({ company, admin }, { status: 201 });
      },
    },
  },
});
