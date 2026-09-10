import { createFileRoute } from "@tanstack/react-router";
import { handleWorkforceLookups } from "@/lib/workforce-dashboard-server";

export const Route = createFileRoute("/api/workforce/lookups")({
  server: { handlers: { GET: async ({ request }) => handleWorkforceLookups(request) } },
});
