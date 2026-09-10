import { createFileRoute } from "@tanstack/react-router";

import { handleStaffExcelExport } from "@/lib/staff-export-server";

export const Route = createFileRoute("/api/staff/export")({
  server: {
    handlers: {
      POST: async ({ request }) => handleStaffExcelExport(request),
    },
  },
});
