import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { EmploymentHistoryRecord } from "@/lib/employment";
import type { FactoryRecord } from "@/lib/factories";
import type { UserRecord } from "@/lib/pocketbase";
import { RecruitmentChart } from "./RecruitmentChart";

interface RecruitChartDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  histories: EmploymentHistoryRecord[];
  users: UserRecord[];
  factories: FactoryRecord[];
}

export function RecruitChartDialog({
  open,
  onOpenChange,
  histories,
  users,
  factories,
}: RecruitChartDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-2xl sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Biểu đồ tuyển dụng 7 ngày</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-y-auto">
          <RecruitmentChart histories={histories} users={users} factories={factories} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
