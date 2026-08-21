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

export const Route = createFileRoute("/api/employment-histories")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await getServerAuthUser(request);
        if (!auth) return error("Phiên đăng nhập không hợp lệ.", 401);
        const companyId = auth.user.tenant_company;
        if (!companyId || auth.user.role === "super_admin")
          return error("Tài khoản chưa được gán công ty hợp lệ.", 403);
        const body = await request.json().catch(() => null);
        const payload =
          body?.payload && typeof body.payload === "object"
            ? ({ ...body.payload } as Record<string, unknown>)
            : null;
        const userId = String(payload?.user || "");
        if (!payload || !userId) return error("Dữ liệu lịch sử lao động không hợp lệ.");
        const token = await getPocketBaseAdminToken();
        if (!token) return error("Không kết nối được PocketBase.", 502);
        const [targetResponse, companyResponse, historyResponse] = await Promise.all([
          pbServerFetch(
            `/api/collections/users/records/${encodeURIComponent(userId)}?fields=id,tenant_company`,
            {},
            token,
          ),
          pbServerFetch(
            `/api/collections/companies/records/${encodeURIComponent(companyId)}?fields=id,max_employment_histories`,
            {},
            token,
          ),
          pbServerFetch(
            `/api/collections/employment_histories/records?page=1&perPage=1&skipTotal=0&filter=${encodeURIComponent(`company = "${escapePb(companyId)}"`)}&fields=id`,
            {},
            token,
          ),
        ]);
        const [target, company, histories] = await Promise.all([
          readPbJson(targetResponse),
          readPbJson(companyResponse),
          readPbJson(historyResponse),
        ]);
        if (!targetResponse.ok || target?.tenant_company !== companyId)
          return error("Người lao động không thuộc công ty hiện tại.", 403);
        if (!companyResponse.ok || !historyResponse.ok)
          return error(
            company?.message ||
              histories?.message ||
              "Không kiểm tra được hạn mức lịch sử lao động.",
            502,
          );
        const limit = Math.max(0, Math.trunc(Number(company?.max_employment_histories || 0)));
        const current = Number(histories?.totalItems || 0);
        if (limit > 0 && current >= limit)
          return error(`Công ty đã đạt giới hạn ${limit} bản ghi lịch sử lao động.`, 409);
        payload.company = companyId;
        const response = await pbServerFetch(
          "/api/collections/employment_histories/records",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
          token,
        );
        const record = await readPbJson(response);
        return response.ok
          ? Response.json(record, { status: 201 })
          : error(record?.message || "Không tạo được lịch sử lao động.", response.status);
      },
    },
  },
});
