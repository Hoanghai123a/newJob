import { createFileRoute } from "@tanstack/react-router";

import { promoteStaffToAdmin } from "@/lib/staff-promote-server";

export const Route = createFileRoute("/api/admin/staff/$staffId/promote")({
  server: {
    handlers: {
      POST: async ({ request, params }) => promoteStaffToAdmin(request, params.staffId),
    },
  },
});
