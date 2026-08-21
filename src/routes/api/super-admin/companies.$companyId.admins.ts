import { createFileRoute } from "@tanstack/react-router";
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

export const Route = createFileRoute("/api/super-admin/companies/$companyId/admins")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const ctx = await context(request);
        if (!ctx) return error("Bạn không có quyền quản trị tối cao.", 403);
        const filter = encodeURIComponent(
          `tenant_company = \"${escapePb(params.companyId)}\" && role = \"admin\"`,
        );
        const response = await pbServerFetch(
          `/api/collections/users/records?perPage=100&sort=full_name&filter=${filter}&fields=id,username,email,full_name,status,must_change_password,last_login,created`,
          {},
          ctx.adminToken,
        );
        const body = await readPbJson(response);
        return response.ok
          ? Response.json(body)
          : error(body?.message || "Không tải được Admin công ty.", response.status);
      },
      POST: async ({ request, params }) => {
        const ctx = await context(request);
        if (!ctx) return error("Bạn không có quyền quản trị tối cao.", 403);
        const body = await request.json().catch(() => null);
        const username = text(body?.username, 100);
        const password = String(body?.password || "");
        if (!username || password.length < 8)
          return error("Nhập tên đăng nhập và mật khẩu tối thiểu 8 ký tự.");
        const response = await pbServerFetch(
          "/api/collections/users/records",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              username,
              password,
              passwordConfirm: password,
              full_name: text(body?.full_name, 120) || username,
              email: text(body?.email, 120),
              tenant_company: params.companyId,
              role: "admin",
              status: "active",
              approved: true,
              approvalStatus: "approved",
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
