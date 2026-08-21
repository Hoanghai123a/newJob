import { createFileRoute } from "@tanstack/react-router";
import { MessageCircleMore, Newspaper, NotebookPen, Users } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { MobileSection } from "@/components/layout/MobileSection";
import { FeatureTile } from "@/components/dashboard/FeatureTile";

export const Route = createFileRoute("/_authenticated/exchange")({
  component: ExchangeHubPage,
});

function ExchangeHubPage() {
  return (
    <PageContainer title="Trao đổi" subtitle="Kết nối và sử dụng tiện ích" back={false}>
      <MobileSection title="Kết nối" description="Theo dõi thông tin mới và trao đổi với cộng đồng">
        <div className="grid grid-cols-2 gap-3">
          <FeatureTile
            to="/chat"
            label="Trò chuyện"
            description="Các phòng chat của bạn"
            icon={MessageCircleMore}
            variant="accent"
          />
          <FeatureTile
            to="/news"
            label="Tin tuyển dụng"
            description="Cơ hội mới nhất"
            icon={Newspaper}
            variant="accent"
          />
        </div>
      </MobileSection>
      <MobileSection title="Tiện ích hằng ngày">
        <div className="grid grid-cols-2 gap-3">
          <FeatureTile
            to="/notebook"
            label="Sổ tay"
            description="Ghi chú công việc"
            icon={NotebookPen}
          />
          <FeatureTile to="/counter" label="Bộ đếm" description="Công cụ nhanh" icon={Users} />
        </div>
      </MobileSection>
    </PageContainer>
  );
}
