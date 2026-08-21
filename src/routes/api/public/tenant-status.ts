import { createFileRoute } from "@tanstack/react-router";
import { requireActiveCompany } from "@/lib/tenant-server";

export const Route = createFileRoute("/api/public/tenant-status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const result = await requireActiveCompany(request);
        if (result.error) return result.error;
        return Response.json({ company: result.company });
      },
    },
  },
});
