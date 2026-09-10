import { createFileRoute } from "@tanstack/react-router";
import {
  escapePb,
  getPocketBaseAdminToken,
  getServerAuthUser,
  pbServerFetch,
  readPbJson,
} from "@/lib/tenant-server";
import { handleCreateEmploymentHistory } from "@/lib/employment-history-handler";

export const Route = createFileRoute("/api/employment-histories")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        handleCreateEmploymentHistory(request, {
          getAuth: getServerAuthUser,
          getAdminToken: getPocketBaseAdminToken,
          pbFetch: pbServerFetch,
          readJson: readPbJson,
          escapeFilterValue: escapePb,
        }),
    },
  },
});
