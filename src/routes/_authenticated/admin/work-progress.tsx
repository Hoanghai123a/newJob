import { createFileRoute, redirect } from "@tanstack/react-router";
import { WorkProgressBoard } from "@/components/dashboard/WorkProgressBoard";
import { PageContainer } from "@/components/layout/PageContainer";
import { pb, type UserRecord } from "@/lib/pocketbase";

export const Route = createFileRoute("/_authenticated/admin/work-progress")({
  beforeLoad: () => {
    const currentUser = pb.authStore.record as UserRecord | null;
    if (!currentUser || currentUser.role !== "admin") throw redirect({ to: "/" });
  },
  component: AdminWorkProgressPage,
});

function AdminWorkProgressPage() {
  return (
    <PageContainer
      title="Tiến độ công việc"
      subtitle="Quản lý công việc dùng chung giữa các Admin"
      desktopWidth="wide"
      showNav
    >
      <WorkProgressBoard />
    </PageContainer>
  );
}
