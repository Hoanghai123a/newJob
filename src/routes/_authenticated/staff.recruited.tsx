import { createFileRoute } from "@tanstack/react-router";
import { StaffWorkerDirectoryPage } from "@/components/staff/StaffWorkerDirectory";

export const Route = createFileRoute("/_authenticated/staff/recruited")({
  component: StaffRecruitedPage,
});

function StaffRecruitedPage() {
  return <StaffWorkerDirectoryPage mode="recruited" />;
}
