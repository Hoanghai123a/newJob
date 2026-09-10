import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { UserRecord } from "@/lib/pocketbase";
import { fetchEmploymentHistories, type EmploymentHistoryRecord } from "@/lib/employment";
import { createSalaryHold, createSalaryHoldPayload, hasCompleteBank } from "@/lib/salary-holds";
import { createStaffActionLog } from "@/lib/staff-log";
import { formatMoneyInput, parseMoneyInput } from "@/lib/money";

function formatHistoryDate(value?: string, fallback = "Chưa có") {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("vi-VN");
}

function HistoryInformation({
  history,
  worker,
}: {
  history: EmploymentHistoryRecord;
  worker: UserRecord;
}) {
  const rows = [
    ["Mã NV", history.employee_code || "Chưa có"],
    ["Họ tên", history.worker_name_snapshot || worker.full_name || worker.username || "Chưa có"],
    ["Nhà máy", history.expand?.factory?.name || "Chưa có"],
    ["Ngày vào", formatHistoryDate(history.join_date)],
    ["Ngày nghỉ", formatHistoryDate(history.leave_date, "Chưa nghỉ")],
  ];

  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <span className="text-muted-foreground">{label}</span>
          <span className="min-w-0 break-words font-medium text-foreground">{value}</span>
        </div>
      ))}
    </div>
  );
}

export function SalaryHoldCreateDialog({
  open,
  onOpenChange,
  viewer,
  worker,
  history,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  viewer: UserRecord;
  worker: UserRecord | null;
  history: EmploymentHistoryRecord | null;
  onCreated?: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [content, setContent] = useState("");
  const [showBank, setShowBank] = useState(false);
  const [saving, setSaving] = useState(false);
  const [histories, setHistories] = useState<EmploymentHistoryRecord[]>([]);
  const [selectedHistory, setSelectedHistory] = useState<EmploymentHistoryRecord | null>(null);
  const [loadingHistories, setLoadingHistories] = useState(false);

  useEffect(() => {
    if (!open) {
      setAmount("");
      setContent("");
      setShowBank(false);
      setHistories([]);
      setSelectedHistory(null);
      setLoadingHistories(false);
      return;
    }

    setSelectedHistory(null);
    if (!worker?.id) {
      setHistories([]);
      return;
    }

    let active = true;
    setLoadingHistories(true);

    fetchEmploymentHistories([worker.id])
      .then((rows) => {
        if (!active) return;

        const selectableRows = rows.filter(
          (row) => row.user === worker.id && row.recruiter_staff === viewer.id,
        );
        if (
          history &&
          history.worker === worker.id &&
          history.recruiter_staff === viewer.id &&
          !selectableRows.some((row) => row.id === history.id)
        ) {
          selectableRows.push(history);
        }
        selectableRows.sort(
          (a, b) =>
            new Date(b.join_date || b.created || 0).getTime() -
            new Date(a.join_date || a.created || 0).getTime(),
        );
        setHistories(selectableRows);
      })
      .catch((error: any) => {
        if (!active) return;
        const fallback =
          history && history.worker === worker.id && history.recruiter_staff === viewer.id
            ? [history]
            : [];
        setHistories(fallback);
        toast.error(error?.message || "Không tải được lịch sử đi làm");
      })
      .finally(() => {
        if (active) setLoadingHistories(false);
      });

    return () => {
      active = false;
    };
  }, [history, open, viewer.id, worker?.id]);

  const submit = async () => {
    if (!worker || !selectedHistory) return toast.warning("Chọn lần đi làm cần giữ lương");
    const number = parseMoneyInput(amount);
    if (!number) return toast.warning("Nhập số tiền giữ lương");
    if (!content.trim()) return toast.warning("Nhập nội dung giữ lương");
    if (!hasCompleteBank(viewer))
      return toast.error("Staff cần cập nhật đầy đủ STK trước khi tạo yêu cầu");
    if (selectedHistory.recruiter_staff !== viewer.id)
      return toast.error("Bạn không phải người tuyển trong lần đi làm đã chọn");
    setSaving(true);
    try {
      const payload = createSalaryHoldPayload(viewer, worker, selectedHistory, number, content);
      const created = await createSalaryHold(payload);
      await createStaffActionLog({
        actor: viewer,
        targetUserId: worker.id,
        targetCollection: "salary_holds",
        targetRecord: created.id,
        action: "create",
        after: payload,
        note: "Staff tạo yêu cầu giữ lương",
      });
      toast.success("Đã gửi yêu cầu giữ lương");
      onOpenChange(false);
      onCreated?.();
    } catch (error: any) {
      toast.error(error?.message || "Không tạo được yêu cầu giữ lương");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !saving && onOpenChange(value)}>
      <DialogContent className="sm:max-w-lg">
        {!selectedHistory ? (
          <>
            <DialogHeader>
              <DialogTitle>Chọn lịch sử đi làm</DialogTitle>
              <DialogDescription>Chọn đúng lần đi làm cần báo giữ lương.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              {loadingHistories ? (
                <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Đang tải lịch sử đi làm...
                </div>
              ) : histories.length > 0 && worker ? (
                histories.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => setSelectedHistory(row)}
                    className="w-full rounded-xl border bg-card p-3 text-left transition hover:border-primary/50 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <HistoryInformation history={row} worker={worker} />
                  </button>
                ))
              ) : (
                <div className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                  Không có lịch sử đi làm phù hợp để báo giữ lương.
                </div>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Đóng
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Tạo yêu cầu giữ lương</DialogTitle>
              <DialogDescription>Yêu cầu sẽ được chuyển đến Admin tiếp nhận.</DialogDescription>
            </DialogHeader>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <button
                type="button"
                onClick={() => setSelectedHistory(null)}
                className="w-full rounded-xl border bg-muted/30 p-3 text-left transition hover:border-primary/50 hover:bg-muted/50"
              >
                <div className="mb-2 flex items-center justify-between gap-3 border-b pb-2">
                  <span className="font-semibold">Lần đi làm giữ lương</span>
                  <span className="shrink-0 text-xs font-medium text-primary">Đổi lần đi làm</span>
                </div>
                {worker && <HistoryInformation history={selectedHistory} worker={worker} />}
              </button>
              <div className="space-y-1">
                <Label>Số tiền</Label>
                <Input
                  inputMode="numeric"
                  value={formatMoneyInput(amount)}
                  onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
                  placeholder="Nhập số tiền"
                  className="bg-white text-slate-900 placeholder:text-slate-400"
                />
              </div>
              <div className="space-y-1">
                <Label>Nội dung</Label>
                <Textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Nhập nội dung giữ lương"
                  rows={3}
                  className="bg-white text-slate-900 placeholder:text-slate-400"
                />
              </div>
              <button
                type="button"
                onClick={() => setShowBank((v) => !v)}
                className="w-full rounded-xl border p-3 text-left text-sm"
              >
                <div className="font-medium">STK Staff nhận tiền</div>
                <div className="text-xs text-muted-foreground">
                  {showBank ? "Bấm để thu gọn" : "Bấm để xem chi tiết"}
                </div>
                {showBank && (
                  <div className="mt-2 border-t pt-2 text-xs">
                    <div>{viewer.bank_name || "Chưa có ngân hàng"}</div>
                    <div>{viewer.bank_account_number || "Chưa có số TK"}</div>
                    <div>{viewer.bank_account_name || "Chưa có tên TK"}</div>
                  </div>
                )}
              </button>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Đóng
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? "Đang gửi..." : "Gửi yêu cầu"}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
