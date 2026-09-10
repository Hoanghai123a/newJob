import { useCallback, useEffect, useMemo, useState } from "react";
import { Camera, CalendarCheck, Loader2, Moon, Sun, Wallet } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { DataLoadingState } from "@/components/ui/data-loading-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatVND, type AttendanceRow, type RateBuckets } from "@/lib/salary";
import {
  buildPayrollCalendarCells,
  fetchFactoryAttendanceCutoffDay,
  getPayrollPeriod,
  type PayrollPeriod,
} from "@/lib/payroll-cycle";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { getUserErrorMessage } from "@/lib/toast";
import { type UserRecord } from "@/lib/pocketbase";
import { fetchStaffWorkerWorkspace } from "@/lib/staff-permissions";
import { fetchWorkerCheckPayroll } from "@/lib/check-payroll-cache";

export function WorkerPayrollDialog({
  open,
  onOpenChange,
  viewer,
  workerId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  viewer: UserRecord;
  workerId: string;
}) {
  const [workerName, setWorkerName] = useState("");
  const [workerCompany, setWorkerCompany] = useState("");
  const [attendanceItems, setAttendanceItems] = useState<WorkerAttendanceCheckItem[]>([]);
  const [salaryItems, setSalaryItems] = useState<WorkerSalaryCheckItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [authorized, setAuthorized] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(
    async (force = false) => {
      if (!workerId) return;
      setLoading(true);
      setError("");
      try {
        const workspace = await fetchStaffWorkerWorkspace(viewer, workerId);
        const worker = workspace.worker;
        if (!worker || !worker.canViewPayroll) {
          setAuthorized(false);
          return;
        }
        setAuthorized(true);
        setWorkerName(worker.user.full_name || worker.user.username || "");
        setWorkerCompany(worker.latestHistory?.expand?.factory?.name || "");
        const payload = await fetchWorkerCheckPayroll(
          viewer.id,
          viewer.role || "staff",
          worker.user.id,
          force,
        );
        setAttendanceItems(payload.attendance);
        setSalaryItems(payload.salary);
      } catch (cause) {
        setError(getUserErrorMessage(cause, "Không tải được dữ liệu công/lương"));
      } finally {
        setLoading(false);
      }
    },
    [viewer, workerId],
  );

  useEffect(() => {
    if (open) void load();
  }, [load, open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-5xl p-0">
        <DialogHeader>
          <DialogTitle>Check công/lương</DialogTitle>
          <DialogDescription>
            {workerName || "Người lao động"}
            {workerCompany ? ` · ${workerCompany}` : ""}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <div className="space-y-2 px-4 py-3 text-sm text-destructive">
            <div>{error}</div>
            <button type="button" className="underline" onClick={() => void load(true)}>
              Thử tải lại
            </button>
          </div>
        ) : !authorized ? (
          <div className="p-4">
            <EmptyState
              icon={CalendarCheck}
              title="Không có quyền"
              description="Bạn không có quyền xem check công/lương của người lao động này."
            />
          </div>
        ) : (
          <WorkerPayrollView
            attendanceItems={attendanceItems}
            salaryItems={salaryItems}
            loading={loading}
            fallbackFactoryName={workerCompany}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

export type PayrollBatchRecord = {
  id: string;
  month: string;
  round_no: number;
  note?: string;
  created?: string;
};

export type WorkerAttendanceCheckItem = {
  id: string;
  batch: string;
  user: string;
  month: string;
  round_no: number;
  full_name?: string;
  rows: AttendanceRow[];
  summary?: Partial<RateBuckets>;
  created?: string;
  expand?: { batch?: PayrollBatchRecord };
};

export type SalaryWageLine = { rate: string; hours: number; amount: number };
export type SalaryMoneyLine = { label: string; amount: number };
export type SalaryTotals = { wage: number; allowance: number; deduction: number; net: number };
export type SalaryPersonalInfo = {
  employee_code: string;
  company: string;
  full_name?: string;
  start_date: string;
  end_date: string;
  base_salary: number;
  standard_workdays: number;
};

export type WorkerSalaryCheckItem = {
  id: string;
  batch: string;
  user: string;
  month: string;
  round_no: number;
  personal: SalaryPersonalInfo;
  wage_lines: SalaryWageLine[];
  allowance_lines: SalaryMoneyLine[];
  deduction_lines: SalaryMoneyLine[];
  totals: SalaryTotals;
  created?: string;
  expand?: { batch?: PayrollBatchRecord };
};

const EMPTY_BUCKETS = (): RateBuckets => ({
  r100: 0,
  r130: 0,
  r150: 0,
  r200: 0,
  r270: 0,
  r300: 0,
  r390: 0,
});

function normalizeBuckets(summary?: Partial<RateBuckets>) {
  return { ...EMPTY_BUCKETS(), ...(summary || {}) };
}

function todayMonth() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthStringToDate(month: string) {
  const [year, monthValue] = month.split("-").map(Number);
  return new Date(year || new Date().getFullYear(), (monthValue || 1) - 1, 1);
}

function formatDisplayDate(value?: string) {
  if (!value) return "—";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function calculateSalaryTotals({
  wageLines,
  allowanceLines,
  deductionLines,
}: {
  wageLines: SalaryWageLine[];
  allowanceLines: SalaryMoneyLine[];
  deductionLines: SalaryMoneyLine[];
}): SalaryTotals {
  const wage = wageLines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
  const allowance = allowanceLines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
  const deduction = deductionLines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
  return { wage, allowance, deduction, net: wage + allowance - deduction };
}

const CAPTURE_STYLE_PROPERTIES = [
  "align-content",
  "align-items",
  "align-self",
  "aspect-ratio",
  "background",
  "background-color",
  "background-image",
  "background-position",
  "background-repeat",
  "background-size",
  "border",
  "border-bottom",
  "border-left",
  "border-radius",
  "border-right",
  "border-top",
  "box-shadow",
  "box-sizing",
  "color",
  "column-gap",
  "display",
  "fill",
  "filter",
  "flex",
  "flex-basis",
  "flex-direction",
  "flex-grow",
  "flex-shrink",
  "flex-wrap",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "gap",
  "grid-auto-columns",
  "grid-auto-flow",
  "grid-auto-rows",
  "grid-column",
  "grid-row",
  "grid-template-areas",
  "grid-template-columns",
  "grid-template-rows",
  "height",
  "justify-content",
  "justify-items",
  "justify-self",
  "letter-spacing",
  "line-height",
  "margin-bottom",
  "margin-left",
  "margin-right",
  "margin-top",
  "max-height",
  "max-width",
  "min-height",
  "min-width",
  "object-fit",
  "opacity",
  "overflow",
  "overflow-x",
  "overflow-y",
  "padding-bottom",
  "padding-left",
  "padding-right",
  "padding-top",
  "position",
  "row-gap",
  "stroke",
  "stroke-width",
  "text-align",
  "text-decoration",
  "text-overflow",
  "text-transform",
  "transform",
  "transform-origin",
  "vertical-align",
  "white-space",
  "width",
  "word-break",
  "z-index",
] as const;

function inlineComputedStyles(source: Element, clone: Element) {
  if (clone instanceof HTMLElement || clone instanceof SVGElement) {
    const computed = getComputedStyle(source);
    for (const property of CAPTURE_STYLE_PROPERTIES) {
      const value = computed.getPropertyValue(property);
      if (value) clone.style.setProperty(property, value, computed.getPropertyPriority(property));
    }

    if (computed.position === "sticky") {
      clone.style.position = "relative";
      clone.style.inset = "auto";
      clone.style.top = "auto";
    }

    if (clone instanceof SVGElement && !clone.getAttribute("xmlns")) {
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    }
  }

  const sourceChildren = Array.from(source.children);
  const cloneChildren = Array.from(clone.children);
  sourceChildren.forEach((child, index) => {
    const clonedChild = cloneChildren[index];
    if (clonedChild) inlineComputedStyles(child, clonedChild);
  });
}

async function captureElementAsPng(element: HTMLElement) {
  await document.fonts?.ready;

  const rect = element.getBoundingClientRect();
  const width = Math.ceil(Math.max(rect.width, element.scrollWidth));
  const height = Math.ceil(Math.max(rect.height, element.scrollHeight));
  const padding = 4;
  const outputWidth = width + padding * 2;
  const outputHeight = height + padding * 2;
  const scale = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const clone = element.cloneNode(true) as HTMLElement;
  const backgroundColor = getComputedStyle(document.body).backgroundColor || "#ffffff";

  inlineComputedStyles(element, clone);
  clone.style.width = `${width}px`;
  clone.style.height = `${height}px`;
  clone.style.maxWidth = "none";
  clone.style.margin = "0";
  clone.style.position = "relative";
  clone.style.inset = "auto";
  clone.style.boxSizing = "border-box";

  const markup = `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${outputWidth}px;height:${outputHeight}px;padding:${padding}px;box-sizing:border-box;overflow:hidden;background:${backgroundColor};">${clone.outerHTML}</div>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${outputWidth}" height="${outputHeight}" viewBox="0 0 ${outputWidth} ${outputHeight}"><foreignObject width="100%" height="100%">${markup}</foreignObject></svg>`;
  const image = new Image();

  const imageBitmap = await new Promise<HTMLImageElement>((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(
        new Error("Kh\u00f4ng th\u1ec3 t\u1ea1o \u1ea3nh t\u1eeb b\u1ea3ng d\u1eef li\u1ec7u"),
      );
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(outputWidth * scale);
  canvas.height = Math.ceil(outputHeight * scale);
  const context = canvas.getContext("2d");
  if (!context)
    throw new Error("Tr\u00ecnh duy\u1ec7t kh\u00f4ng h\u1ed7 tr\u1ee3 t\u1ea1o \u1ea3nh");

  context.scale(scale, scale);
  context.fillStyle = backgroundColor;
  context.fillRect(0, 0, outputWidth, outputHeight);
  context.drawImage(imageBitmap, 0, 0, outputWidth, outputHeight);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Kh\u00f4ng th\u1ec3 xu\u1ea5t \u1ea3nh PNG"));
    }, "image/png");
  });
}

function CopyImageButton({ targetSelector, label }: { targetSelector: string; label: string }) {
  const [copying, setCopying] = useState(false);

  const copyImage = async () => {
    if (copying) return;
    const target = document.querySelector<HTMLElement>(targetSelector);
    if (!target) {
      toast.error("Kh\u00f4ng t\u00ecm th\u1ea5y v\u00f9ng b\u1ea3ng c\u1ea7n ch\u1ee5p");
      return;
    }
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      toast.error(
        "Tr\u00ecnh duy\u1ec7t kh\u00f4ng h\u1ed7 tr\u1ee3 copy \u1ea3nh tr\u1ef1c ti\u1ebfp",
      );
      return;
    }

    setCopying(true);
    try {
      const blob = await captureElementAsPng(target);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      toast.success(`\u0110\u00e3 copy \u1ea3nh ${label}`);
    } catch (error: unknown) {
      toast.error(getUserErrorMessage(error, "Kh\u00f4ng th\u1ec3 copy \u1ea3nh"));
    } finally {
      setCopying(false);
    }
  };

  return (
    <button
      type="button"
      onClick={copyImage}
      disabled={copying}
      className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs font-medium text-foreground shadow-sm transition hover:bg-muted disabled:cursor-wait disabled:opacity-70"
      aria-label={`Ch\u1ee5p \u1ea3nh ${label}`}
    >
      {copying ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Camera className="h-3.5 w-3.5" />
      )}
      {copying ? "\u0110ang t\u1ea1o \u1ea3nh" : "Ch\u1ee5p \u1ea3nh"}
    </button>
  );
}

export function WorkerPayrollView({
  attendanceItems,
  salaryItems,
  loading,
  fallbackFactoryName,
}: {
  attendanceItems: WorkerAttendanceCheckItem[];
  salaryItems: WorkerSalaryCheckItem[];
  loading: boolean;
  fallbackFactoryName?: string;
}) {
  const [selectedAttendance, setSelectedAttendance] = useState<WorkerAttendanceCheckItem | null>(
    null,
  );
  const [selectedSalary, setSelectedSalary] = useState<WorkerSalaryCheckItem | null>(null);
  const [factoryCutoffDay, setFactoryCutoffDay] = useState<number | null>(null);

  useEffect(() => {
    setSelectedAttendance(
      (current) =>
        attendanceItems.find((item) => item.id === current?.id) || attendanceItems[0] || null,
    );
  }, [attendanceItems]);

  useEffect(() => {
    setSelectedSalary(
      (current) => salaryItems.find((item) => item.id === current?.id) || salaryItems[0] || null,
    );
  }, [salaryItems]);

  const factoryName = selectedSalary?.personal.company || fallbackFactoryName || "";
  useEffect(() => {
    let cancelled = false;
    fetchFactoryAttendanceCutoffDay(factoryName).then((day) => {
      if (!cancelled) setFactoryCutoffDay(day);
    });
    return () => {
      cancelled = true;
    };
  }, [factoryName]);

  const buckets = useMemo(
    () => normalizeBuckets(selectedAttendance?.summary),
    [selectedAttendance],
  );
  const visibleRateCells = useMemo(
    () =>
      [
        { label: "100%", hours: buckets.r100 },
        { label: "130%", hours: buckets.r130 },
        { label: "150%", hours: buckets.r150 },
        { label: "200%", hours: buckets.r200 },
        { label: "270%", hours: buckets.r270 },
        { label: "300%", hours: buckets.r300 },
        { label: "390%", hours: buckets.r390 },
      ].filter((cell) => cell.hours > 0),
    [buckets],
  );
  const selectedPeriod = useMemo(
    () =>
      getPayrollPeriod(
        monthStringToDate(selectedAttendance?.month || todayMonth()),
        factoryCutoffDay,
      ),
    [selectedAttendance?.month, factoryCutoffDay],
  );

  if (loading && attendanceItems.length === 0 && salaryItems.length === 0) {
    return (
      <div className="space-y-4 p-4">
        <DataLoadingState variant="inline" label="Đang tải dữ liệu công/lương..." />
        <div className="grid gap-3 sm:grid-cols-2">
          <DataLoadingState variant="list" label="Đang tải bảng check công..." rows={2} />
          <DataLoadingState variant="list" label="Đang tải bảng check lương..." rows={2} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {loading && <DataLoadingState variant="inline" label="Đang cập nhật dữ liệu công/lương..." />}
      <Tabs defaultValue="attendance" className="worker-payroll-view space-y-4">
        <TabsList className="grid h-10 w-full grid-cols-2 rounded-xl">
          <TabsTrigger value="attendance" className="rounded-lg text-xs">
            Check công
          </TabsTrigger>
          <TabsTrigger value="salary" className="rounded-lg text-xs">
            Check lương
          </TabsTrigger>
        </TabsList>

        <TabsContent value="attendance" className="mt-0 space-y-4">
          {attendanceItems.length === 0 && !loading ? (
            <EmptyState
              icon={CalendarCheck}
              title="Chưa có bảng check công"
              description="Khi admin gửi bảng check công, dữ liệu sẽ hiển thị tại đây."
            />
          ) : (
            <>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {attendanceItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedAttendance(item)}
                    className={cn(
                      "flex-none rounded-full border px-3 py-1.5 text-xs font-medium transition",
                      selectedAttendance?.id === item.id
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card text-muted-foreground",
                    )}
                  >
                    {item.month} · {item.expand?.batch?.note || `Lần ${item.round_no}`}
                  </button>
                ))}
              </div>

              {selectedAttendance && (
                <>
                  <div className="flex justify-end">
                    <CopyImageButton
                      targetSelector=".worker-check-attendance-layout"
                      label={"b\u1ea3ng check c\u00f4ng"}
                    />
                  </div>
                  <div className="worker-check-attendance-layout">
                    <aside className="worker-check-attendance-summary">
                      <Card className="worker-check-attendance-card overflow-hidden">
                        <div className="gradient-accent p-4 text-accent-foreground">
                          <div className="text-xs uppercase opacity-80">Bảng check công</div>
                          <div className="mt-0.5 text-xl font-bold">
                            {selectedAttendance.month} ·{" "}
                            {selectedAttendance.expand?.batch?.note ||
                              `Lần ${selectedAttendance.round_no}`}
                          </div>
                          <div
                            className="mt-1 truncate text-sm font-semibold"
                            title={selectedAttendance.full_name || "—"}
                          >
                            Họ tên: {selectedAttendance.full_name || "—"}
                          </div>
                        </div>
                        <div className="worker-check-rate-grid grid grid-cols-4 gap-1.5 bg-card p-3 text-[10px] sm:gap-2 sm:text-sm">
                          {visibleRateCells.map((cell) => (
                            <RateCell key={cell.label} label={cell.label} hours={cell.hours} />
                          ))}
                          <RateCell label="Ngày" hours={selectedAttendance.rows.length} suffix="" />
                        </div>
                      </Card>
                    </aside>

                    <div className="worker-check-attendance-calendar">
                      <CheckMonthCalendar rows={selectedAttendance.rows} period={selectedPeriod} />
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="salary" className="mt-0">
          <SalaryCheckPanel
            items={salaryItems}
            selected={selectedSalary}
            onSelect={setSelectedSalary}
            loading={loading}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SalaryCheckPanel({
  items,
  selected,
  onSelect,
  loading,
}: {
  items: WorkerSalaryCheckItem[];
  selected: WorkerSalaryCheckItem | null;
  onSelect: (item: WorkerSalaryCheckItem) => void;
  loading: boolean;
}) {
  if (items.length === 0 && !loading) {
    return (
      <EmptyState
        icon={Wallet}
        title="Chưa có bảng check lương"
        description="Khi admin gửi bảng check lương, dữ liệu sẽ hiển thị tại đây."
      />
    );
  }

  const selectedTotals = selected
    ? calculateSalaryTotals({
        wageLines: selected.wage_lines,
        allowanceLines: selected.allowance_lines,
        deductionLines: selected.deduction_lines,
      })
    : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Check lương
        </div>
        {selected && (
          <CopyImageButton
            targetSelector='[data-ui-card="card"].worker-salary-card'
            label={"b\u1ea3ng check l\u01b0\u01a1ng"}
          />
        )}
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item)}
            className={cn(
              "flex-none rounded-full border px-3 py-1.5 text-xs font-medium transition",
              selected?.id === item.id
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground",
            )}
          >
            {item.month} · {item.expand?.batch?.note || `Lần ${item.round_no}`}
          </button>
        ))}
      </div>

      {selected && (
        <Card className="worker-salary-card overflow-hidden">
          <div className="gradient-accent p-4 text-accent-foreground">
            <div className="text-xs uppercase opacity-80">Bảng check lương</div>
            <div className="mt-0.5 text-xl font-bold">{formatVND(selectedTotals?.net || 0)}</div>
            <div className="mt-1 text-xs opacity-80">
              {selected.month} · {selected.expand?.batch?.note || `Lần ${selected.round_no}`}
            </div>
            <div
              className="mt-1 truncate text-sm font-semibold"
              title={selected.personal.full_name || "—"}
            >
              Họ tên: {selected.personal.full_name || "—"}
            </div>
          </div>

          <div className="worker-salary-layout flex flex-col gap-4 p-3">
            <aside className="worker-salary-personal space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Thông tin cá nhân
              </div>
              <Card className="worker-salary-personal-card space-y-2 p-3 text-sm">
                <div className="worker-salary-personal-row worker-salary-personal-row-primary grid grid-cols-[minmax(0,1fr)_minmax(0,0.75fr)_minmax(0,1.25fr)] gap-2">
                  <CompactInfoItem label="Công ty" value={selected.personal.company || "—"} />
                  <CompactInfoItem label="Mã NV" value={selected.personal.employee_code || "—"} />
                  <CompactInfoItem label="Họ tên" value={selected.personal.full_name || "—"} />
                </div>
                <div className="worker-salary-personal-row grid grid-cols-2 gap-2 border-t pt-2">
                  <CompactInfoItem
                    label="Ngày vào"
                    value={formatDisplayDate(selected.personal.start_date)}
                  />
                  <CompactInfoItem
                    label="Ngày nghỉ"
                    value={formatDisplayDate(selected.personal.end_date)}
                  />
                </div>
                <div className="worker-salary-personal-row grid grid-cols-2 gap-2 border-t pt-2">
                  <CompactInfoItem
                    label="Lương cơ bản"
                    value={formatVND(selected.personal.base_salary)}
                  />
                  <CompactInfoItem
                    label="Số công HC"
                    value={`${selected.personal.standard_workdays || 0}`}
                  />
                </div>
              </Card>
            </aside>

            <div className="worker-salary-details space-y-3">
              <SalaryWageSection lines={selected.wage_lines} total={selectedTotals?.wage || 0} />
              <SalaryMoneySection
                title="Phụ cấp"
                lines={selected.allowance_lines}
                total={selectedTotals?.allowance || 0}
              />
              <SalaryMoneySection
                title="Khấu trừ"
                lines={selected.deduction_lines}
                total={selectedTotals?.deduction || 0}
              />

              <div className="worker-salary-net rounded-xl border border-primary/30 bg-primary/5 p-3">
                <div className="text-[11px] uppercase text-muted-foreground">Thực nhận</div>
                <div className="mt-1 text-xl font-bold text-primary">
                  {formatVND(selectedTotals?.net || 0)}
                </div>
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

function SalaryWageSection({ lines, total }: { lines: SalaryWageLine[]; total: number }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Thông tin lương
      </div>
      <div className="space-y-2">
        {lines.length === 0 ? (
          <div className="rounded-xl border bg-card p-3 text-sm text-muted-foreground">
            Chưa có dòng lương
          </div>
        ) : (
          lines.map((line, index) => (
            <div
              key={`${line.rate}-${index}`}
              className="worker-salary-line grid grid-cols-3 gap-2 rounded-xl border bg-card p-3 text-sm"
            >
              <div>
                <div className="text-[11px] text-muted-foreground">Hệ số</div>
                <div className="font-semibold">{line.rate || "—"}</div>
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground">Số giờ</div>
                <div className="font-semibold">{line.hours || 0}h</div>
              </div>
              <div className="text-right">
                <div className="text-[11px] text-muted-foreground">Thành tiền</div>
                <div className="whitespace-nowrap font-semibold">{formatVND(line.amount)}</div>
              </div>
            </div>
          ))
        )}
      </div>
      <TotalRow label="Tổng lương" value={total} />
    </div>
  );
}

function SalaryMoneySection({
  title,
  lines,
  total,
}: {
  title: string;
  lines: SalaryMoneyLine[];
  total: number;
}) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <div className="space-y-2">
        {lines.length === 0 ? (
          <div className="rounded-xl border bg-card p-3 text-sm text-muted-foreground">
            Chưa có dữ liệu
          </div>
        ) : (
          lines.map((line, index) => (
            <div
              key={`${line.label}-${index}`}
              className="worker-salary-line flex items-center justify-between gap-3 rounded-xl border bg-card p-3 text-sm"
            >
              <div className="font-medium">{line.label || "—"}</div>
              <div className="whitespace-nowrap font-semibold">{formatVND(line.amount)}</div>
            </div>
          ))
        )}
      </div>
      <TotalRow label={`Tổng ${title.toLowerCase()}`} value={total} />
    </div>
  );
}

function TotalRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="worker-salary-total flex items-center justify-between rounded-xl border bg-secondary/40 p-3 text-sm">
      <div className="font-medium">{label}</div>
      <div className="whitespace-nowrap font-bold">{formatVND(value)}</div>
    </div>
  );
}

function CheckMonthCalendar({ rows, period }: { rows: AttendanceRow[]; period: PayrollPeriod }) {
  const [detail, setDetail] = useState<AttendanceRow | null>(null);
  const rowByDate = useMemo(() => new Map(rows.map((row) => [row.date, row])), [rows]);
  const cells = buildPayrollCalendarCells(period);

  return (
    <>
      <Card className="worker-check-month-calendar overflow-hidden rounded-2xl p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-sm font-semibold">{period.title}</div>
          <span className="chip chip-info">{rows.length} ngày</span>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase text-muted-foreground">
          {["T2", "T3", "T4", "T5", "T6", "T7", "CN"].map((day, index) => (
            <div key={day} className={index === 6 ? "text-[color:var(--status-danger)]" : ""}>
              {day}
            </div>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {cells.map((cell, index) => {
            if (!cell) return <div key={`empty-${index}`} className="aspect-square" />;
            const row = rowByDate.get(cell.key);
            const isSunday = index % 7 === 6;
            const totalHours = row ? row.hc_hours + row.ot_hours : 0;
            return (
              <button
                key={cell.key}
                type="button"
                onClick={() => row && setDetail(row)}
                className={cn(
                  "relative flex aspect-square flex-col items-center justify-start rounded-lg border p-1 text-left transition active:scale-95",
                  row
                    ? row.is_holiday
                      ? "border-[color:var(--status-danger)]/40 bg-[color:var(--status-danger-bg)]"
                      : row.shift === "day"
                        ? "border-[color:var(--status-warning)]/40 bg-[color:var(--status-warning-bg)]"
                        : "border-primary/40 bg-primary/10"
                    : "border-border bg-card",
                )}
              >
                <div
                  className={`text-[11px] font-semibold leading-none ${
                    isSunday ? "text-[color:var(--status-danger)]" : ""
                  }`}
                >
                  {cell.day}
                </div>
                {row && (
                  <div className="mt-0.5 flex flex-1 flex-col items-center justify-center gap-0.5">
                    {row.shift === "day" ? (
                      <Sun className="h-3 w-3 text-[color:var(--status-warning-fg)]" />
                    ) : (
                      <Moon className="h-3 w-3 text-primary" />
                    )}
                    <div className="text-[9px] font-semibold leading-none">{totalHours}h</div>
                    {row.is_holiday && (
                      <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-[color:var(--status-danger)]" />
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </Card>

      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{detail?.date}</DialogTitle>
            <DialogDescription className="sr-only">
              Chi tiết giờ công của ngày trong bảng check công.
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="grid grid-cols-2 gap-2 text-sm">
              <InfoCell label="Ca" value={detail.shift === "day" ? "Ngày" : "Đêm"} />
              <InfoCell label="Ngày lễ" value={detail.is_holiday ? "Có" : "Không"} />
              <InfoCell label="Giờ HC" value={`${detail.hc_hours}h`} />
              <InfoCell label="Giờ TC" value={`${detail.ot_hours}h`} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function CompactInfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] leading-tight text-muted-foreground">{label}</div>
      <div className="mt-0.5 break-words text-xs font-semibold leading-snug" title={value}>
        {value}
      </div>
    </div>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-semibold">{value}</div>
    </div>
  );
}

function RateCell({
  label,
  hours,
  suffix = "h",
}: {
  label: string;
  hours: number;
  suffix?: string;
}) {
  return (
    <div className="worker-payroll-rate-cell rounded-lg border border-border/80 bg-background p-2 text-center shadow-sm">
      <div className="text-[9px] uppercase text-muted-foreground">{label}</div>
      <div className="text-xs font-semibold sm:text-sm">
        {hours}
        {suffix}
      </div>
    </div>
  );
}
