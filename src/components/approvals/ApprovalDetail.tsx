import { useState } from "react";
import type { ApprovalRequestRecord, ApprovalResponseRecord } from "@/lib/approval-requests";
import {
  respondToApproval,
  markRequestCompleted,
  withdrawApprovalRequest,
  getRequestFileUrl,
} from "@/lib/approval-requests";
import { userDisplayName } from "@/lib/delegations";
import { formatMoneyInput } from "@/lib/money";
import type { UserRecord } from "@/lib/pocketbase";
import { StatusChip, type ChipTone } from "@/components/ui/status-chip";
import { ImageViewer } from "./ImageViewer";
import { ExcelPreview } from "./ExcelPreview";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ResponsiveOverlay } from "@/components/layout/ResponsiveOverlay";
import { toast } from "@/lib/toast";
import { Check, X, CheckCircle2, Clock, Undo2 } from "lucide-react";

const STATUS_TONE: Record<string, ChipTone> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  completed: "info",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Chờ duyệt",
  approved: "Đã duyệt",
  rejected: "Từ chối",
  completed: "Hoàn thành",
};

function formatTime(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ApprovalDetail({
  open,
  onOpenChange,
  request,
  responses,
  currentUserId,
  isAdmin,
  onUpdated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  request: ApprovalRequestRecord | null;
  responses: ApprovalResponseRecord[];
  currentUserId: string;
  isAdmin: boolean;
  onUpdated: () => void;
}) {
  const [note, setNote] = useState("");
  const [acting, setActing] = useState(false);

  if (!request) return null;

  const myResponse = responses.find((r) => r.admin === currentUserId);
  const canRespond = isAdmin && request.status === "pending" && myResponse?.status === "pending";
  const canComplete = request.status === "approved" && request.creator === currentUserId;
  const canWithdraw = request.creator === currentUserId && request.status === "pending";

  const images = (request.images || []).map((filename) => ({
    url: getRequestFileUrl(request, filename),
    thumbUrl: getRequestFileUrl(request, filename, "200x200"),
  }));

  const excelFiles = (request.excel_files || []).map((filename) => ({
    url: getRequestFileUrl(request, filename),
    filename,
  }));

  async function handleRespond(status: "approved" | "rejected") {
    if (!myResponse) return;
    setActing(true);
    try {
      await respondToApproval(myResponse.id, status, note.trim());
      toast.success(status === "approved" ? "Đã phê duyệt" : "Đã từ chối");
      setNote("");
      onOpenChange(false);
      onUpdated();
    } catch {
      toast.error("Có lỗi xảy ra");
    } finally {
      setActing(false);
    }
  }

  async function handleComplete() {
    setActing(true);
    try {
      await markRequestCompleted(request!.id);
      toast.success("Đã đánh dấu hoàn thành");
      onOpenChange(false);
      onUpdated();
    } catch {
      toast.error("Có lỗi xảy ra");
    } finally {
      setActing(false);
    }
  }

  async function handleWithdraw() {
    setActing(true);
    try {
      await withdrawApprovalRequest(request!.id);
      toast.success("Đã thu hồi yêu cầu");
      onOpenChange(false);
      onUpdated();
    } catch {
      toast.error("Không thể thu hồi");
    } finally {
      setActing(false);
    }
  }

  return (
    <ResponsiveOverlay
      open={open}
      onOpenChange={onOpenChange}
      title={request.title}
      description={`${STATUS_LABEL[request.status]} · ${formatTime(request.created)}`}
      presentation="full"
      className="desktop:max-w-lg"
      contentProps={{
        onEscapeKeyDown: (event) => {
          if (document.body.dataset.approvalImageViewerOpen === "true") event.preventDefault();
        },
        onInteractOutside: (event) => {
          if (document.body.dataset.approvalImageViewerOpen === "true") event.preventDefault();
        },
      }}
    >
      <div className="space-y-4 pt-2">
        {request.content && <div className="whitespace-pre-wrap text-sm">{request.content}</div>}

        {Number(request.amount) > 0 && (
          <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 dark:border-emerald-900/60 dark:bg-emerald-950/30">
            <span className="text-sm text-muted-foreground">Số tiền</span>
            <span className="text-base font-semibold text-emerald-700 dark:text-emerald-300">
              {formatMoneyInput(request.amount)}đ
            </span>
          </div>
        )}

        <ImageViewer images={images} />

        {excelFiles.map((ef) => (
          <ExcelPreview key={ef.filename} url={ef.url} filename={ef.filename} />
        ))}

        <div className="space-y-2 rounded-xl border p-3">
          <div className="text-xs font-medium text-muted-foreground">
            Phê duyệt của quản trị viên
          </div>
          {responses.map((resp) => (
            <div key={resp.id} className="flex items-start gap-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{userDisplayName(resp.expand?.admin)}</div>
                {resp.note && <div className="text-xs text-muted-foreground">"{resp.note}"</div>}
                {resp.responded_at && (
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {formatTime(resp.responded_at)}
                  </div>
                )}
              </div>
              <StatusChip tone={STATUS_TONE[resp.status]}>{STATUS_LABEL[resp.status]}</StatusChip>
            </div>
          ))}
        </div>

        {request.completed_at && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 text-blue-500" />
            Nhân viên xác nhận hoàn thành: {formatTime(request.completed_at)}
          </div>
        )}

        {canRespond && (
          <div className="space-y-2 border-t pt-3">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ghi chú (bắt buộc khi từ chối)"
              className="min-h-16 rounded-xl text-sm"
            />
            <div className="flex gap-2">
              <Button
                onClick={() => handleRespond("approved")}
                disabled={acting}
                className="flex-1 gap-1.5 rounded-xl"
              >
                <Check className="h-4 w-4" />
                Phê duyệt
              </Button>
              <Button
                onClick={() => {
                  if (!note.trim()) {
                    toast.error("Vui lòng nhập lý do từ chối");
                    return;
                  }
                  handleRespond("rejected");
                }}
                disabled={acting}
                variant="destructive"
                className="flex-1 gap-1.5 rounded-xl"
              >
                <X className="h-4 w-4" />
                Từ chối
              </Button>
            </div>
          </div>
        )}

        {canComplete && (
          <div className="border-t pt-3">
            <Button
              onClick={handleComplete}
              disabled={acting}
              className="w-full gap-1.5 rounded-xl"
              variant="outline"
            >
              <CheckCircle2 className="h-4 w-4" />
              Đánh dấu hoàn thành
            </Button>
          </div>
        )}

        {canWithdraw && (
          <div className="border-t pt-3">
            <Button
              onClick={handleWithdraw}
              disabled={acting}
              variant="destructive"
              className="w-full gap-1.5 rounded-xl"
            >
              <Undo2 className="h-4 w-4" />
              Thu hồi yêu cầu
            </Button>
          </div>
        )}
      </div>
    </ResponsiveOverlay>
  );
}
