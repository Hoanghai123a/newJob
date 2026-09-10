import { joinTenantFilters } from "@/lib/tenant";
import { useAuth } from "@/lib/auth";
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowUpRight,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  RotateCcw,
  WalletCards,
} from "lucide-react";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import {
  buildAdminAdvanceSegmentFilter,
  formatMoney,
  type AdvanceRecord,
  type AdvanceStatus,
  type RecoveryStatus,
} from "@/lib/advances";
import { pb } from "@/lib/pocketbase";

type PeriodKey = "last30" | "month" | "quarter" | "year" | "custom";
type DateRange = { from: string; to: string };
type FinanceAdvance = Pick<
  AdvanceRecord,
  | "id"
  | "full_name"
  | "company"
  | "employee_code"
  | "amount"
  | "status"
  | "recovery_status"
  | "created"
  | "resolved_at"
  | "disbursed"
  | "disbursed_at"
  | "recovered_at"
>;

type DailyFinance = {
  date: string;
  label: string;
  requested: number;
  disbursed: number;
  recovered: number;
};

type StatusSlice = {
  key: string;
  label: string;
  value: number;
  amount: number;
  color: string;
};

const financeChartConfig = {
  requested: { label: "Yêu cầu", color: "oklch(0.62 0.19 255)" },
  disbursed: { label: "Đã chi", color: "oklch(0.7 0.17 145)" },
  recovered: { label: "Đã thu hồi", color: "oklch(0.7 0.16 75)" },
} satisfies ChartConfig;

const statusMeta: Record<AdvanceStatus, { label: string; color: string; className: string }> = {
  pending: {
    label: "Chờ người tuyển duyệt",
    color: "oklch(0.75 0.16 75)",
    className: "bg-amber-100 text-amber-800",
  },
  recruiter_approved: {
    label: "Chờ Admin duyệt",
    color: "oklch(0.65 0.19 255)",
    className: "bg-blue-100 text-blue-800",
  },
  accepted: {
    label: "Đã tiếp nhận",
    color: "oklch(0.7 0.17 145)",
    className: "bg-emerald-100 text-emerald-800",
  },
  rejected: {
    label: "Từ chối",
    color: "oklch(0.62 0.22 25)",
    className: "bg-red-100 text-red-800",
  },
};

const recoveryMeta: Record<RecoveryStatus | "", { label: string; className: string }> = {
  "": { label: "Chờ thu hồi", className: "bg-slate-100 text-slate-700" },
  none: { label: "Chờ thu hồi", className: "bg-slate-100 text-slate-700" },
  recovered: { label: "Đã thu hồi", className: "bg-emerald-100 text-emerald-800" },
  unrecoverable: { label: "Không thể thu hồi", className: "bg-red-100 text-red-800" },
};

const periodOptions: Array<{ key: Exclude<PeriodKey, "custom">; label: string }> = [
  { key: "last30", label: "30 ngày gần nhất" },
  { key: "month", label: "Tháng này" },
  { key: "quarter", label: "3 tháng gần nhất" },
  { key: "year", label: "Năm nay" },
];

function localDateString(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function todayRange(): DateRange {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 29);
  return { from: localDateString(from), to: localDateString(to) };
}

function rangeForPeriod(period: Exclude<PeriodKey, "custom">): DateRange {
  const now = new Date();
  const end = localDateString(now);
  const start = new Date(now);

  if (period === "last30") {
    start.setDate(start.getDate() - 29);
  } else if (period === "month") {
    start.setDate(1);
  } else if (period === "quarter") {
    start.setMonth(start.getMonth() - 2, 1);
  } else {
    start.setMonth(0, 1);
  }

  return { from: localDateString(start), to: end };
}

function datePart(value?: string) {
  return value?.slice(0, 10) || "";
}

function isInRange(value: string | undefined, range: DateRange) {
  const date = datePart(value);
  return Boolean(date && date >= range.from && date <= range.to);
}

function amountOf(row: FinanceAdvance) {
  return Number(row.amount || 0);
}

function shortDate(value?: string) {
  const date = datePart(value);
  if (!date) return "—";
  return new Date(`${date}T00:00:00`).toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function eventDateLabel(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
  });
}

function money(value: number) {
  return `${formatMoney(value)}đ`;
}

function statusOf(row: FinanceAdvance): AdvanceStatus {
  return row.status || "pending";
}

function recoveryOf(row: FinanceAdvance): RecoveryStatus | "" {
  return row.recovery_status || "";
}

function isAwaitingDisbursement(row: FinanceAdvance) {
  const recovery = recoveryOf(row);
  return (
    statusOf(row) === "accepted" &&
    row.disbursed !== true &&
    (recovery === "" || recovery === "none")
  );
}

function statusBadge(row: FinanceAdvance) {
  const status = statusMeta[statusOf(row)];
  return (
    <span
      className={`inline-flex rounded-full px-2 py-1 text-[11px] font-medium ${status.className}`}
    >
      {status.label}
    </span>
  );
}

function recoveryBadge(row: FinanceAdvance) {
  if (statusOf(row) !== "accepted") return <span className="text-xs text-muted-foreground">—</span>;
  const recovery = recoveryMeta[recoveryOf(row)];
  return (
    <span
      className={`inline-flex rounded-full px-2 py-1 text-[11px] font-medium ${recovery.className}`}
    >
      {recovery.label}
    </span>
  );
}

export function FinanceDashboard({
  presentation = "default",
}: {
  presentation?: "default" | "mobile-dialog";
}) {
  const { user } = useAuth();
  const [period, setPeriod] = useState<PeriodKey>("last30");
  const [range, setRange] = useState<DateRange>(todayRange);
  const [rows, setRows] = useState<FinanceAdvance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const compactMobile = presentation === "mobile-dialog";

  const activeRange = useMemo(() => {
    if (period !== "custom") return rangeForPeriod(period);
    if (range.from && range.to && range.from <= range.to) return range;
    return null;
  }, [period, range]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await pb.collection("advances").getFullList<FinanceAdvance>({
        filter: joinTenantFilters(user, buildAdminAdvanceSegmentFilter("workers")),
        sort: "-created",
        fields:
          "id,full_name,company,employee_code,amount,status,recovery_status,created,resolved_at,disbursed,disbursed_at,recovered_at",
      });
      setRows(data);
    } catch (loadError: unknown) {
      setRows([]);
      setError(loadError instanceof Error ? loadError.message : "Không thể tải dữ liệu báo ứng.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const report = useMemo(() => {
    if (!activeRange) return null;

    const requestedRows = rows.filter((row) => isInRange(row.created, activeRange));
    const waitingApprovalRows = requestedRows.filter(
      (row) => statusOf(row) === "recruiter_approved",
    );
    const waitingDisbursement = requestedRows.filter(isAwaitingDisbursement);
    const disbursedRows = rows.filter(
      (row) => row.disbursed === true && isInRange(row.disbursed_at, activeRange),
    );
    const recoveredRows = rows.filter(
      (row) => recoveryOf(row) === "recovered" && isInRange(row.recovered_at, activeRange),
    );
    const days: DailyFinance[] = [];
    const cursor = new Date(`${activeRange.from}T00:00:00`);
    const end = new Date(`${activeRange.to}T00:00:00`);
    while (cursor <= end) {
      const date = localDateString(cursor);
      days.push({ date, label: eventDateLabel(date), requested: 0, disbursed: 0, recovered: 0 });
      cursor.setDate(cursor.getDate() + 1);
    }
    const byDate = new Map(days.map((day) => [day.date, day]));
    for (const row of requestedRows) {
      const day = byDate.get(datePart(row.created));
      if (day) day.requested += amountOf(row);
    }
    for (const row of disbursedRows) {
      const day = byDate.get(datePart(row.disbursed_at));
      if (day) day.disbursed += amountOf(row);
    }
    for (const row of recoveredRows) {
      const day = byDate.get(datePart(row.recovered_at));
      if (day) day.recovered += amountOf(row);
    }

    const statusSlices = [
      { key: "pending", ...statusMeta.pending },
      { key: "recruiter_approved", ...statusMeta.recruiter_approved },
      { key: "accepted", ...statusMeta.accepted },
      { key: "recovered", label: "Đã thu hồi", color: "oklch(0.7 0.16 75)" },
      { key: "unrecoverable", label: "Không thể thu hồi", color: "oklch(0.62 0.22 25)" },
      { key: "rejected", ...statusMeta.rejected },
    ]
      .map<StatusSlice>((item) => {
        const matchingRows = requestedRows.filter((row) => {
          const status = statusOf(row);
          const recovery = recoveryOf(row);
          if (item.key === "recovered") return status === "accepted" && recovery === "recovered";
          if (item.key === "unrecoverable")
            return status === "accepted" && recovery === "unrecoverable";
          if (item.key === "accepted")
            return status === "accepted" && (recovery === "" || recovery === "none");
          return status === item.key;
        });

        return {
          key: item.key,
          label: item.label,
          color: item.color,
          value: matchingRows.length,
          amount: matchingRows.reduce((sum, row) => sum + amountOf(row), 0),
        };
      })
      .filter((item) => item.value > 0);

    return {
      requestedCount: requestedRows.length,
      requestedTotal: requestedRows.reduce((sum, row) => sum + amountOf(row), 0),
      waitingApprovalTotal: waitingApprovalRows.reduce((sum, row) => sum + amountOf(row), 0),
      waitingApprovalCount: waitingApprovalRows.length,
      waitingDisbursementTotal: waitingDisbursement.reduce((sum, row) => sum + amountOf(row), 0),
      waitingDisbursementCount: waitingDisbursement.length,
      disbursedTotal: disbursedRows.reduce((sum, row) => sum + amountOf(row), 0),
      disbursedCount: disbursedRows.length,
      recoveredTotal: recoveredRows.reduce((sum, row) => sum + amountOf(row), 0),
      recoveredCount: recoveredRows.length,
      days,
      statusSlices,
      recentRows: requestedRows.slice(0, 10),
    };
  }, [activeRange, rows]);

  const updateCustomRange = (field: keyof DateRange, value: string) => {
    setPeriod("custom");
    setRange((current) => ({ ...current, [field]: value }));
  };

  return (
    <div className={compactMobile ? "min-w-0 space-y-4" : "space-y-5"}>
      <section
        className={`flex flex-wrap items-center gap-2 rounded-2xl border border-border/70 bg-card ${
          compactMobile ? "p-2.5" : "p-3"
        }`}
      >
        {periodOptions.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => {
              setPeriod(option.key);
              setRange(rangeForPeriod(option.key));
            }}
            className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
              period === option.key
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {option.label}
          </button>
        ))}
        <div
          className={
            compactMobile
              ? "grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 text-xs"
              : "flex w-full items-center gap-2 overflow-x-auto text-xs desktop:ml-auto desktop:w-auto"
          }
        >
          <input
            type="date"
            value={range.from}
            aria-label="Từ ngày"
            onChange={(event) => updateCustomRange("from", event.target.value)}
            className={`h-9 rounded-lg border border-input bg-white px-2 text-xs text-slate-900 outline-none focus:ring-2 focus:ring-ring/50 ${
              compactMobile ? "min-w-0 w-full" : "min-w-[8.5rem]"
            }`}
          />
          <span className="text-muted-foreground">đến</span>
          <input
            type="date"
            value={range.to}
            aria-label="Đến ngày"
            onChange={(event) => updateCustomRange("to", event.target.value)}
            className={`h-9 rounded-lg border border-input bg-white px-2 text-xs text-slate-900 outline-none focus:ring-2 focus:ring-ring/50 ${
              compactMobile ? "min-w-0 w-full" : "min-w-[8.5rem]"
            }`}
          />
        </div>
      </section>

      {!activeRange ? (
        <div className="rounded-3xl border border-dashed border-destructive/40 bg-destructive/5 p-8 text-center text-sm text-destructive">
          Khoảng ngày tùy chỉnh chưa hợp lệ. Vui lòng chọn ngày bắt đầu không sau ngày kết thúc.
        </div>
      ) : loading ? (
        <FinanceLoading />
      ) : error ? (
        <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-destructive/40 bg-destructive/5 p-8 text-center">
          <p className="text-sm text-destructive">{error}</p>
          <Button type="button" size="sm" onClick={load}>
            Thử lại
          </Button>
        </div>
      ) : report ? (
        <>
          <div
            className={
              compactMobile ? "grid grid-cols-2 gap-2" : "grid grid-cols-2 gap-4 xl:grid-cols-5"
            }
          >
            <FinanceKpi
              label="Yêu cầu trong kỳ"
              value={money(report.requestedTotal)}
              detail={`${report.requestedCount} đơn tạo trong kỳ`}
              icon={WalletCards}
              tone="blue"
            />
            <FinanceKpi
              label="Chờ duyệt"
              value={money(report.waitingApprovalTotal)}
              detail={`${report.waitingApprovalCount} đơn chờ admin duyệt`}
              icon={ClipboardCheck}
              tone="amber"
            />
            <FinanceKpi
              label="Chờ chi"
              value={money(report.waitingDisbursementTotal)}
              detail={`${report.waitingDisbursementCount} đơn đã tiếp nhận`}
              icon={Clock3}
              tone="amber"
            />
            <FinanceKpi
              label="Đã chi trong kỳ"
              value={money(report.disbursedTotal)}
              detail={`${report.disbursedCount} lượt giải ngân`}
              icon={CircleDollarSign}
              tone="green"
            />
            <FinanceKpi
              label="Đã thu hồi trong kỳ"
              value={money(report.recoveredTotal)}
              detail={`${report.recoveredCount} lượt thu hồi`}
              icon={RotateCcw}
              tone="purple"
            />
          </div>

          {report.requestedCount === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-3xl border border-dashed bg-card p-8 text-center">
              <CheckCircle2 className="h-8 w-8 text-muted-foreground" />
              <h3 className="text-base font-semibold">Chưa có báo ứng trong khoảng này</h3>
              <p className="text-sm text-muted-foreground">
                Hãy chọn một khoảng thời gian khác để xem dữ liệu.
              </p>
            </div>
          ) : (
            <>
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(19rem,0.85fr)]">
                <section
                  className={`rounded-3xl border border-border/70 bg-card shadow-soft ${compactMobile ? "p-3" : "p-5"}`}
                >
                  <div className="mb-4">
                    <h3 className="text-base font-semibold">Dòng tiền theo ngày</h3>
                    <p className="text-xs text-muted-foreground">
                      Yêu cầu theo ngày tạo, chi và thu hồi theo ngày nghiệp vụ.
                    </p>
                  </div>
                  <ChartContainer config={financeChartConfig} className="h-[290px] w-full">
                    <ComposedChart
                      data={report.days}
                      margin={{ top: 8, right: 8, bottom: 0, left: 4 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 10 }}
                        tickLine={false}
                        interval="preserveStartEnd"
                      />
                      <YAxis
                        tick={{ fontSize: 10 }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(value: number) => `${Math.round(value / 1_000_000)}tr`}
                      />
                      <ChartTooltip
                        content={
                          <ChartTooltipContent
                            formatter={(value, name) => (
                              <div className="flex min-w-0 items-center justify-between gap-3">
                                <span className="text-muted-foreground">
                                  {financeChartConfig[name as keyof typeof financeChartConfig]
                                    ?.label || name}
                                  :
                                </span>
                                <span className="font-medium tabular-nums">
                                  {money(Number(value))}
                                </span>
                              </div>
                            )}
                          />
                        }
                      />
                      <ChartLegend content={<ChartLegendContent />} />
                      <Bar
                        dataKey="requested"
                        fill="var(--color-requested)"
                        radius={[4, 4, 0, 0]}
                      />
                      <Line
                        type="monotone"
                        dataKey="disbursed"
                        stroke="var(--color-disbursed)"
                        strokeWidth={2.25}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="recovered"
                        stroke="var(--color-recovered)"
                        strokeWidth={2.25}
                        dot={false}
                      />
                    </ComposedChart>
                  </ChartContainer>
                </section>

                <section
                  className={`rounded-3xl border border-border/70 bg-card shadow-soft ${compactMobile ? "p-3" : "p-5"}`}
                >
                  <div className="mb-3">
                    <h3 className="text-base font-semibold">Cơ cấu trạng thái</h3>
                    <p className="text-xs text-muted-foreground">Theo số lượng đơn tạo trong kỳ.</p>
                  </div>
                  {report.statusSlices.length > 0 ? (
                    <>
                      <ChartContainer config={{}} className="mx-auto h-[200px] max-w-[260px]">
                        <PieChart>
                          <Pie
                            data={report.statusSlices}
                            dataKey="value"
                            nameKey="label"
                            innerRadius={48}
                            outerRadius={78}
                            paddingAngle={3}
                          >
                            {report.statusSlices.map((slice) => (
                              <Cell key={slice.key} fill={slice.color} />
                            ))}
                          </Pie>
                          <ChartTooltip
                            content={
                              <ChartTooltipContent
                                nameKey="label"
                                formatter={(_value, name, item) => (
                                  <div className="flex min-w-0 items-center justify-between gap-3">
                                    <span className="text-muted-foreground">{name}:</span>
                                    <span className="font-medium tabular-nums">
                                      {money(Number((item?.payload as StatusSlice)?.amount ?? 0))}
                                    </span>
                                  </div>
                                )}
                              />
                            }
                          />
                        </PieChart>
                      </ChartContainer>
                      <div className="space-y-2">
                        {report.statusSlices.map((slice) => (
                          <div key={slice.key} className="flex items-center gap-2 text-xs">
                            <span
                              className="h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: slice.color }}
                            />
                            <span className="min-w-0 flex-1 truncate text-muted-foreground">
                              {slice.label}
                            </span>
                            <span className="font-semibold tabular-nums">{slice.value}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : null}
                </section>
              </div>

              <section className="overflow-hidden rounded-3xl border border-border/70 bg-card shadow-soft">
                <div
                  className={`flex flex-wrap items-center justify-between gap-3 border-b border-border/70 ${
                    compactMobile ? "px-3 py-3" : "px-5 py-4"
                  }`}
                >
                  <div>
                    <h3 className="text-base font-semibold">Báo ứng gần nhất</h3>
                    <p className="text-xs text-muted-foreground">
                      Các đơn được tạo trong khoảng thời gian đang xem.
                    </p>
                  </div>
                  <Link
                    to="/advances"
                    className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-border bg-background px-3 py-2 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  >
                    Xử lý báo ứng
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[860px] text-left text-sm">
                    <thead className="bg-muted/40 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-5 py-3 font-medium">NLĐ</th>
                        <th className="px-4 py-3 font-medium">Công ty</th>
                        <th className="px-4 py-3 text-right font-medium">Số tiền</th>
                        <th className="px-4 py-3 font-medium">Trạng thái duyệt</th>
                        <th className="px-4 py-3 font-medium">Thu hồi</th>
                        <th className="px-5 py-3 font-medium">Ngày tạo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/70">
                      {report.recentRows.map((row) => (
                        <tr key={row.id} className="transition-colors hover:bg-muted/30">
                          <td className="px-5 py-3">
                            <div className="font-medium">{row.full_name || "Chưa có tên"}</div>
                            <div className="text-xs text-muted-foreground">
                              {row.employee_code || "—"}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{row.company || "—"}</td>
                          <td className="px-4 py-3 text-right font-semibold tabular-nums">
                            {money(amountOf(row))}
                          </td>
                          <td className="px-4 py-3">{statusBadge(row)}</td>
                          <td className="px-4 py-3">{recoveryBadge(row)}</td>
                          <td className="px-5 py-3 text-xs text-muted-foreground">
                            {shortDate(row.created)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </>
      ) : null}
    </div>
  );
}

function FinanceKpi({
  label,
  value,
  detail,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof WalletCards;
  tone: "blue" | "amber" | "green" | "purple";
}) {
  const toneClass = {
    blue: "bg-blue-100 text-blue-700",
    amber: "bg-amber-100 text-amber-700",
    green: "bg-emerald-100 text-emerald-700",
    purple: "bg-violet-100 text-violet-700",
  }[tone];

  return (
    <section className="rounded-3xl border border-border/70 bg-card p-3 shadow-soft desktop:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-2 truncate text-xl font-bold tabular-nums tracking-tight">{value}</p>
        </div>
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${toneClass}`}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <p className="mt-2 truncate text-xs text-muted-foreground">{detail}</p>
    </section>
  );
}

function FinanceLoading() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="h-32 animate-pulse rounded-3xl bg-muted/60" />
        ))}
      </div>
      <div className="h-80 animate-pulse rounded-3xl bg-muted/60" />
    </div>
  );
}
