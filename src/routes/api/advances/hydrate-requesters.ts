import { json } from "@solidjs/router";
import type { APIEvent } from "@solidjs/start/server";
import PocketBase from "pocketbase";
import { getServerEnv } from "~/lib/env.server";
import type { UserRecord } from "~/lib/pocketbase-types";

/**
 * API endpoint to fetch user records by IDs using admin privileges.
 * This bypasses the listRule restrictions on the users collection.
 *
 * Used by hydrateAdvanceRequesters when direct PocketBase fetch fails
 * due to tenant filtering or permission issues.
 */
export async function POST({ request }: APIEvent) {
  try {
    const { requesterIds } = (await request.json()) as { requesterIds: string[] };

    if (!Array.isArray(requesterIds) || requesterIds.length === 0) {
      return json({ error: "Invalid requesterIds" }, { status: 400 });
    }

    const env = getServerEnv();
    const adminPb = new PocketBase(env.PUBLIC_POCKETBASE_URL);

    // Authenticate as admin to bypass listRule
    await adminPb.admins.authWithPassword(env.POCKETBASE_ADMIN_EMAIL, env.POCKETBASE_ADMIN_PASSWORD);

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

    return json(allUsers);
  } catch (error) {
    console.error("Error in hydrate-requesters API:", error);
    return json({ error: "Internal server error" }, { status: 500 });
  }
}

// Export empty default to satisfy SolidStart route requirement
export default {};

