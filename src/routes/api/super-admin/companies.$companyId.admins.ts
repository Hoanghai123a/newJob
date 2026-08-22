import { createFileRoute } from "@tanstack/react-router";
import {
  buildTechnicalUsername,
  loginNameFromUsername,
  normalizeLoginName,
} from "@/lib/login-identity";
import {
  escapePb,
  getPocketBaseAdminToken,
  getServerAuthUser,
  pbServerFetch,
  readPbJson,
} from "@/lib/tenant-server";

function error(message: string, status = 400) {
  return Response.json({ message }, { status });
}
function text(value: unknown, max = 200) {
  return String(value || "")
    .trim()
    .slice(0, max);
}
async function context(request: Request) {
  const auth = await getServerAuthUser(request);
  if (!auth || auth.user.role !== "super_admin") return null;
  const adminToken = await getPocketBaseAdminToken();
  return adminToken ? { adminToken } : null;
}

async function getCompany(adminToken: string, companyId: string) {
  const response = await pbServerFetch(
    `/api/collections/companies/records/${encodeURIComponent(companyId)}?fields=id,code`,
    {},
    adminToken,
  );
  const company = await readPbJson(response);
  return response.ok && company?.id && company?.code ? company : null;
}

export const Route = createFileRoute("/api/super-admin/companies/$companyId/admins")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const ctx = await context(request);
        if (!ctx) return error("Bạn không có quyền quản trị tối cao.", 403);
        const filter = encodeURIComponent(
          `tenant_company = "${escapePb(params.companyId)}" && role = "admin"`,
        );
        const response = await pbServerFetch(
          `/api/collections/users/records?perPage=100&sort=full_name&filter=${filter}&fields=id,username,login_name,email,full_name,status,must_change_password,last_login,created`,
          {},
          ctx.adminToken,
        );
        const body = await readPbJson(response);
        return response.ok
          ? Response.json({
              ...body,
              items: (body?.items || []).map((admin: any) => ({
                ...admin,
                display_username:
                  normalizeLoginName(admin.login_name) || loginNameFromUsername(admin.username),
              })),
            })
          : error(body?.message || "Không tải được Admin công ty.", response.status);
      },
      POST: async ({ request, params }) => {
        const ctx = await context(request);
        if (!ctx) return error("Bạn không có quyền quản trị tối cao.", 403);
        const body = await request.json().catch(() => null);
        const loginName = normalizeLoginName(text(body?.username, 100));
        const password = String(body?.password || "");
        if (!loginName || password.length < 8)
          return error("Nhập tên đăng nhập và mật khẩu tối thiểu 8 ký tự.");
        const company = await getCompany(ctx.adminToken, params.companyId);
        if (!company) return error("Không tìm thấy công ty đã chọn.", 404);
        const username = buildTechnicalUsername(company.code, loginName);
        const duplicateResponse = await pbServerFetch(
          `/api/collections/users/records?perPage=1&fields=id&filter=${encodeURIComponent(`username = "${escapePb(username)}"`)}`,
          {},
          ctx.adminToken,
        );
        const duplicate = await readPbJson(duplicateResponse);
        if (!duplicateResponse.ok)
          return error("Không thể kiểm tra tên đăng nhập.", duplicateResponse.status);
        if (duplicate?.items?.length)
          return error("Tên đăng nhập đã tồn tại trong công ty này.", 409);
        const response = await pbServerFetch(
          "/api/collections/users/records",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              username,
              login_name: loginName,
              password,
              passwordConfirm: password,
              full_name: text(body?.full_name, 120) || loginName,
              email: text(body?.email, 120),
              tenant_company: params.companyId,
              role: "admin",
              status: "active",
              must_change_password: true,
            }),
          },
          ctx.adminToken,
        );
        const record = await readPbJson(response);
        return response.ok
          ? Response.json(record, { status: 201 })
          : error(record?.message || "Không tạo được Admin.", response.status);
      },
    },
  },
});
