import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/pending")({
  beforeLoad: () => {
    throw redirect({ to: "/login" });
  },
  component: () => null,
});
