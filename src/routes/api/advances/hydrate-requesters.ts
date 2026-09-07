import { createFileRoute } from "@tanstack/react-router";
import PocketBase from "pocketbase";
import type { UserRecord } from "@/lib/pocketbase-types";

/**
 * API endpoint to fetch user records by IDs using admin privileges.
 * This bypasses the listRule restrictions on the users collection.
 *
 * Used by hydrateAdvanceRequesters when direct PocketBase fetch fails
 * due to tenant filtering or permission issues.
 */
export const Route = createFileRoute("/api/advances/hydrate-requesters")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { requesterIds } = (await request.json()) as { requesterIds: string[] };

          if (!Array.isArray(requesterIds) || requesterIds.length === 0) {
            return Response.json({ error: "Invalid requesterIds" }, { status: 400 });
          }

          const pbUrl =
            (typeof process !== "undefined" ? process.env.PUBLIC_POCKETBASE_URL : undefined) ||
            (typeof process !== "undefined" ? process.env.PB_URL : undefined) ||
            "";
          const adminEmail =
            typeof process !== "undefined" ? process.env.POCKETBASE_ADMIN_EMAIL || "" : "";
          const adminPassword =
            typeof process !== "undefined" ? process.env.POCKETBASE_ADMIN_PASSWORD || "" : "";

          if (!pbUrl || !adminEmail || !adminPassword) {
            console.error("Missing PocketBase admin credentials in environment");
            return Response.json({ error: "Server configuration error" }, { status: 500 });
          }

          const adminPb = new PocketBase(pbUrl);

          // Authenticate as admin to bypass listRule
          await adminPb.admins.authWithPassword(adminEmail, adminPassword);

          // Fetch users by IDs in batches
          const batchSize = 50;
          const allUsers: UserRecord[] = [];

          for (let i = 0; i < requesterIds.length; i += batchSize) {
            const batch = requesterIds.slice(i, i + batchSize);
            const filter = batch.map((id) => `id="${id.replace(/"/g, '\\"')}"`).join(" || ");

            try {
              const users = await adminPb.collection("users").getFullList<UserRecord>({
                filter,
                fields: "id,full_name,username,phone,role,tenant_company",
              });
              allUsers.push(...users);
            } catch (error) {
              console.error(`Failed to fetch batch of users:`, error);
            }
          }

          return Response.json(allUsers);
        } catch (error) {
          console.error("Error in hydrate-requesters API:", error);
          return Response.json({ error: "Internal server error" }, { status: 500 });
        }
      },
    },
  },
});


