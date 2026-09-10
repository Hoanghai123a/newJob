import { createFileRoute, redirect } from "@tanstack/react-router";
import { pb, type UserRecord } from "@/lib/pocketbase";

export const Route = createFileRoute("/_authenticated/admin/accounts/logs")({
  beforeLoad: () => {
    const currentUser = pb.authStore.record as UserRecord | null;
    if (!currentUser || currentUser.role !== "admin") {
      throw redirect({ to: "/account", search: {} as never });
    }
    throw redirect({ to: "/admin/logs" });
  },
});
