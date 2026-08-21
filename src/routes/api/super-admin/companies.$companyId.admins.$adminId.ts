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
async function context(request: Request) {
  const auth = await getServerAuthUser(request);
  if (!auth || auth.user.role !== "super_admin") return null;
  const adminToken = await getPocketBaseAdminToken();
  return adminToken ? { adminToken } : null;
}
export const Route = createFileRoute("/api/super-admin/companies/$companyId/admins/$adminId")({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        const ctx = await context(request);
        if (!ctx) return error("Bạn không có quyền quản trị tối cao.", 403);
        const ownership = await pbServerFetch(
          `/api/collections/users/records/${encodeURIComponent(params.adminId)}?fields=id,tenant_company,role`,
          {},
          ctx.adminToken,
        );
        const target = await readPbJson(ownership);
        if (!ownership.ok)
          return error(target?.message || "Không tìm thấy Admin.", ownership.status);
        if (target?.role !== "admin" || target?.tenant_company !== params.companyId)
          return error("Tài khoản Admin không thuộc công ty đã chọn.", 403);
        const body = await request.json().catch(() => null);
        const action = String(body?.action || "update");
        const payload: Record<string, unknown> = {};
        if (action === "reset_password") {
          const password = String(body?.password || "");
          if (password.length < 8) return error("Mật khẩu mới tối thiểu 8 ký tự.");
          payload.password = password;
          payload.passwordConfirm = password;
          payload.must_change_password = true;
        } else {
          if (body?.full_name !== undefined)
            payload.full_name = String(body.full_name).trim().slice(0, 120);
          if (body?.email !== undefined) payload.email = String(body.email).trim().slice(0, 120);
          if (["active", "disabled"].includes(String(body?.status))) payload.status = body.status;
        }
        const response = await pbServerFetch(
          `/api/collections/users/records/${encodeURIComponent(params.adminId)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
          ctx.adminToken,
        );
        const record = await readPbJson(response);
        return response.ok
          ? Response.json(record)
          : error(record?.message || "Không cập nhật được Admin.", response.status);
      },
    },
  },
});
