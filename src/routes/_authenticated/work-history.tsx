import { createFileRoute, redirect } from "@tanstack/react-router";
import { AppHeader } from "@/components/layout/BottomNav";
import { UserWorkHistoryPanel } from "@/components/employment/UserWorkHistoryPanel";

export const Route = createFileRoute("/_authenticated/work-history")({
  beforeLoad: () => {
    throw redirect({ to: "/staff/workers" });
  },
  component: WorkHistoryPage,
});

function WorkHistoryPage() {
  return (
    <div>
      <AppHeader title="Lịch sử đi làm" />
      <div className="space-y-4 p-4">
        <UserWorkHistoryPanel />
      </div>
    </div>
  );
}
