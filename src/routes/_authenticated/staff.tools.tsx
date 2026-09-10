import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/staff/tools")({
  component: StaffToolsLayout,
});

function StaffToolsLayout() {
  return <Outlet />;
}
