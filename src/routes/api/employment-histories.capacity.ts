import { createFileRoute } from "@tanstack/react-router";
import {
  getPocketBaseAdminToken,
  getServerAuthUser,
  pbServerFetch,
  readPbJson,
} from "@/lib/tenant-server";

function error(message: string, status = 400) {
  return Response.json({ message }, { status });
}

export const Route = createFileRoute("/api/employment-histories/capacity")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await getServerAuthUser(request);
        if (!auth) return error("Phiên đăng nhập không hợp lệ.", 401);
        if (auth.user.role === "super_admin")
          return Response.json({ allowed: true, current: 0, limit: 0 });
        const companyId = auth.user.tenant_company;
        if (!companyId) return error("Tài khoản chưa được gán công ty hợp lệ.", 403);
        const body = await request.json().catch(() => null);
        const adding = Math.trunc(Number(body?.adding || 1));
        if (!Number.isSafeInteger(adding) || adding < 1)
          return error("Số lịch sử cần tạo không hợp lệ.");
        const token = await getPocketBaseAdminToken();
        if (!token) return error("Không kết nối được PocketBase.", 502);
        const [companyResponse, historyResponse] = await Promise.all([
          pbServerFetch(
            `/api/collections/companies/records/${encodeURIComponent(companyId)}`,
            {},
            token,
          ),
          pbServerFetch(
            `/api/collections/employment_histories/records?page=1&perPage=1&skipTotal=0&filter=${encodeURIComponent(`company = "${companyId}"`)}&fields=id`,
            {},
            token,
          ),
        ]);
        const company = await readPbJson(companyResponse);
        const histories = await readPbJson(historyResponse);
        if (!companyResponse.ok || !historyResponse.ok)
          return error(
            company?.message ||
              histories?.message ||
              "Không kiểm tra được hạn mức lịch sử lao động.",
            502,
          );
        const limit = Math.max(0, Math.trunc(Number(company?.max_employment_histories || 0)));
        const current = Number(histories?.totalItems || 0);
        if (limit > 0 && current + adding > limit)
          return error(
            `Công ty đã đạt giới hạn ${limit} bản ghi lịch sử lao động. Hiện có ${current}, không thể thêm ${adding} bản ghi.`,
            409,
          );
        return Response.json({ allowed: true, current, limit, adding });
      },
    },
  },
});
