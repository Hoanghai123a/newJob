import { useEffect, useMemo, useState } from "react";
import {
  CalendarCheck,
  ClipboardCheck,
  RefreshCw,
  SlidersHorizontal,
  UserRoundMinus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { DataLoadingState } from "@/components/ui/data-loading-state";
import type { UserRecord } from "@/lib/pocketbase";
import type { EmploymentHistoryRecord } from "@/lib/employment";
import type { FactoryRecord } from "@/lib/factories";
import {
  localWorkforceDate,
  shiftWorkforceDate,
  validateWorkforceRange,
  type WorkforceRecruitmentScope,
} from "@/lib/workforce-dashboard";
import { useWorkforceDashboardData } from "@/lib/use-workforce-dashboard";
import { WorkforceDailyChart } from "./WorkforceDailyChart";
import { WorkforceInsightsCharts } from "./WorkforceInsightsCharts";

const STORAGE_KEY = "jobconnect:workforce-dashboard-date-range";
const SCOPE_STORAGE_KEY = "jobconnect:workforce-dashboard-recruitment-scope";
type DateRange = { from: string; to: string };

function defaultRange(): DateRange {
  const to = localWorkforceDate();
  return { from: shiftWorkforceDate(to, -6), to };
}
function validScope(value: unknown): value is WorkforceRecruitmentScope {
  return value === "all" || value === "internal" || value === "partner";
}
function formatDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("vi-VN");
}
function SummaryCard({
  label,
  value,
  icon: Icon,
  tone,
  compact = false,
}: {
  label: string;
  value: number;
  icon: typeof CalendarCheck;
  tone: "success" | "primary" | "warning";
  compact?: boolean;
}) {
  const tones = {
    success: "bg-emerald-500/10 text-emerald-600",
    primary: "bg-primary/10 text-primary",
    warning: "bg-amber-500/10 text-amber-600",
  };
  return (
    <div
      className={`rounded-2xl border border-border/70 bg-card shadow-soft ${compact ? "p-3" : "p-4"}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${tones[tone]}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className={`${compact ? "mt-1 text-xl" : "mt-2 text-2xl"} font-bold tabular-nums`}>
        {value}
      </div>
    </div>
  );
}

export function WorkforceDashboard({
  viewer,
  detailHref,
  presentation = "default",
}: {
  viewer: UserRecord | null;
  detailHref: string;
  presentation?: "default" | "mobile-dialog";
  detailHistories?: EmploymentHistoryRecord[];
  detailUsers?: UserRecord[];
  detailFactories?: FactoryRecord[];
}) {
  const [range, setRange] = useState<DateRange>(defaultRange);
  const [scope, setScope] = useState<WorkforceRecruitmentScope>("all");
  const [draftRange, setDraftRange] = useState<DateRange>(range);
  const [draftScope, setDraftScope] = useState<WorkforceRecruitmentScope>(scope);
  const [filterOpen, setFilterOpen] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const today = localWorkforceDate();
  const compact = presentation === "mobile-dialog";
  const rangeError = validateWorkforceRange(range.from, range.to);
  const query = useWorkforceDashboardData({
    viewer,
    from: range.from,
    to: range.to,
    scope,
    reloadToken,
  });
  const days = useMemo(() => query.data?.days || [], [query.data?.days]);
  const summary = useMemo(
    () => ({
      joined: days.reduce((sum, day) => sum + day.joined, 0),
      left: days.reduce((sum, day) => sum + day.left, 0),
      working: days.at(-1)?.working || 0,
    }),
    [days],
  );

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as DateRange | null;
      if (stored && !validateWorkforceRange(stored.from, stored.to)) setRange(stored);
      const storedScope = JSON.parse(localStorage.getItem(SCOPE_STORAGE_KEY) || "null");
      if (validScope(storedScope)) setScope(storedScope);
    } catch {
      /* dùng giá trị mặc định */
    }
  }, []);
  useEffect(() => {
    if (rangeError) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(range));
      localStorage.setItem(SCOPE_STORAGE_KEY, JSON.stringify(scope));
    } catch {
      /* cache trình duyệt không bắt buộc */
    }
  }, [range, rangeError, scope]);

  const setPreset = (kind: "today" | "yesterday" | 7 | 30, draft = false) => {
    const to = kind === "yesterday" ? shiftWorkforceDate(today, -1) : today;
    const from = typeof kind === "number" ? shiftWorkforceDate(to, -(kind - 1)) : to;
    if (draft) setDraftRange({ from, to });
    else setRange({ from, to });
  };
  const presets = [
    { key: "today" as const, label: "Hôm nay" },
    { key: "yesterday" as const, label: "Hôm qua" },
    { key: 7 as const, label: "7 ngày" },
    { key: 30 as const, label: "30 ngày" },
  ];
  const openFilter = () => {
    setDraftRange(range);
    setDraftScope(scope);
    setFilterOpen(true);
  };
  const applyFilter = () => {
    if (validateWorkforceRange(draftRange.from, draftRange.to)) return;
    setRange(draftRange);
    setScope(draftScope);
    setFilterOpen(false);
  };
  const updatedLabel = query.data?.generatedAt
    ? new Date(query.data.generatedAt).toLocaleTimeString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
  const empty =
    !query.loading &&
    !query.error &&
    days.every((day) => day.joined === 0 && day.left === 0 && day.working === 0);

  return (
    <div className="space-y-4">
      <section
        className={
          compact
            ? "space-y-3"
            : "sticky top-[calc(env(safe-area-inset-top)+4.5rem)] z-20 -mx-2 space-y-3 bg-background/95 px-2 py-2 backdrop-blur desktop:top-20"
        }
      >
        {compact ? (
          <button
            type="button"
            onClick={openFilter}
            className="flex w-full items-center gap-3 rounded-2xl border border-border/70 bg-card p-3 text-left shadow-soft active:scale-[0.99]"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <SlidersHorizontal className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold">Bộ lọc nhân lực</span>
              <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                {formatDate(range.from)} – {formatDate(range.to)} ·{" "}
                {scope === "all" ? "Toàn bộ" : scope === "internal" ? "Nội bộ" : "Đối tác"}
              </span>
            </span>
            <span className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
              Bộ lọc
            </span>
          </button>
        ) : (
          <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card p-4 shadow-soft desktop:flex-row desktop:items-end">
            <div className="grid min-w-0 flex-1 grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Từ ngày</Label>
                <DateInput
                  value={range.from}
                  max={range.to}
                  onChange={(from) => setRange((current) => ({ ...current, from }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Đến ngày</Label>
                <DateInput
                  value={range.to}
                  min={range.from}
                  max={today}
                  onChange={(to) => setRange((current) => ({ ...current, to }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Nguồn tuyển</Label>
              <div className="inline-flex rounded-xl border bg-background p-1">
                {(["all", "internal", "partner"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setScope(value)}
                    className={`rounded-lg px-3 py-2 text-xs font-medium ${scope === value ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted"}`}
                  >
                    {value === "all" ? "Toàn bộ" : value === "internal" ? "Nội bộ" : "Đối tác"}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {presets.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  onClick={() => setPreset(preset.key)}
                  className="rounded-xl border bg-background px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {rangeError && (
          <p className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {rangeError}
          </p>
        )}
        <div
          className={compact ? "grid grid-cols-3 gap-2" : "grid grid-cols-2 gap-3 sm:grid-cols-3"}
        >
          <SummaryCard
            label="Còn đi làm"
            value={summary.working}
            icon={CalendarCheck}
            tone="success"
            compact={compact}
          />
          <SummaryCard
            label="Tuyển mới"
            value={summary.joined}
            icon={ClipboardCheck}
            tone="primary"
            compact={compact}
          />
          <SummaryCard
            label="Đã nghỉ"
            value={summary.left}
            icon={UserRoundMinus}
            tone="warning"
            compact={compact}
          />
        </div>
      </section>

      <Dialog open={filterOpen} onOpenChange={setFilterOpen}>
        <DialogContent
          className="max-h-[90dvh] w-[calc(100%-1rem)] rounded-3xl"
          bodyClassName="space-y-4 px-4 py-4"
        >
          <DialogHeader className="px-4">
            <DialogTitle>Bộ lọc nhân lực</DialogTitle>
            <DialogDescription>
              Chọn khoảng thời gian tối đa 180 ngày và nguồn tuyển.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Từ ngày</Label>
              <DateInput
                value={draftRange.from}
                max={draftRange.to}
                onChange={(from) => setDraftRange((current) => ({ ...current, from }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Đến ngày</Label>
              <DateInput
                value={draftRange.to}
                min={draftRange.from}
                max={today}
                onChange={(to) => setDraftRange((current) => ({ ...current, to }))}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {presets.map((preset) => (
              <button
                key={preset.key}
                type="button"
                onClick={() => setPreset(preset.key, true)}
                className="min-h-10 rounded-xl border bg-background px-3 py-2 text-xs font-medium text-muted-foreground active:bg-muted"
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2 rounded-2xl bg-muted/60 p-1.5">
            {(["all", "internal", "partner"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setDraftScope(value)}
                className={`min-h-10 rounded-xl px-2 text-xs font-semibold ${draftScope === value ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"}`}
              >
                {value === "all" ? "Toàn bộ" : value === "internal" ? "Nội bộ" : "Đối tác"}
              </button>
            ))}
          </div>
          {validateWorkforceRange(draftRange.from, draftRange.to) && (
            <p className="text-xs text-destructive">
              {validateWorkforceRange(draftRange.from, draftRange.to)}
            </p>
          )}
          <DialogFooter className="grid grid-cols-2 px-4 sm:grid-cols-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDraftRange(defaultRange());
                setDraftScope("all");
              }}
            >
              Đặt lại
            </Button>
            <Button
              type="button"
              onClick={applyFilter}
              disabled={Boolean(validateWorkforceRange(draftRange.from, draftRange.to))}
            >
              Áp dụng
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <section
        className={`relative rounded-3xl border border-border/70 bg-card shadow-soft ${compact ? "p-3" : "p-5"}`}
      >
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">Biểu đồ nhân lực theo ngày</h3>
            <p className="text-xs text-muted-foreground">
              Từ {formatDate(range.from)} đến {formatDate(range.to)} ·{" "}
              {updatedLabel ? `Cập nhật lúc ${updatedLabel}` : "Đang chuẩn bị dữ liệu"}
            </p>
          </div>
          <a
            href={detailHref}
            className="rounded-xl border bg-background px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted"
          >
            Xem chi tiết
          </a>
        </div>
        {query.updating && days.length > 0 && (
          <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
            <RefreshCw className="h-3.5 w-3.5 animate-spin text-primary" />
            Đang cập nhật dữ liệu nền...
          </div>
        )}
        {query.loading ? (
          <DataLoadingState variant="grid" label="Đang tải dữ liệu nhân lực..." rows={4} />
        ) : query.error && days.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-destructive/40 bg-destructive/5 text-center">
            <p className="text-sm text-destructive">{query.error}</p>
            <Button onClick={() => setReloadToken((value) => value + 1)}>Thử lại</Button>
          </div>
        ) : empty ? (
          <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed text-sm text-muted-foreground">
            Chưa có dữ liệu nhân lực trong khoảng đã chọn.
          </div>
        ) : (
          <div
            className={query.staleView ? "pointer-events-none opacity-45" : "transition-opacity"}
          >
            <WorkforceDailyChart days={days} lookups={query.data?.lookups || null} />
          </div>
        )}
      </section>
      {days.length > 0 && (
        <div className={query.staleView ? "pointer-events-none opacity-45" : "transition-opacity"}>
          <WorkforceInsightsCharts
            days={days}
            lookups={query.data?.lookups || null}
            from={range.from}
            to={range.to}
          />
        </div>
      )}
    </div>
  );
}
