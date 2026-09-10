import { useEffect, useState } from "react";
import { FileDown, Loader2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FactoryMultiSelect } from "@/components/factories/FactoryMultiSelect";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchFactories, type FactoryRecord } from "@/lib/factories";
import { pb } from "@/lib/pocketbase";

export const STAFF_EXCEL_HISTORY_FROM_DATE_KEY = "jobconnect:staff-excel-export:history-from-date";

type ExportMode = "basic" | "full";
type ExportStatus = "all" | "working" | "left";

const EMPTY_DATE = "";

function isValidIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return (
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3])
  );
}

function readSavedHistoryFromDate() {
  if (typeof window === "undefined") return EMPTY_DATE;
  try {
    const value = window.localStorage.getItem(STAFF_EXCEL_HISTORY_FROM_DATE_KEY) || EMPTY_DATE;
    if (isValidIsoDate(value)) return value;
    window.localStorage.removeItem(STAFF_EXCEL_HISTORY_FROM_DATE_KEY);
  } catch {
    // Tiếp tục sử dụng popup bình thường khi localStorage không khả dụng.
  }
  return EMPTY_DATE;
}

function saveHistoryFromDate(value: string) {
  if (typeof window === "undefined") return;
  try {
    if (isValidIsoDate(value)) {
      window.localStorage.setItem(STAFF_EXCEL_HISTORY_FROM_DATE_KEY, value);
    } else if (!value) {
      window.localStorage.removeItem(STAFF_EXCEL_HISTORY_FROM_DATE_KEY);
    }
  } catch {
    // Không chặn thao tác xuất file nếu trình duyệt không cho ghi localStorage.
  }
}

function filenameFromResponse(response: Response, fallback: string) {
  const disposition = response.headers.get("content-disposition") || "";
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  return match?.[1] || fallback;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function StaffExcelExportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [factories, setFactories] = useState<FactoryRecord[]>([]);
  const [factoryFilters, setFactoryFilters] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<ExportStatus>("all");
  const [historyFromDate, setHistoryFromDate] = useState(EMPTY_DATE);
  const [exportingMode, setExportingMode] = useState<ExportMode | null>(null);
  const [loadingFactories, setLoadingFactories] = useState(false);

  useEffect(() => {
    if (!open) {
      setFactories([]);
      setFactoryFilters([]);
      setStatusFilter("all");
      return;
    }

    let alive = true;
    setHistoryFromDate(readSavedHistoryFromDate());
    setFactories([]);
    setFactoryFilters([]);
    setStatusFilter("all");
    setLoadingFactories(true);

    fetchFactories()
      .then((rows) => {
        if (alive) setFactories(rows);
      })
      .catch(() => {
        if (alive) toast.error("Không thể tải danh sách nhà máy");
      })
      .finally(() => {
        if (alive) setLoadingFactories(false);
      });

    return () => {
      alive = false;
    };
  }, [open]);

  const updateHistoryFromDate = (value: string) => {
    setHistoryFromDate(value);
    saveHistoryFromDate(value);
  };

  const exportFromServer = async (mode: ExportMode) => {
    if (!factoryFilters.length || !isValidIsoDate(historyFromDate) || exportingMode) return;
    setExportingMode(mode);
    try {
      const response = await fetch("/api/staff/export", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(pb.authStore.token ? { Authorization: `Bearer ${pb.authStore.token}` } : {}),
        },
        body: JSON.stringify({
          factoryIds: factoryFilters,
          mode,
          status: statusFilter,
          historyFromDate,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || "Không thể xuất dữ liệu Excel");
      }

      const blob = await response.blob();
      const fallback = `jobconnect_${mode === "basic" ? "co_ban" : "day_du"}.xlsx`;
      downloadBlob(blob, filenameFromResponse(response, fallback));
      const rowCount = response.headers.get("x-export-row-count");
      toast.success(rowCount ? `Đã xuất ${rowCount} dòng dữ liệu` : "Đã xuất file Excel");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể xuất dữ liệu Excel");
    } finally {
      setExportingMode(null);
    }
  };

  const busy = Boolean(exportingMode);
  const disabled =
    loadingFactories || busy || factoryFilters.length === 0 || !isValidIsoDate(historyFromDate);

  return (
    <Dialog open={open} onOpenChange={(value) => !busy && onOpenChange(value)}>
      <DialogContent className="max-h-[90dvh] max-w-md rounded-2xl desktop:max-w-md">
        <DialogHeader>
          <DialogTitle>Xuất Excel lịch sử đi làm</DialogTitle>
          <DialogDescription>Chọn phạm vi dữ liệu cần tải xuống.</DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <div className="space-y-1.5">
            <FactoryMultiSelect
              factories={factories}
              selectedIds={factoryFilters}
              onChange={setFactoryFilters}
              label="Nhà máy (bắt buộc)"
              disabled={loadingFactories || busy}
            />
            {loadingFactories && (
              <p className="text-[11px] text-muted-foreground">Đang tải danh sách nhà máy...</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Giữ lịch sử từ ngày (bắt buộc)</Label>
            <DateInput
              value={historyFromDate}
              onChange={updateHistoryFromDate}
              placeholder="dd/mm/yyyy"
              disabled={busy}
              aria-required="true"
            />
            <p className="text-[11px] text-muted-foreground">
              Lịch sử có ngày nghỉ trước ngày này sẽ không được đưa vào file.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Trạng thái</Label>
            <Select
              value={statusFilter}
              onValueChange={(value) => setStatusFilter(value as ExportStatus)}
              disabled={busy}
            >
              <SelectTrigger className="rounded-xl">
                <SelectValue placeholder="Chọn trạng thái" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tất cả</SelectItem>
                <SelectItem value="working">Đang làm</SelectItem>
                <SelectItem value="left">Đã nghỉ</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-xl border border-primary/15 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
            {loadingFactories
              ? "Đang chuẩn bị danh sách nhà máy..."
              : factoryFilters.length
                ? `Đã chọn ${factoryFilters.length} nhà máy.`
                : "Chưa chọn nhà máy."}
          </div>
        </DialogBody>

        <DialogFooter className="gap-2 sm:grid sm:grid-cols-2 sm:space-x-0">
          <Button
            type="button"
            variant="outline"
            className="w-full rounded-xl"
            disabled={disabled}
            onClick={() => void exportFromServer("basic")}
          >
            {exportingMode === "basic" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileDown className="h-4 w-4" />
            )}
            {exportingMode === "basic" ? "Đang tạo file..." : "Xuất cơ bản"}
          </Button>
          <Button
            type="button"
            className="w-full rounded-xl"
            disabled={disabled}
            onClick={() => void exportFromServer("full")}
          >
            {exportingMode === "full" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileDown className="h-4 w-4" />
            )}
            {exportingMode === "full" ? "Đang tạo file..." : "Xuất đầy đủ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
