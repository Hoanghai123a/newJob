import { createFileRoute } from "@tanstack/react-router";
import { exportTenantBackup } from "@/lib/tenant-transfer-server";

export const Route = createFileRoute("/api/super-admin/companies/$companyId/export")({
  server: {
    handlers: { POST: ({ request, params }) => exportTenantBackup(request, params.companyId) },
  },
});
