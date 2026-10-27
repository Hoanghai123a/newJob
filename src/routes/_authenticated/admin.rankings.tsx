import { createFileRoute } from "@tanstack/react-router";
import { EmployeeRankingsPage } from "@/components/dashboard/EmployeeRankingsPage";

export const Route = createFileRoute("/_authenticated/admin/rankings")({
  component: EmployeeRankingsPage,
});
