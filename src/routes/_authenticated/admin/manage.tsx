import { createFileRoute, redirect } from "@tanstack/react-router";
import { Database, FileInput, Factory, Settings, ShieldCheck, Upload, Users } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { MobileSection } from "@/components/layout/MobileSection";
import { FeatureTile } from "@/components/dashboard/FeatureTile";
import { pb, type UserRecord } from "@/lib/pocketbase";

export const Route = createFileRoute("/_authenticated/admin/manage")({
  beforeLoad: () => {
    const currentUser = pb.authStore.record as UserRecord | null;
    if (typeof window !== "undefined" && currentUser?.role !== "admin") {
      throw redirect({ to: "/" });
    }
  },
  component: AdminManagePage,
});

function AdminManagePage() {
  return (
    <PageContainer title="Quản trị" subtitle="Cấu hình và dữ liệu hệ thống" back={false}>
      <MobileSection title="Tài khoản và phân quyền">
        <div className="grid grid-cols-2 gap-3">
          <FeatureTile
            to="/admin/accounts"
            label="Tài khoản NLĐ"
            description="Quản lý người dùng"
            icon={Users}
            variant="accent"
          />
          <FeatureTile
            to="/admin/staff"
            label="Nhân viên quản lý"
            description="Quản lý nhân sự nội bộ"
            icon={ShieldCheck}
            variant="accent"
          />
          <FeatureTile
            to="/admin/accounts/stats"
            label="Thống kê tài khoản"
            description="Theo dõi hoạt động"
            icon={Database}
          />
        </div>
      </MobileSection>
      <MobileSection title="Dữ liệu và cấu hình">
        <div className="grid grid-cols-2 gap-3">
          <FeatureTile
            to="/admin/imports"
            label="Nhập dữ liệu"
            description="Nhập Excel và đồng bộ"
            icon={Upload}
          />
          <FeatureTile
            to="/admin/accounts/factories"
            label="Nhà máy"
            description="Quản lý nhà máy"
            icon={Factory}
          />
          <FeatureTile
            to="/admin/settings"
            label="Cài đặt"
            description="Thiết lập hệ thống"
            icon={Settings}
          />
          <FeatureTile
            to="/admin/logs"
            label="Nhật ký"
            description="Theo dõi thao tác"
            icon={FileInput}
          />
        </div>
      </MobileSection>
    </PageContainer>
  );
}
