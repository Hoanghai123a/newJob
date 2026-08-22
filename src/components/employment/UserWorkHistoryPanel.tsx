import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Eye, IdCard, NotebookPen, ZoomIn } from "lucide-react";
import { toast } from "@/lib/toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { DataLoadingState } from "@/components/ui/data-loading-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { fileUrl } from "@/lib/pocketbase";
import type { CccdVersionRecord } from "@/lib/cccd-versions";
import { getUserErrorMessage } from "@/lib/toast";
import { findWorkerByAuthUser } from "@/lib/workers";
import {
  fetchEmploymentHistories,
  isCurrentlyWorking,
  maskCccd,
  type EmploymentHistoryRecord,
} from "@/lib/employment";

function SnapshotRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium">{value || "Chưa có"}</div>
    </div>
  );
}

function versionedCccdUrl(version: CccdVersionRecord | undefined, filename?: string) {
  const url = fileUrl(version, filename);
  if (!url || !version) return "";
  const cacheKey = version.updated || version.id;
  return url + (url.includes("?") ? "&" : "?") + "v=" + encodeURIComponent(cacheKey);
}

function CccdImageSlot({
  label,
  url,
  onPreview,
}: {
  label: string;
  url: string;
  onPreview: () => void;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      {url ? (
        <button
          type="button"
          onClick={onPreview}
          className="group relative block aspect-[1.586/1] w-full overflow-hidden rounded-xl border bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label={`Xem ảnh CCCD ${label.toLowerCase()}`}
        >
          <img
            src={url}
            alt={`CCCD ${label.toLowerCase()}`}
            className="h-full w-full object-contain"
          />
          <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-gradient-to-t from-black/65 to-transparent px-2 pb-2 pt-5 text-[11px] font-medium text-white">
            <ZoomIn className="h-3.5 w-3.5" /> Nhấn để xem
          </span>
        </button>
      ) : (
        <div className="flex aspect-[1.586/1] w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border bg-muted/20 text-muted-foreground">
          <IdCard className="h-5 w-5" />
          <span className="text-[11px]">Chưa có ảnh</span>
        </div>
      )}
    </div>
  );
}

function SnapshotCccdImages({
  version,
  onPreview,
}: {
  version?: CccdVersionRecord;
  onPreview: (src: string, label: string) => void;
}) {
  const frontUrl = versionedCccdUrl(version, version?.front_image);
  const backUrl = versionedCccdUrl(version, version?.back_image);

  return (
    <div className="space-y-2 rounded-xl border border-border/60 p-3">
      <div>
        <div className="text-sm font-medium">Ảnh CCCD tại thời điểm đi làm</div>
        <div className="text-[11px] text-muted-foreground">Nhấn vào ảnh để xem kích thước lớn.</div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        <CccdImageSlot
          label="Mặt trước"
          url={frontUrl}
          onPreview={() => onPreview(frontUrl, "CCCD mặt trước")}
        />
        <CccdImageSlot
          label="Mặt sau"
          url={backUrl}
          onPreview={() => onPreview(backUrl, "CCCD mặt sau")}
        />
      </div>
      {!frontUrl && !backUrl && (
        <div className="text-[11px] text-muted-foreground">Lịch sử này chưa được lưu ảnh CCCD.</div>
      )}
    </div>
  );
}

function formatDate(value?: string) {
  if (!value) return "Chưa có";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("vi-VN");
}

function errorMessage(error: unknown, fallback: string) {
  return getUserErrorMessage(error, fallback);
}

export function UserWorkHistoryPanel() {
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [histories, setHistories] = useState<EmploymentHistoryRecord[]>([]);
  const [selectedHistory, setSelectedHistory] = useState<EmploymentHistoryRecord | null>(null);
  const [previewImage, setPreviewImage] = useState<{ src: string; label: string } | null>(null);

  const loadAll = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const historyRows = await fetchEmploymentHistories([user.id]);
      setHistories(historyRows);
    } catch (error: unknown) {
      toast.error(errorMessage(error, "Không tải được lịch sử đi làm"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const activeHistory = useMemo(
    () => histories.find((item) => isCurrentlyWorking(item)) || null,
    [histories],
  );

  return (
    <div className="space-y-3">
      <Card className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold">Trạng thái hiện tại</div>
            <div className="text-[11px] text-muted-foreground">
              {activeHistory
                ? "Đang làm tại " + (activeHistory.expand?.factory?.name || "nhà máy")
                : "Bạn chưa khai báo nhà máy đang làm"}
            </div>
          </div>
          <StatusChip tone={activeHistory ? "success" : "neutral"}>
            {activeHistory ? "Đang làm" : "Đang nghỉ"}
          </StatusChip>
        </div>
      </Card>

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <CalendarClock className="h-4 w-4" /> Lịch sử đi làm
        </div>

        {loading ? (
          <DataLoadingState variant="list" label="Đang tải lịch sử đi làm..." rows={3} />
        ) : histories.length === 0 ? (
          <EmptyState
            icon={NotebookPen}
            title="Chưa có lịch sử đi làm"
            description="Liên hệ người tuyển hoặc QLNM để được ghi nhận nhà máy đi làm."
          />
        ) : (
          histories.map((history) => (
            <Card key={history.id} className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">
                    {history.expand?.factory?.name || "Nhà máy"}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Mã NV: {history.employee_code || "Chưa có"}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Họ tên (NM): {history.worker_name_snapshot || "—"} · CCCD:{" "}
                    {maskCccd(history.worker_cccd_snapshot)}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Mã số thuế: {history.worker_tax_code_snapshot || "Chưa có"}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Nhà chính: {history.expand?.main_house?.name || "Chưa gán"}
                  </div>
                </div>
                <StatusChip tone={isCurrentlyWorking(history) ? "success" : "neutral"}>
                  {isCurrentlyWorking(history) ? "Đang làm" : "Đã nghỉ"}
                </StatusChip>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-2xl bg-muted/35 p-3">
                  <div className="text-[11px] text-muted-foreground">Ngày vào</div>
                  <div className="mt-1 text-sm font-semibold">{formatDate(history.join_date)}</div>
                </div>
                <div className="rounded-2xl bg-muted/35 p-3">
                  <div className="text-[11px] text-muted-foreground">Ngày nghỉ</div>
                  <div className="mt-1 text-sm font-semibold">{formatDate(history.leave_date)}</div>
                </div>
              </div>
              {history.note && (
                <div className="rounded-xl bg-muted/40 p-3 text-sm text-muted-foreground">
                  {history.note}
                </div>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full rounded-xl"
                onClick={() => setSelectedHistory(history)}
              >
                <Eye className="h-4 w-4" /> Xem thông tin cá nhân
              </Button>
            </Card>
          ))
        )}
      </div>

      <Dialog
        open={Boolean(selectedHistory)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedHistory(null);
            setPreviewImage(null);
          }
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle>Thông tin cá nhân tại thời điểm đi làm</DialogTitle>
            <DialogDescription>
              Dữ liệu được lưu riêng theo lịch sử, không thay đổi theo hồ sơ hiện tại.
            </DialogDescription>
          </DialogHeader>
          {selectedHistory && (
            <div className="space-y-2 text-sm">
              <SnapshotRow label="Họ tên" value={selectedHistory.worker_name_snapshot} />
              <SnapshotRow label="CCCD" value={maskCccd(selectedHistory.worker_cccd_snapshot)} />
              <SnapshotRow
                label="Ngày sinh"
                value={formatDate(selectedHistory.worker_date_of_birth_snapshot)}
              />
              <SnapshotRow
                label="Ngày cấp CCCD"
                value={formatDate(selectedHistory.cccd_issue_date)}
              />
              <SnapshotRow
                label="Địa chỉ thường trú"
                value={
                  selectedHistory.worker_address_snapshot ||
                  selectedHistory.hometown_snapshot ||
                  "Chưa có"
                }
              />
              <SnapshotCccdImages
                version={selectedHistory.expand?.cccd_version}
                onPreview={(src, label) => src && setPreviewImage({ src, label })}
              />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSelectedHistory(null)}>
              Đóng
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(previewImage)} onOpenChange={(open) => !open && setPreviewImage(null)}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-3xl rounded-2xl p-2 sm:p-4">
          <DialogHeader className="px-1 pt-1">
            <DialogTitle>{previewImage?.label || "Ảnh CCCD"}</DialogTitle>
            <DialogDescription>Ảnh CCCD được lưu cùng lịch sử đi làm.</DialogDescription>
          </DialogHeader>
          {previewImage && (
            <div className="flex max-h-[calc(100dvh-8rem)] items-center justify-center overflow-auto rounded-xl bg-muted/30">
              <img
                src={previewImage.src}
                alt={previewImage.label}
                className="h-auto max-h-[calc(100dvh-8rem)] w-auto max-w-full rounded-xl object-contain"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
