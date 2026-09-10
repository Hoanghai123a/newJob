import { createFileRoute } from "@tanstack/react-router";
import { purgeTenant } from "@/lib/tenant-transfer-server";

export const Route = createFileRoute("/api/super-admin/companies/$companyId/purge")({
  server: { handlers: { POST: ({ request, params }) => purgeTenant(request, params.companyId) } },
});
