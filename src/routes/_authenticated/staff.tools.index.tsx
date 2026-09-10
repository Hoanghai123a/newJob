import { createFileRoute } from "@tanstack/react-router";
import {
  BadgeDollarSign,
  BarChart3,
  BriefcaseBusiness,
  Download,
  FileCheck2,
  ListChecks,
  QrCode,
  UserPlus,
} from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { MobileSection } from "@/components/layout/MobileSection";
import { FeatureTile } from "@/components/dashboard/FeatureTile";
import { useStaffExcelExport } from "@/components/staff/staff-excel-export-context";

export const Route = createFileRoute("/_authenticated/staff/tools/")({
  component: StaffToolsPage,
});

function StaffToolsPage() {
  const { openStaffExcelExport } = useStaffExcelExport();

  return (
    <PageContainer title="Công cụ" subtitle="Các tiện ích nghiệp vụ của staff" back={false}>
      <MobileSection title="Quản lý người lao động">
        <div className="grid grid-cols-2 gap-3">
          <FeatureTile
            to="/staff/recruited"
            label="Đã tuyển"
            description="Theo dõi hồ sơ đã tuyển"
            icon={UserPlus}
            variant="accent"
          />
          <FeatureTile
            to="/staff/workforce"
            label="Nhân lực"
            description="Thống kê và phân bổ"
            icon={BriefcaseBusiness}
            variant="accent"
          />
          <FeatureTile
            to="/staff/salary-holds"
            label="Giữ lương"
            description="Theo dõi yêu cầu giữ lương"
            icon={FileCheck2}
          />
          <FeatureTile
            to="/staff/advances"
            label="Ứng lương"
            description="Xử lý yêu cầu ứng lương"
            icon={ListChecks}
          />
        </div>
      </MobileSection>
      <MobileSection title="Báo cáo và xuất dữ liệu">
        <div className="grid grid-cols-2 gap-3">
          <FeatureTile
            to="/staff/export"
            onClick={openStaffExcelExport}
            label="Xuất file"
            description="Tải dữ liệu báo cáo"
            icon={Download}
          />
          <FeatureTile
            to="/staff/approvals"
            label="Phê duyệt"
            description="Xử lý yêu cầu đang chờ"
            icon={ListChecks}
          />
          <FeatureTile
            to="/staff/workforce"
            label="Biểu đồ"
            description="Xem thống kê tuyển dụng"
            icon={BarChart3}
          />
        </div>
      </MobileSection>
      <MobileSection title="Tiện ích hỗ trợ">
        <div className="grid grid-cols-2 gap-3">
          <FeatureTile
            to="/staff/tools/qr"
            label="Tạo mã QR"
            description="Tạo QR chuyển khoản đơn hoặc hàng loạt"
            icon={QrCode}
            variant="accent"
          />
          <FeatureTile
            to="/staff/money-to-text"
            label="Đọc số tiền"
            description="Chuyển số tiền VND thành chữ"
            icon={BadgeDollarSign}
            variant="accent"
          />
        </div>
      </MobileSection>
    </PageContainer>
  );
}
