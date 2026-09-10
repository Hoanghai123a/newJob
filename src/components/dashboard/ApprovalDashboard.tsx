import { Link } from "@tanstack/react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  CalendarCheck,
  ClipboardCheck,
  Clock,
  MessageSquareWarning,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import {
  APPROVAL_DASHBOARD_STATUSES,
  type ApprovalDashboardStats,
  type ApprovalDashboardStatus,
} from "@/lib/approval-dashboard";

const APPROVAL_STATUS_META: Array<{
  key: ApprovalDashboardStatus;
  label: string;
  color: string;
}> = [
  { key: "pending", label: "Chờ duyệt", color: "#f59e0b" },
  { key: "approved", label: "Đã duyệt", color: "#10b981" },
  { key: "completed", label: "Hoàn thành", color: "#3b82f6" },
  { key: "rejected", label: "Từ chối", color: "#ef4444" },
];

function formatApprovalMoney(value: number) {
  return `${Math.round(value).toLocaleString("vi-VN")} đ`;
}

function formatCompactMoney(value: number) {
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} tỷ`;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} tr`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toLocaleString("vi-VN", { maximumFractionDigits: 0 })} nghìn`;
  }
  return value.toLocaleString("vi-VN");
}

export function ApprovalDashboard({
  stats,
  presentation = "default",
}: {
  stats: ApprovalDashboardStats;
  presentation?: "default" | "mobile-dialog";
}) {
  const compactMobile = presentation === "mobile-dialog";
  const totalRequests = APPROVAL_DASHBOARD_STATUSES.reduce(
    (total, status) => total + stats[status],
    0,
  );
  const chartData = APPROVAL_STATUS_META.map((item) => ({
    ...item,
    count: stats[item.key],
    amount: stats.amountByStatus[item.key],
  }));
  const tooltipStyle = {
    borderRadius: "12px",
    borderColor: "var(--border)",
    backgroundColor: "var(--card)",
    color: "var(--foreground)",
  };

  return (
    <div className="space-y-4">
      <div
        className={`rounded-3xl border border-border/70 bg-card shadow-soft ${
          compactMobile ? "p-3" : "p-4 desktop:p-5"
        }`}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">Thống kê phê duyệt</h3>
            <p className="text-xs text-muted-foreground">
              Trực quan hóa số lượng và số tiền theo trạng thái yêu cầu.
            </p>
          </div>
          <Link
            to="/staff/approvals"
            className="rounded-xl border border-border bg-background px-3 py-2 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            Xem chi tiết
          </Link>
        </div>

        <div
          className={
            compactMobile
              ? "grid grid-cols-2 gap-2"
              : "grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6"
          }
        >
          <DesktopSummaryCard label="Tổng yêu cầu" value={totalRequests} icon={ClipboardCheck} />
          <DesktopSummaryCard
            label="Tổng số tiền"
            value={formatApprovalMoney(stats.totalAmount)}
            icon={Wallet}
          />
          <DesktopSummaryCard label="Chờ duyệt" value={stats.pending} icon={Clock} />
          <DesktopSummaryCard label="Đã duyệt" value={stats.approved} icon={ShieldCheck} />
          <DesktopSummaryCard label="Hoàn thành" value={stats.completed} icon={CalendarCheck} />
          <DesktopSummaryCard label="Từ chối" value={stats.rejected} icon={MessageSquareWarning} />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="min-w-0 rounded-3xl border border-border/70 bg-card p-5 shadow-soft">
          <div className="mb-4">
            <h3 className="text-sm font-semibold">Số lượng theo trạng thái</h3>
            <p className="text-xs text-muted-foreground">Mỗi cột là tổng số yêu cầu.</p>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" axisLine={false} tickLine={false} fontSize={12} />
                <YAxis axisLine={false} tickLine={false} allowDecimals={false} fontSize={12} />
                <RechartsTooltip
                  cursor={{ fill: "var(--muted)" }}
                  contentStyle={tooltipStyle}
                  formatter={(value) => [Number(value || 0).toLocaleString("vi-VN"), "Số yêu cầu"]}
                />
                <Bar dataKey="count" radius={[8, 8, 0, 0]} maxBarSize={58}>
                  {chartData.map((item) => (
                    <Cell key={item.key} fill={item.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="min-w-0 rounded-3xl border border-border/70 bg-card p-5 shadow-soft">
          <div className="mb-4">
            <h3 className="text-sm font-semibold">Số tiền theo trạng thái</h3>
            <p className="text-xs text-muted-foreground">
              Tổng tiền của các yêu cầu có khai báo số tiền.
            </p>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" axisLine={false} tickLine={false} fontSize={12} />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  fontSize={12}
                  width={58}
                  tickFormatter={(value) => formatCompactMoney(Number(value))}
                />
                <RechartsTooltip
                  cursor={{ fill: "var(--muted)" }}
                  contentStyle={tooltipStyle}
                  formatter={(value) => [formatApprovalMoney(Number(value || 0)), "Số tiền"]}
                />
                <Bar dataKey="amount" radius={[8, 8, 0, 0]} maxBarSize={58}>
                  {chartData.map((item) => (
                    <Cell key={item.key} fill={item.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

function DesktopSummaryCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number | string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-soft">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}
