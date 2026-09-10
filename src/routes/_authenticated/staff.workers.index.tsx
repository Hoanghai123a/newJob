import { createFileRoute } from "@tanstack/react-router";
import { StaffWorkerDirectoryPage } from "@/components/staff/StaffWorkerDirectory";

export const Route = createFileRoute("/_authenticated/staff/workers/")({
  component: StaffWorkersPage,
});

function StaffWorkersPage() {
  return <StaffWorkerDirectoryPage mode="all" />;
}
