import { createFileRoute } from "@tanstack/react-router";
import { previewTenantRestore } from "@/lib/tenant-transfer-server";

export const Route = createFileRoute("/api/super-admin/companies/import/preview")({
  server: { handlers: { POST: ({ request }) => previewTenantRestore(request) } },
});
