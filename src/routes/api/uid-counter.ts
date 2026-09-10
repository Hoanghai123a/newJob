import { createFileRoute } from "@tanstack/react-router";
import { handleUidCounterRequest } from "@/lib/uid-counter-server";

export const Route = createFileRoute("/api/uid-counter")({
  server: {
    handlers: {
      POST: async ({ request }) => handleUidCounterRequest(request),
    },
  },
});
