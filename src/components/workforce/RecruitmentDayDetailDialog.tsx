import { useEffect, useState } from "react";
import { Building2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type RecruitmentBreakdownItem = {
  id: string;
  name: string;
  username: string;
  count: number;
  isVendor: boolean;
};

export type RecruitmentBreakdownGroup = {
  factoryId: string;
  factoryName: string;
  total: number;
  recruiters: RecruitmentBreakdownItem[];
};

export type RecruitmentDayWorkerRow = {
  id: string;
  factoryName: string;
  employeeCode: string;
  workerName: string;
  mainHouseName: string;
  recruiterName: string;
  joinDate: string;
};

export type RecruitmentDayDetails = {
  groups: RecruitmentBreakdownGroup[];
  workers: RecruitmentDayWorkerRow[];
};

function RecruitmentSummaryCard({ group }: { group: RecruitmentBreakdownGroup }) {
  const sortRecruiters = (items: RecruitmentBreakdownItem[]) =>
    [...items].sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name, "vi", { sensitivity: "base" }),
    );
  const internal = sortRecruiters(group.recruiters.filter((item) => !item.isVendor));
  const vendors = sortRecruiters(group.recruiters.filter((item) => item.isVendor));
  const internalTotal = internal.reduce((sum, item) => sum + item.count, 0);
  const vendorTotal = vendors.reduce((sum, item) => sum + item.count, 0);
  const internalPct = group.total ? Math.round((internalTotal / group.total) * 100) : 0;
  const vendorPct = group.total ? Math.round((vendorTotal / group.total) * 100) : 0;

  return (
    <section className="min-w-0 space-y-3 rounded-2xl border border-border/70 bg-card p-3 shadow-sm desktop:w-72 desktop:shrink-0">
      <div className="flex min-w-0 items-center gap-2 border-b border-border/60 pb-2 text-sm font-semibold">
        <Building2 className="h-4 w-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate" title={group.factoryName}>
          {group.factoryName}
        </span>
        <span className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-muted px-1.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
          {group.total}
        </span>
      </div>

      {internal.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
            <span>Nội bộ</span>
            <span className="ml-auto tabular-nums">
              {internalTotal} ({internalPct}%)
            </span>
          </div>
          <div className="space-y-1">
            {internal.map((item) => (
              <div key={item.id} className="flex min-w-0 items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate text-foreground" title={item.name}>
                  {item.name}
                </span>
                <span className="shrink-0 font-semibold tabular-nums text-primary">
                  {item.count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {vendors.length > 0 && (
        <div className="space-y-1.5 rounded-xl border border-purple-200 bg-purple-50/50 p-2.5 dark:border-purple-900 dark:bg-purple-950/20">
          <div className="flex items-center gap-2 text-[11px] font-semibold text-purple-700 dark:text-purple-300">
            <span>Đối tác</span>
            <span className="ml-auto tabular-nums">
              {vendorTotal} ({vendorPct}%)
            </span>
          </div>
          <div className="space-y-1">
            {vendors.map((item) => (
              <div key={item.id} className="flex min-w-0 items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate text-foreground" title={item.name}>
                  {item.name}
                </span>
                <span className="shrink-0 font-semibold tabular-nums text-purple-700 dark:text-purple-300">
                  {item.count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function DesktopWorkerTable({ workers }: { workers: RecruitmentDayWorkerRow[] }) {
  return (
    <div className="hidden overflow-x-hidden rounded-2xl border border-border/70 sm:block">
      <table className="w-full min-w-0 table-fixed border-collapse text-left text-sm">
        <thead className="sticky top-0 z-10 bg-muted/95 text-xs font-semibold text-muted-foreground backdrop-blur">
          <tr>
            <th className="px-4 py-3">Công ty</th>
            <th className="px-4 py-3">Mã NV</th>
            <th className="px-4 py-3">Họ và tên</th>
            <th className="px-4 py-3">Nhà chính</th>
            <th className="px-4 py-3">Người tuyển</th>
            <th className="px-4 py-3">Ngày vào làm</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/70">
          {workers.map((worker) => (
            <tr key={worker.id} className="bg-background transition-colors hover:bg-muted/30">
              <td className="px-4 py-3 font-medium text-primary">{worker.factoryName}</td>
              <td className="px-4 py-3 text-muted-foreground">{worker.employeeCode}</td>
              <td className="px-4 py-3 font-medium">{worker.workerName}</td>
              <td className="px-4 py-3">{worker.mainHouseName}</td>
              <td className="px-4 py-3">{worker.recruiterName}</td>
              <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                {worker.joinDate}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MobileWorkerCards({ workers }: { workers: RecruitmentDayWorkerRow[] }) {
  return (
    <div className="space-y-2 sm:hidden">
      {workers.map((worker) => (
        <article
          key={worker.id}
          className="space-y-3 rounded-2xl border border-border/70 bg-card p-3"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="break-words text-sm font-semibold">{worker.workerName}</div>
              <div className="mt-0.5 text-xs font-medium text-primary">{worker.factoryName}</div>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">{worker.joinDate}</span>
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
            <div>
              <dt className="text-muted-foreground">Mã NV</dt>
              <dd className="mt-0.5 font-medium">{worker.employeeCode}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Nhà chính</dt>
              <dd className="mt-0.5 font-medium">{worker.mainHouseName}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-muted-foreground">Người tuyển</dt>
              <dd className="mt-0.5 font-medium">{worker.recruiterName}</dd>
            </div>
          </dl>
        </article>
      ))}
    </div>
  );
}

export function RecruitmentDayDetailDialog({
  open,
  onOpenChange,
  selectedDay,
  details,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedDay: string;
  details: RecruitmentDayDetails;
}) {
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    setShowDetails(false);
  }, [open, selectedDay]);

  const selectedDayLabel = selectedDay
    ? new Date(`${selectedDay}T12:00:00`).toLocaleDateString("vi-VN")
    : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        layout="raw"
        className="max-h-[92dvh] w-[calc(100%-1rem)] max-w-none overflow-hidden p-0 sm:w-[calc(100%-2rem)] desktop:w-[98vw] desktop:max-w-[98vw]"
      >
        <DialogHeader className="border-b px-4 pb-4 pt-5 pr-14 sm:px-5">
          <DialogTitle className="pr-2 text-left text-base leading-snug sm:text-lg">
            Người lao động vào làm ngày {selectedDayLabel} ({details.workers.length} người)
          </DialogTitle>
          <DialogDescription className="text-left">
            Thống kê theo nhà máy và người tuyển trong ngày đã chọn.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[calc(92dvh-6.5rem)] overflow-y-auto px-4 pb-5 sm:px-5">
          {details.groups.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              Không có người lao động vào làm trong ngày này.
            </div>
          ) : (
            <>
              <div className="mt-4 grid gap-3 desktop:flex desktop:overflow-x-auto desktop:pb-2">
                {details.groups.map((group) => (
                  <RecruitmentSummaryCard key={group.factoryId} group={group} />
                ))}
              </div>

              <div className="my-4 flex justify-center">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-expanded={showDetails}
                  onClick={() => setShowDetails((current) => !current)}
                >
                  {showDetails ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                  {showDetails ? "Ẩn chi tiết" : "Hiển thị chi tiết"}
                </Button>
              </div>

              {showDetails && (
                <div className="space-y-2">
                  <DesktopWorkerTable workers={details.workers} />
                  <MobileWorkerCards workers={details.workers} />
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
