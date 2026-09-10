import { createFileRoute } from "@tanstack/react-router";
import { handleWorkforceDashboard } from "@/lib/workforce-dashboard-server";

export const Route = createFileRoute("/api/workforce/dashboard")({
  server: { handlers: { GET: async ({ request }) => handleWorkforceDashboard(request) } },
});
