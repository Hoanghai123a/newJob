import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Scatter,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { WorkforceDashboardDay, WorkforceLookups } from "@/lib/workforce-dashboard";
import type { WorkforceMetricRow } from "./workforce-stats";

type WorkforceInsightsChartsProps = {
  days: WorkforceDashboardDay[];
  lookups: WorkforceLookups | null;
  from: string;
  to: string;
};

type DetailKind =
  | "staff-recruitment"
  | "factory-recruitment"
  | "staff-retention"
  | "factory-retention"
  | "unique-staff"
  | null;

const recruitmentConfig = {
  joined: { label: "Tuyển mới", color: "oklch(0.65 0.2 250)" },
  left: { label: "Đã nghỉ", color: "oklch(0.68 0.2 35)" },
  working: { label: "Còn đi làm", color: "oklch(0.7 0.18 145)" },
} satisfies ChartConfig;

const uniqueRecruitmentConfig = {
  joined: { label: "Tuyển mới duy nhất", color: "oklch(0.65 0.2 250)" },
  left: { label: "Đã nghỉ", color: "oklch(0.68 0.2 35)" },
  working: { label: "Còn đi làm", color: "oklch(0.7 0.18 145)" },
} satisfies ChartConfig;

const retentionConfig = {
  working: { label: "Còn đi làm", color: "oklch(0.7 0.18 145)" },
} satisfies ChartConfig;

const formatDate = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString("vi-VN");

function CombinedRankingChart({
  rows,
  config,
  emptyMessage,
  minHeight,
}: {
  rows: WorkforceMetricRow[];
  config: ChartConfig;
  emptyMessage: string;
  minHeight: number;
}) {
  if (rows.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-center text-sm text-muted-foreground"
        style={{ height: minHeight }}
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <ChartContainer config={config} className="w-full" style={{ height: minHeight }}>
      <ComposedChart data={rows} margin={{ top: 22, right: 10, bottom: 0, left: -16 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="displayName"
          interval={0}
          height={58}
          tick={{ fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value: string) => (value.length > 11 ? `${value.slice(0, 11)}…` : value)}
        />
        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="joined" fill="var(--color-joined)" radius={[5, 5, 0, 0]}>
          <LabelList
            dataKey="joined"
            position="top"
            fontSize={11}
            fontWeight={600}
            formatter={(value: number) => (value > 0 ? value : "")}
          />
        </Bar>
        <Scatter
          dataKey="left"
          fill="var(--color-left)"
          line={false}
          shape="circle"
          activeShape={{ r: 5 }}
        />
        <Scatter
          dataKey="working"
          fill="var(--color-working)"
          line={false}
          shape="circle"
          activeShape={{ r: 5 }}
        />
      </ComposedChart>
    </ChartContainer>
  );
}

function RetentionChart({
  rows,
  emptyMessage,
  minHeight,
}: {
  rows: WorkforceMetricRow[];
  emptyMessage: string;
  minHeight: number;
}) {
  if (rows.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-center text-sm text-muted-foreground"
        style={{ height: minHeight }}
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <ChartContainer config={retentionConfig} className="w-full" style={{ height: minHeight }}>
      <BarChart data={rows} margin={{ top: 22, right: 10, bottom: 0, left: -16 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="displayName"
          interval={0}
          height={58}
          tick={{ fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value: string) => (value.length > 11 ? `${value.slice(0, 11)}…` : value)}
        />
        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="working" fill="var(--color-working)" radius={[5, 5, 0, 0]}>
          <LabelList dataKey="working" position="top" fontSize={11} fontWeight={600} />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

const detailMeta: Record<
  Exclude<DetailKind, null>,
  { title: string; description: string; retention?: boolean }
> = {
  "staff-recruitment": {
    title: "Toàn bộ người tuyển mới",
    description: "Xếp hạng theo số lượt tuyển mới trong khoảng ngày.",
  },
  "factory-recruitment": {
    title: "Toàn bộ nhà máy tuyển mới",
    description: "Xếp hạng theo số lượt tuyển mới trong khoảng ngày.",
  },
  "staff-retention": {
    title: "Toàn bộ người tuyển duy trì",
    description: "Xếp hạng theo số NLĐ còn đi làm tại ngày kết thúc.",
    retention: true,
  },
  "factory-retention": {
    title: "Toàn bộ nhà máy duy trì",
    description: "Xếp hạng theo số NLĐ còn đi làm tại ngày kết thúc.",
    retention: true,
  },
  "unique-staff": {
    title: "Toàn bộ người tuyển mới duy nhất",
    description: "Mỗi NLĐ chỉ được ghi nhận cho người tuyển đầu tiên.",
  },
};

function DetailDialog({
  detail,
  rows,
  from,
  to,
  onOpenChange,
}: {
  detail: DetailKind;
  rows: WorkforceMetricRow[];
  from: string;
  to: string;
  onOpenChange: (open: boolean) => void;
}) {
  const meta = detail ? detailMeta[detail] : null;

  return (
    <Dialog open={detail !== null} onOpenChange={onOpenChange}>
      <DialogContent layout="raw" className="max-h-[88dvh] max-w-3xl overflow-hidden p-0">
        {meta && (
          <>
            <DialogHeader className="border-b px-5 pb-4 pt-5 pr-14">
              <DialogTitle>{meta.title}</DialogTitle>
              <DialogDescription>
                {meta.description} Từ {formatDate(from)} đến {formatDate(to)}.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[68dvh] overflow-y-auto px-5 pb-5">
              {rows.length === 0 ? (
                <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                  Chưa có dữ liệu để hiển thị.
                </div>
              ) : (
                <div className="overflow-hidden rounded-2xl border border-border/70">
                  <div
                    className={`grid items-center gap-2 border-b bg-muted/50 px-4 py-2 text-xs font-semibold text-muted-foreground ${meta.retention ? "grid-cols-[2.25rem_minmax(0,1fr)_5rem]" : "grid-cols-[2.25rem_minmax(0,1fr)_4.5rem_4.5rem_5rem]"}`}
                  >
                    <span>Hạng</span>
                    <span>Tên</span>
                    {!meta.retention && <span className="text-right">Tuyển mới</span>}
                    {!meta.retention && <span className="text-right">Đã nghỉ</span>}
                    <span className="text-right">Còn làm</span>
                  </div>
                  <div className="divide-y divide-border/70">
                    {rows.map((row, index) => (
                      <div
                        key={row.id}
                        className={`grid items-center gap-2 px-4 py-3 text-sm ${meta.retention ? "grid-cols-[2.25rem_minmax(0,1fr)_5rem]" : "grid-cols-[2.25rem_minmax(0,1fr)_4.5rem_4.5rem_5rem]"}`}
                      >
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                          {index + 1}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium" title={row.name}>
                            {row.name}
                          </span>
                          {row.sourceLabel && (
                            <span className="mt-0.5 block text-[11px] text-muted-foreground">
                              {row.sourceLabel}
                            </span>
                          )}
                        </span>
                        {!meta.retention && (
                          <span className="text-right font-semibold tabular-nums text-primary">
                            {row.joined}
                          </span>
                        )}
                        {!meta.retention && (
                          <span className="text-right font-semibold tabular-nums text-amber-600">
                            {row.left}
                          </span>
                        )}
                        <span className="text-right font-semibold tabular-nums text-emerald-600">
                          {row.working}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ChartCard({
  title,
  description,
  onViewAll,
  children,
}: {
  title: string;
  description: string;
  onViewAll: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-border/70 bg-card p-5 shadow-soft">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold">{title}</h3>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <button
          type="button"
          onClick={onViewAll}
          className="shrink-0 rounded-xl border border-border bg-background px-3 py-2 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          Xem toàn bộ
        </button>
      </div>
      <button
        type="button"
        onClick={onViewAll}
        className="block w-full cursor-pointer rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        aria-label={`Xem toàn bộ ${title}`}
      >
        {children}
      </button>
    </section>
  );
}

function buildRankings(days: WorkforceDashboardDay[], lookups: WorkforceLookups | null) {
  const factoryNames = new Map((lookups?.factories || []).map((item) => [item.id, item.name]));
  const recruiterNames = new Map(
    (lookups?.recruiters || []).map((item) => [`${item.source}:${item.id}`, item.name]),
  );
  const factories = new Map<string, WorkforceMetricRow>();
  const recruiters = new Map<string, WorkforceMetricRow>();
  const uniqueRecruiters = new Map<string, WorkforceMetricRow>();
  const finalDay = days.at(-1);

  const ensureFactory = (id: string) => {
    const name = factoryNames.get(id) || "Chưa gắn nhà máy";
    const row = factories.get(id) || {
      id,
      name,
      displayName: name,
      joined: 0,
      left: 0,
      working: 0,
    };
    factories.set(id, row);
    return row;
  };
  const ensureRecruiter = (id: string, source: "internal" | "partner") => {
    const key = `${source}:${id}`;
    const name =
      recruiterNames.get(key) ||
      (source === "partner" ? "Đối tác chưa xác định" : "Nhân sự chưa xác định");
    const sourceLabel = source === "partner" ? ("Đối tác" as const) : ("Nội bộ" as const);
    const row = recruiters.get(key) || {
      id: key,
      name,
      displayName: `${name} (${sourceLabel})`,
      source,
      sourceLabel,
      joined: 0,
      left: 0,
      working: 0,
    };
    recruiters.set(key, row);
    return row;
  };

  for (const day of days) {
    for (const item of day.factories) {
      const row = ensureFactory(item.id);
      row.joined += item.joined;
      row.left += item.left;
    }
    for (const item of day.recruiters) {
      if (!item.source) continue;
      const row = ensureRecruiter(item.id, item.source);
      row.joined += item.joined;
      row.left += item.left;
      if (item.uniqueJoined) {
        const unique = uniqueRecruiters.get(row.id) || { ...row, joined: 0, left: 0, working: 0 };
        unique.joined += item.uniqueJoined;
        uniqueRecruiters.set(row.id, unique);
      }
    }
  }
  for (const item of finalDay?.factories || []) ensureFactory(item.id).working = item.working;
  for (const item of finalDay?.recruiters || []) {
    if (item.source) ensureRecruiter(item.id, item.source).working = item.working;
  }

  const sort = (rows: WorkforceMetricRow[], key: "joined" | "working" = "joined") =>
    rows.sort(
      (a, b) => b[key] - a[key] || b.joined - a.joined || a.name.localeCompare(b.name, "vi"),
    );
  return {
    staffRecruitment: sort([...recruiters.values()]),
    factoryRecruitment: sort([...factories.values()]),
    staffRetention: sort(
      [...recruiters.values()].filter((row) => row.working > 0),
      "working",
    ),
    factoryRetention: sort(
      [...factories.values()].filter((row) => row.working > 0),
      "working",
    ),
    uniqueStaffRecruitment: sort([...uniqueRecruiters.values()]),
  };
}

export function WorkforceInsightsCharts({ days, lookups, from, to }: WorkforceInsightsChartsProps) {
  const [detail, setDetail] = useState<DetailKind>(null);
  const rankings = useMemo(() => buildRankings(days, lookups), [days, lookups]);

  const detailRows =
    detail === "staff-recruitment"
      ? rankings.staffRecruitment
      : detail === "factory-recruitment"
        ? rankings.factoryRecruitment
        : detail === "staff-retention"
          ? rankings.staffRetention
          : detail === "factory-retention"
            ? rankings.factoryRetention
            : detail === "unique-staff"
              ? rankings.uniqueStaffRecruitment
              : [];

  return (
    <>
      <div className="grid grid-cols-1 items-start gap-4 desktop:grid-cols-2">
        <ChartCard
          title="Top 5 người tuyển mới"
          description="Cột tuyển mới, điểm đã nghỉ và còn đi làm."
          onViewAll={() => setDetail("staff-recruitment")}
        >
          <CombinedRankingChart
            rows={rankings.staffRecruitment.slice(0, 5)}
            config={recruitmentConfig}
            minHeight={250}
            emptyMessage="Chưa có dữ liệu người tuyển mới."
          />
        </ChartCard>

        <ChartCard
          title="Top 10 nhà máy tuyển mới"
          description="Cột tuyển mới, điểm đã nghỉ và còn đi làm."
          onViewAll={() => setDetail("factory-recruitment")}
        >
          <CombinedRankingChart
            rows={rankings.factoryRecruitment.slice(0, 10)}
            config={recruitmentConfig}
            minHeight={300}
            emptyMessage="Chưa có dữ liệu tuyển mới theo nhà máy."
          />
        </ChartCard>

        <ChartCard
          title="Top 5 người tuyển duy trì"
          description={`Số NLĐ còn đi làm tại ngày ${formatDate(to)}.`}
          onViewAll={() => setDetail("staff-retention")}
        >
          <RetentionChart
            rows={rankings.staffRetention.slice(0, 5)}
            minHeight={240}
            emptyMessage="Chưa có dữ liệu người tuyển duy trì."
          />
        </ChartCard>

        <ChartCard
          title="Top 10 nhà máy duy trì"
          description={`Số NLĐ còn đi làm tại ngày ${formatDate(to)}.`}
          onViewAll={() => setDetail("factory-retention")}
        >
          <RetentionChart
            rows={rankings.factoryRetention.slice(0, 10)}
            minHeight={300}
            emptyMessage="Chưa có dữ liệu nhà máy duy trì."
          />
        </ChartCard>

        <ChartCard
          title="Top 5 người tuyển mới duy nhất"
          description="Số NLĐ được ghi nhận lần đầu cho từng người tuyển."
          onViewAll={() => setDetail("unique-staff")}
        >
          <CombinedRankingChart
            rows={rankings.uniqueStaffRecruitment.slice(0, 5)}
            config={uniqueRecruitmentConfig}
            minHeight={250}
            emptyMessage="Chưa có dữ liệu tuyển mới duy nhất."
          />
        </ChartCard>
      </div>

      <DetailDialog
        detail={detail}
        rows={detailRows}
        from={from}
        to={to}
        onOpenChange={(open) => !open && setDetail(null)}
      />
    </>
  );
}
