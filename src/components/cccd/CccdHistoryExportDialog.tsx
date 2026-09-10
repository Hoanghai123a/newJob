import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  AlertTriangle,
  Archive,
  CalendarRange,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  Upload,
  XCircle,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FactoryMultiSelect } from "@/components/factories/FactoryMultiSelect";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  exportCccdHistoryArchive,
  filterCccdHistoriesByLeaveDate,
  matchCccdHistoriesFromExcelRows,
  prepareCccdHistoryExport,
  type CccdHistoryExcelMatchResult,
  type CccdHistoryExportMode,
  type CccdHistoryExportProgress,
  type CccdHistoryPreparation,
  type CccdHistorySelectionSource,
} from "@/lib/cccd-history-export";
import { exportToExcel, parseExcelToRows } from "@/lib/excel";
import type { EmploymentHistoryRecord } from "@/lib/employment";
import type { FactoryRecord } from "@/lib/factories";
import type { UserRecord } from "@/lib/pocketbase";
import { getUserErrorMessage } from "@/lib/toast";

const LARGE_EXPORT_THRESHOLD = 1_000;

function exportExcelIssues(result: CccdHistoryExcelMatchResult) {
  if (!result.issues.length) return;
  exportToExcel(`doi_chieu_xuat_anh_cccd_${Date.now()}`, {
    "Dòng cần kiểm tra": result.issues.map((issue) => ({
      "Dòng Excel": issue.rowNumber,
      "Mã nhân viên": issue.employeeCode,
      "Tên nhà máy": issue.factoryName,
      "Họ tên": issue.workerName,
      "Lý do": issue.reason,
      "Mã lịch sử đã chọn": issue.selectedHistoryId || "",
      "Ngày vào đã chọn": issue.selectedJoinDate || "",
    })),
  });
}

export function CccdHistoryExportDialog({
  open,
  onClose,
  histories,
  users,
  factories,
}: {
  open: boolean;
  onClose: () => void;
  histories: EmploymentHistoryRecord[];
  users: UserRecord[];
  factories: FactoryRecord[];
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<CccdHistorySelectionSource>("date-range");
  const [mode, setMode] = useState<CccdHistoryExportMode>("folders");
  const [factoryIds, setFactoryIds] = useState<string[]>([]);
  const [endDate, setEndDate] = useState("");
  const [excelFileName, setExcelFileName] = useState("");
  const [excelResult, setExcelResult] = useState<CccdHistoryExcelMatchResult | null>(null);
  const [excelReading, setExcelReading] = useState(false);
  const [largeExportConfirmed, setLargeExportConfirmed] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [preparationCancelled, setPreparationCancelled] = useState(false);
  const [preparation, setPreparation] = useState<CccdHistoryPreparation | null>(null);
  const activeControllerRef = useRef<AbortController | null>(null);
  const cancelRequestedRef = useRef(false);
  const [progressState, setProgressState] = useState<CccdHistoryExportProgress>({
    completed: 0,
    total: 0,
    message: "",
  });
  const busy = excelReading || preparing || exporting;
  const dateSelectionValid = factoryIds.length > 0 && Boolean(endDate);

  const selectedHistories = useMemo(() => {
    if (source === "excel") return excelResult?.histories ?? [];
    return filterCccdHistoriesByLeaveDate(histories, factoryIds, endDate);
  }, [endDate, excelResult, factoryIds, histories, source]);

  const selectionReady =
    source === "date-range"
      ? dateSelectionValid
      : Boolean(excelResult && !excelResult.blockingError);
  const largeSelection = selectedHistories.length > LARGE_EXPORT_THRESHOLD;

  useEffect(() => {
    if (open) return;
    setSource("date-range");
    setMode("folders");
    setFactoryIds([]);
    setEndDate("");
    setExcelFileName("");
    setExcelResult(null);
    setLargeExportConfirmed(false);
    activeControllerRef.current?.abort();
    activeControllerRef.current = null;
    cancelRequestedRef.current = false;
    setCancelling(false);
    setPreparationCancelled(false);
    setPreparation(null);
    setProgressState({ completed: 0, total: 0, message: "" });
  }, [open]);

  useEffect(() => {
    setLargeExportConfirmed(false);
  }, [selectedHistories]);

  useEffect(() => {
    if (!open || !selectionReady || preparationCancelled || excelReading) {
      if (!open || !selectionReady) {
        setPreparation(null);
        setPreparing(false);
      }
      return;
    }

    const controller = new AbortController();
    activeControllerRef.current = controller;
    cancelRequestedRef.current = false;
    let alive = true;
    setPreparationCancelled(false);
    setPreparation(null);
    setPreparing(true);
    setCancelling(false);
    setProgressState({ completed: 0, total: 0, message: "Đang đọc dữ liệu CCCD..." });
    prepareCccdHistoryExport(
      selectedHistories,
      users,
      factories,
      source === "excel" ? "source" : "default",
      controller.signal,
    )
      .then((result) => {
        if (alive) setPreparation(result);
      })
      .catch((error: unknown) => {
        if (!alive) return;
        if (controller.signal.aborted && cancelRequestedRef.current) {
          setPreparationCancelled(true);
          toast.success("Đã hủy quá trình xuất ảnh CCCD.");
          return;
        }
        toast.error(getUserErrorMessage(error, "Không đọc được dữ liệu CCCD"));
      })
      .finally(() => {
        if (alive) {
          setPreparing(false);
          setCancelling(false);
        }
        if (activeControllerRef.current === controller) activeControllerRef.current = null;
      });

    return () => {
      alive = false;
      controller.abort();
      if (activeControllerRef.current === controller) activeControllerRef.current = null;
    };
  }, [
    excelReading,
    factories,
    open,
    preparationCancelled,
    selectedHistories,
    selectionReady,
    source,
    users,
  ]);

  const handleExcelFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || excelReading || exporting) return;

    const controller = new AbortController();
    activeControllerRef.current = controller;
    cancelRequestedRef.current = false;
    setCancelling(false);
    setExcelReading(true);
    setExcelFileName(file.name);
    setExcelResult(null);
    setLargeExportConfirmed(false);
    setPreparation(null);
    setProgressState({ completed: 0, total: 0, message: "Đang đọc file Excel..." });
    try {
      const rows = await parseExcelToRows(file);
      controller.signal.throwIfAborted();
      const result = matchCccdHistoriesFromExcelRows(rows, histories, factories);
      controller.signal.throwIfAborted();
      setExcelResult(result);

      if (result.issues.length) exportExcelIssues(result);
      if (result.blockingError) {
        toast.error(result.blockingError);
      } else if (!result.histories.length) {
        toast.warning("Không khớp được lịch sử đi làm nào từ file Excel");
      } else if (result.issues.length) {
        toast.warning(
          `Đã khớp ${result.histories.length} lịch sử và tải file đối chiếu ${result.issues.length} dòng cần kiểm tra.`,
        );
      } else {
        toast.success(`Đã khớp ${result.histories.length} lịch sử đi làm.`);
      }
    } catch (error: unknown) {
      if (controller.signal.aborted && cancelRequestedRef.current) {
        toast.success("Đã hủy quá trình xuất ảnh CCCD.");
      } else {
        setExcelFileName("");
        toast.error(getUserErrorMessage(error, "Không đọc được file Excel"));
      }
    } finally {
      if (activeControllerRef.current === controller) activeControllerRef.current = null;
      setExcelReading(false);
      setCancelling(false);
    }
  };

  const startExport = async () => {
    if (!preparation || busy || cancelling) return;
    if (!preparation.stats.full && !preparation.stats.partial) {
      toast.warning("Không có ảnh CCCD phù hợp để xuất");
      return;
    }

    const controller = new AbortController();
    activeControllerRef.current = controller;
    cancelRequestedRef.current = false;
    setExporting(true);
    setCancelling(false);
    setProgressState({ completed: 0, total: 0, message: "Đang chuẩn bị xuất..." });
    try {
      const result = await exportCccdHistoryArchive(
        mode,
        preparation,
        setProgressState,
        controller.signal,
      );
      toast.success(
        `Đã xuất ${result.exported} lịch sử (${result.full} đủ 2 mặt, ${result.partial} thiếu 1 mặt).`,
      );
      if (result.missing || result.failedImages) {
        toast.warning(
          `Bỏ qua ${result.missing} lịch sử không có ảnh và ${result.failedImages} ảnh tải lỗi.`,
        );
      }
      onClose();
    } catch (error: unknown) {
      if (controller.signal.aborted && cancelRequestedRef.current) {
        toast.success("Đã hủy quá trình xuất ảnh CCCD.");
      } else {
        toast.error(getUserErrorMessage(error, "Lỗi xuất ảnh CCCD"));
      }
    } finally {
      if (activeControllerRef.current === controller) activeControllerRef.current = null;
      setExporting(false);
      setCancelling(false);
    }
  };

  const cancelCurrentTask = () => {
    if (!busy || cancelling) return;
    cancelRequestedRef.current = true;
    setCancelling(true);
    activeControllerRef.current?.abort();
  };

  const retryPreparation = () => {
    if (busy) return;
    setPreparationCancelled(false);
  };

  const progressValue =
    progressState.total > 0
      ? Math.min(100, Math.round((progressState.completed / progressState.total) * 100))
      : busy
        ? 8
        : 0;

  return (
    <Dialog open={open} onOpenChange={(value) => !value && !busy && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-xl overflow-y-auto rounded-2xl p-4 sm:p-5">
        <DialogHeader>
          <DialogTitle>Xuất ảnh CCCD theo lịch sử đi làm</DialogTitle>
          <DialogDescription>
            Chọn khoảng ngày và nhà máy hoặc đối chiếu danh sách từ file Excel.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <SelectionSourceButton
              active={source === "date-range"}
              icon={CalendarRange}
              title="Khoảng ngày"
              description="Ngày vào và nhà máy"
              onClick={() => setSource("date-range")}
              disabled={busy}
            />
            <SelectionSourceButton
              active={source === "excel"}
              icon={FileSpreadsheet}
              title="Danh sách Excel"
              description="Mã NV và nhà máy"
              onClick={() => setSource("excel")}
              disabled={busy}
            />
          </div>

          {source === "date-range" ? (
            <div className="space-y-3 rounded-2xl border border-border/60 bg-muted/20 p-3">
              <FactoryMultiSelect
                factories={factories}
                selectedIds={factoryIds}
                onChange={setFactoryIds}
                disabled={busy}
              />
              <div className="rounded-xl bg-background/70 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
                Xuất NLĐ chưa có ngày nghỉ hoặc có ngày nghỉ không muộn hơn ngày kết thúc.
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Ngày kết thúc</Label>
                <DateInput value={endDate} onChange={setEndDate} disabled={busy} />
              </div>
              {!endDate && (
                <div className="text-xs text-destructive">Vui lòng chọn ngày kết thúc.</div>
              )}
              {!factoryIds.length && (
                <div className="text-xs text-destructive">Vui lòng chọn ít nhất một nhà máy.</div>
              )}
              {dateSelectionValid && !preparing && (
                <div className="text-xs text-muted-foreground">
                  Đã chọn <strong className="text-foreground">{selectedHistories.length}</strong>{" "}
                  lịch sử đi làm.
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3 rounded-2xl border border-border/60 bg-muted/20 p-3">
              <div className="rounded-xl bg-background/70 p-3 text-xs leading-5 text-muted-foreground">
                Sheet đầu tiên cần có các cột <strong>Mã nhân viên</strong>,{" "}
                <strong>Tên nhà máy</strong> và <strong>Họ tên</strong>. Hệ thống chỉ đối chiếu Mã
                nhân viên + Tên nhà máy.
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-full rounded-xl bg-white text-slate-900"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
              >
                {excelReading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                {excelReading ? "Đang đọc file..." : excelFileName || "Chọn file Excel"}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={handleExcelFile}
                disabled={busy}
              />

              {excelResult && (
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <ExportStat label="Dòng Excel" value={excelResult.totalRows} />
                    <ExportStat
                      label="Đã khớp"
                      value={excelResult.histories.length}
                      tone="success"
                    />
                    <ExportStat
                      label="Cần kiểm tra"
                      value={excelResult.issues.length}
                      tone={excelResult.issues.length ? "warning" : "default"}
                    />
                  </div>
                  {excelResult.issues.length > 0 && (
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full rounded-xl text-amber-700"
                      onClick={() => exportExcelIssues(excelResult)}
                      disabled={busy}
                    >
                      <AlertTriangle className="h-4 w-4" />
                      Tải lại file đối chiếu
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <ExportStat
              label="Lịch sử"
              value={preparation?.stats.total ?? (selectionReady ? selectedHistories.length : "—")}
            />
            <ExportStat label="Đủ 2 mặt" value={preparation?.stats.full ?? "—"} tone="success" />
            <ExportStat
              label="Thiếu 1 mặt"
              value={preparation?.stats.partial ?? "—"}
              tone="warning"
            />
            <ExportStat
              label="Không có ảnh"
              value={preparation?.stats.missing ?? "—"}
              tone="danger"
            />
          </div>

          {largeSelection && (
            <div className="space-y-2 rounded-xl border border-amber-400/60 bg-amber-50 p-3 text-xs text-amber-900">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Đang chọn <strong>{selectedHistories.length.toLocaleString("vi-VN")}</strong> lịch
                  sử. Dữ liệu trên 1.000 có thể mất nhiều thời gian và làm trình duyệt dùng nhiều bộ
                  nhớ.
                </span>
              </div>
              {!largeExportConfirmed ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full rounded-lg border-amber-400 bg-white text-amber-900 hover:bg-amber-100"
                  onClick={() => setLargeExportConfirmed(true)}
                  disabled={busy}
                >
                  Tôi hiểu, tiếp tục xuất
                </Button>
              ) : (
                <div className="font-medium">Đã xác nhận xuất dữ liệu lớn.</div>
              )}
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            <ExportModeButton
              active={mode === "folders"}
              icon={Archive}
              title="Thư mục ảnh"
              description="ZIP nhóm Nhà máy → ngày vào"
              onClick={() => setMode("folders")}
              disabled={busy}
            />
            <ExportModeButton
              active={mode === "word"}
              icon={FileText}
              title="File Word"
              description="Mỗi nhà máy một file Word"
              onClick={() => setMode("word")}
              disabled={busy}
            />
          </div>

          {busy && (
            <div className="space-y-2 rounded-xl border border-border/60 bg-muted/30 p-3">
              <div className="flex items-center gap-2 text-xs font-medium">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span>{progressState.message || "Đang xử lý..."}</span>
              </div>
              <Progress value={progressValue} />
              {progressState.total > 0 && (
                <div className="text-[11px] text-muted-foreground">
                  {progressState.completed}/{progressState.total} ảnh
                </div>
              )}
              <Button
                type="button"
                variant="outline"
                className="w-full rounded-xl border-destructive/40 text-destructive hover:bg-destructive/5"
                onClick={cancelCurrentTask}
                disabled={cancelling || !activeControllerRef.current}
              >
                <XCircle className="h-4 w-4" />
                {cancelling ? "Đang hủy..." : "Hủy xuất"}
              </Button>
            </div>
          )}

          {preparationCancelled && !busy && (
            <div className="rounded-xl border border-amber-400/60 bg-amber-50 p-3 text-xs text-amber-900">
              Đã hủy chuẩn bị dữ liệu. Bạn có thể chỉnh lựa chọn hoặc chuẩn bị lại.
            </div>
          )}

          {!busy && preparation && (
            <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
              {mode === "folders"
                ? "Ảnh sẽ được tải trong một ZIP, chia theo tên nhà máy rồi đến ngày vào làm."
                : "Mỗi NLĐ một trang A4 dọc; ảnh mặt trước rồi mặt sau, rộng 3 inch và giữ nguyên tỷ lệ."}
            </div>
          )}

          <Button
            type="button"
            className="w-full rounded-xl"
            onClick={preparationCancelled ? retryPreparation : startExport}
            disabled={
              busy ||
              (!preparationCancelled &&
                (!preparation ||
                  !(preparation.stats.full || preparation.stats.partial) ||
                  (largeSelection && !largeExportConfirmed)))
            }
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {exporting
              ? "Đang xuất..."
              : preparing || excelReading
                ? "Đang chuẩn bị..."
                : preparationCancelled
                  ? "Chuẩn bị lại dữ liệu"
                  : mode === "folders"
                    ? "Tạo ZIP thư mục ảnh"
                    : "Tạo ZIP file Word"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ExportStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number | string;
  tone?: "default" | "success" | "warning" | "danger";
}) {
  const toneClass = {
    default: "text-foreground",
    success: "text-emerald-600",
    warning: "text-amber-600",
    danger: "text-destructive",
  }[tone];
  return (
    <div className="rounded-xl border border-border/60 bg-card p-2.5 text-center">
      <div className={`text-lg font-semibold ${toneClass}`}>{value}</div>
      <div className="mt-0.5 text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}

function SelectionSourceButton({
  active,
  icon: Icon,
  title,
  description,
  onClick,
  disabled,
}: {
  active: boolean;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl border p-3 text-left transition-colors ${
        active
          ? "border-primary bg-primary/5 ring-1 ring-primary/20"
          : "border-border/60 bg-card hover:bg-muted/40"
      }`}
    >
      <Icon className={`h-5 w-5 ${active ? "text-primary" : "text-muted-foreground"}`} />
      <span className="mt-2 block text-xs font-semibold">{title}</span>
      <span className="mt-0.5 block text-[10px] text-muted-foreground">{description}</span>
    </button>
  );
}

function ExportModeButton({
  active,
  icon: Icon,
  title,
  description,
  onClick,
  disabled,
}: {
  active: boolean;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex min-h-20 items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
        active
          ? "border-primary bg-primary/5 ring-1 ring-primary/20"
          : "border-border/60 bg-card hover:bg-muted/40"
      }`}
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
          active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
        }`}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold">{title}</span>
        <span className="mt-0.5 block text-[11px] text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}
