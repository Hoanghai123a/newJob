import { createFileRoute } from "@tanstack/react-router";
import { restoreTenantBackup } from "@/lib/tenant-transfer-server";

export const Route = createFileRoute("/api/super-admin/companies/import")({
  server: { handlers: { POST: ({ request }) => restoreTenantBackup(request) } },
});
