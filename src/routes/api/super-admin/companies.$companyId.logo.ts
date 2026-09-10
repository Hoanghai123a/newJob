import { createFileRoute } from "@tanstack/react-router";
import { getPBUpstream } from "@/lib/pocketbase-config";
import {
  getServerAuthUser,
  getPocketBaseAdminToken,
  escapePb,
} from "@/lib/tenant-server";

async function requireSuperAdmin(request: Request) {
  const auth = await getServerAuthUser(request);
  if (!auth || auth.user.role !== "super_admin") return null;
  const adminToken = await getPocketBaseAdminToken();
  return adminToken ? { auth, adminToken, upstream: getPBUpstream() } : null;
}

export const Route = createFileRoute("/api/super-admin/companies/$companyId/logo")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const ctx = await requireSuperAdmin(request);
        if (!ctx) return Response.json({ message: "Forbidden" }, { status: 403 });

        const { adminToken: token, upstream } = ctx;
        const { companyId } = params;

        const formData = await request.formData();
        const logo = formData.get("logo");
        if (!logo || !(logo instanceof File)) {
          return Response.json({ message: "Thiếu file logo." }, { status: 400 });
        }

        // Tìm app_settings của công ty này
        const listRes = await fetch(
          `${upstream}/api/collections/app_settings/records?filter=tenant_company="${escapePb(companyId)}"&perPage=1`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        const listData = await listRes.json();
        const existingRecord = listData?.items?.[0];

        const payload = new FormData();
        payload.append("logo", logo);

        let record;
        if (existingRecord?.id) {
          // Update
          const updateRes = await fetch(
            `${upstream}/api/collections/app_settings/records/${existingRecord.id}`,
            {
              method: "PATCH",
              headers: { Authorization: `Bearer ${token}` },
              body: payload,
            },
          );
          if (!updateRes.ok) {
            const err = await updateRes.json().catch(() => ({}));
            return Response.json(
              { message: err?.message || "Không cập nhật được logo công ty." },
              { status: updateRes.status },
            );
          }
          record = await updateRes.json();
        } else {
          // Create app_settings cho công ty này
          payload.append("tenant_company", companyId);

          // Lấy tên công ty để đặt company_name
          const companyRes = await fetch(`${upstream}/api/collections/companies/records/${companyId}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (companyRes.ok) {
            const company = await companyRes.json();
            payload.append("company_name", company.name || "");
          }

          const createRes = await fetch(`${upstream}/api/collections/app_settings/records`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: payload,
          });
          if (!createRes.ok) {
            const err = await createRes.json().catch(() => ({}));
            return Response.json(
              { message: err?.message || "Không tạo được logo công ty." },
              { status: createRes.status },
            );
          }
          record = await createRes.json();
        }

        return Response.json(record);
      },
      DELETE: async ({ request, params }) => {
        const ctx = await requireSuperAdmin(request);
        if (!ctx) return Response.json({ message: "Forbidden" }, { status: 403 });

        const { adminToken: token, upstream } = ctx;
        const { companyId } = params;

        const listRes = await fetch(
          `${upstream}/api/collections/app_settings/records?filter=tenant_company="${escapePb(companyId)}"&perPage=1`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        const listData = await listRes.json();
        const existingRecord = listData?.items?.[0];

        if (!existingRecord?.id) {
          return Response.json({ message: "Không tìm thấy app_settings công ty." }, { status: 404 });
        }

        const payload = new FormData();
        payload.append("logo", "");

        const updateRes = await fetch(
          `${upstream}/api/collections/app_settings/records/${existingRecord.id}`,
          {
            method: "PATCH",
            headers: { Authorization: `Bearer ${token}` },
            body: payload,
          },
        );
        if (!updateRes.ok) {
          const err = await updateRes.json().catch(() => ({}));
          return Response.json(
            { message: err?.message || "Không xóa được logo công ty." },
            { status: updateRes.status },
          );
        }
        const record = await updateRes.json();

        return Response.json(record);
      },
    },
  },
});
