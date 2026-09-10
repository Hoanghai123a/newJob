import { createFileRoute, redirect } from "@tanstack/react-router";
import { pb, type UserRecord } from "@/lib/pocketbase";
import { PageContainer } from "@/components/layout/PageContainer";
import { AccountActivityStats } from "@/components/admin/AccountActivityStats";

export const Route = createFileRoute("/_authenticated/admin/accounts/stats")({
  beforeLoad: () => {
    const currentUser = pb.authStore.record as UserRecord | null;
    if (!currentUser || currentUser.role !== "admin") throw redirect({ to: "/" });
  },
  component: AccountStatsPage,
});

function AccountStatsPage() {
  return (
    <PageContainer title="Thống kê tài khoản" subtitle="Theo dõi đăng nhập phân loại theo role">
      <AccountActivityStats />
    </PageContainer>
  );
}
