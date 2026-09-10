import { createFileRoute } from "@tanstack/react-router";
import { isSupportedCompanyCode } from "@/lib/login-identity";
import {
  getPocketBaseAdminToken,
  pbServerFetch,
  readPbJson,
  requireActiveCompany,
} from "@/lib/tenant-server";

export const Route = createFileRoute("/api/tenant-company")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const result = await requireActiveCompany(request);
        if ("error" in result) return result.error;
        if (
          !result.company?.id ||
          !result.company.code ||
          !isSupportedCompanyCode(result.company.code)
        ) {
          return Response.json(
            { message: "Mã công ty chưa được cấu hình hoặc không hợp lệ." },
            { status: 422 },
          );
        }

        const adminToken = await getPocketBaseAdminToken();
        if (!adminToken) {
          return Response.json(
            { message: "Máy chủ chưa cấu hình quyền quản trị PocketBase." },
            { status: 424 },
          );
        }
        const usersResponse = await pbServerFetch("/api/collections/users", {}, adminToken);
        const usersCollection = await readPbJson(usersResponse);
        if (!usersResponse.ok) {
          return Response.json(
            { message: "Không kiểm tra được cấu hình tài khoản." },
            { status: 502 },
          );
        }
        const hasLoginName = (usersCollection?.fields || []).some(
          (field: any) => field?.name === "login_name",
        );
        return Response.json({
          id: result.company.id,
          code: result.company.code,
          status: result.company.status,
          hasLoginName,
        });
      },
    },
  },
});
