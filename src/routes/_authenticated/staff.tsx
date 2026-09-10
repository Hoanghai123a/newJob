import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { pb, type UserRecord } from "@/lib/pocketbase";
import { canAccessStaffWorkspace } from "@/lib/staff-permissions";

export const Route = createFileRoute("/_authenticated/staff")({
  beforeLoad: () => {
    // PocketBase auth is restored only in the browser; do not redirect during SSR reload.
    if (typeof window === "undefined") return;
    const user = pb.authStore.record as UserRecord | null;
    if (!user || !canAccessStaffWorkspace(user)) {
      throw redirect({ to: "/" });
    }
  },
  component: StaffLayout,
});

function StaffLayout() {
  return <Outlet />;
}
