import { createFileRoute } from "@tanstack/react-router";

import { deleteWorkerAccount } from "@/lib/worker-delete-server";

export const Route = createFileRoute("/api/admin/workers/$workerId/delete")({
  server: {
    handlers: {
      POST: async ({ request, params }) => deleteWorkerAccount(request, params.workerId),
    },
  },
});
