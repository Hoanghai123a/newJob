import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/admin/approvals")({
  beforeLoad: () => {
    throw redirect({ to: "/staff/approvals" });
  },
  component: () => null,
});
