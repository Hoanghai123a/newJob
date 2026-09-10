import { useMemo, useState } from "react";
import { Building2, ChevronRight, IdCard, CheckCircle2, RefreshCw, Users } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusChip } from "@/components/ui/status-chip";
import type { CccdVersionRecord } from "@/lib/cccd-versions";
import type { EmploymentHistoryRecord } from "@/lib/employment";
import type { FactoryRecord } from "@/lib/factories";
import type { UserRecord } from "@/lib/pocketbase";
import {
  buildCccdCompletionDays,
  buildCccdDuplicateGroups,
  getMonthPeriod,
  type CccdCompletionDay,
  type CccdCompletionItem,
  type CccdDuplicateGroup,
} from "@/lib/workforce-other-stats";
import { cn } from "@/lib/utils";

type MonthScope = "current" | "previous";

function formatDate(value?: string) {
  if (!value) return "—";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function formatDayLabel(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("vi-VN", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
}

function SectionLoading() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((item) => (
        <div key={item} className="h-14 animate-pulse rounded-2xl bg-muted/60" />
      ))}
    </div>
  );
}

export function OtherDashboard({
  histories,
  users,
  factories,
  cccdVersions,
  loading,
  error,
  onRetry,
  presentation = "default",
}: {
  histories: EmploymentHistoryRecord[];
  users: UserRecord[];
  factories: FactoryRecord[];
  cccdVersions: CccdVersionRecord[];
  loading: boolean;
  error: string;
  onRetry: () => void;
  presentation?: "default" | "mobile-dialog";
}) {
  const [monthScope, setMonthScope] = useState<MonthScope>("current");
  const [selectedDuplicate, setSelectedDuplicate] = useState<CccdDuplicateGroup | null>(null);
  const [selectedDay, setSelectedDay] = useState<CccdCompletionDay | null>(null);
  const compactMobile = presentation === "mobile-dialog";

  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const factoriesById = useMemo(
    () => new Map(factories.map((factory) => [factory.id, factory])),
    [factories],
  );
  const versionsById = useMemo(
    () => new Map(cccdVersions.map((version) => [version.id, version])),
    [cccdVersions],
  );
  const selectedPeriod = useMemo(
    () => getMonthPeriod(new Date(), monthScope === "current" ? 0 : -1),
    [monthScope],
  );
  const duplicateGroups = useMemo(
    () => buildCccdDuplicateGroups(histories, usersById, factoriesById, selectedPeriod),
    [factoriesById, histories, selectedPeriod, usersById],
  );
  const completionDays = useMemo(
    () => buildCccdCompletionDays(histories, usersById, factoriesById, versionsById),
    [factoriesById, histories, usersById, versionsById],
  );

  return (
    <>
      <div className="grid gap-4 2xl:grid-cols-2">
        <section
          className={`min-w-0 rounded-3xl border border-border/70 bg-card shadow-soft ${
            compactMobile ? "p-3" : "p-5"
          }`}
        >
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <IdCard className="h-4 w-4" />
                </span>
                <div>
                  <h3 className="text-base font-semibold">NLĐ có một CCCD làm tại nhiều nhà máy</h3>
                  <p className="text-xs text-muted-foreground">
                    Đang xét các lịch sử có thời gian làm việc giao với {selectedPeriod.label}.
                  </p>
                </div>
              </div>
            </div>
            <div className="flex rounded-xl border border-border bg-background p-1">
              <MonthButton
                active={monthScope === "current"}
                label="Tháng này"
                onClick={() => setMonthScope("current")}
              />
              <MonthButton
                active={monthScope === "previous"}
                label="Tháng trước"
                onClick={() => setMonthScope("previous")}
              />
            </div>
          </div>

          {loading ? (
            <SectionLoading />
          ) : error ? (
            <ErrorState message={error} onRetry={onRetry} />
          ) : duplicateGroups.length === 0 ? (
            <div className="flex min-h-52 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/20 px-4 text-center">
              <Users className="mb-2 h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium">Không có CCCD làm tại nhiều nhà máy</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Không phát hiện CCCD hợp lệ xuất hiện tại từ hai nhà máy trong kỳ này.
              </p>
            </div>
          ) : compactMobile ? (
            <div className="max-h-[28rem] space-y-2 overflow-y-auto pr-0.5">
              {duplicateGroups.map((group) => (
                <button
                  key={group.cccd}
                  type="button"
                  onClick={() => setSelectedDuplicate(group)}
                  className="flex w-full items-center gap-3 rounded-2xl border border-border/70 bg-background p-3 text-left active:bg-muted/50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{group.fullName}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="font-mono">{group.cccd}</span>
                      <span>·</span>
                      <span>{group.factoryCount} nhà máy</span>
                    </div>
                  </div>
                  <StatusChip tone="warning">{group.count} lượt</StatusChip>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-border/70">
              <div className="grid min-w-[36rem] grid-cols-[minmax(0,1fr)_11rem_8rem] gap-3 bg-muted/55 px-4 py-2.5 text-xs font-semibold text-muted-foreground">
                <span>Họ tên</span>
                <span>Số CCCD</span>
                <span className="text-right">Số lượng trùng</span>
              </div>
              <div className="max-h-[30rem] overflow-y-auto">
                {duplicateGroups.map((group) => (
                  <button
                    key={group.cccd}
                    type="button"
                    onClick={() => setSelectedDuplicate(group)}
                    className="grid min-w-[36rem] w-full grid-cols-[minmax(0,1fr)_11rem_8rem] items-center gap-3 border-t border-border/60 px-4 py-3 text-left transition hover:bg-muted/45 first:border-t-0"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{group.fullName}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {group.factoryCount} nhà máy
                      </div>
                    </div>
                    <span className="font-mono text-sm tabular-nums">{group.cccd}</span>
                    <span className="flex items-center justify-end gap-2">
                      <StatusChip tone="warning">{group.count}</StatusChip>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        <section
          className={`min-w-0 rounded-3xl border border-border/70 bg-card shadow-soft ${
            compactMobile ? "p-3" : "p-5"
          }`}
        >
          <div className="mb-4 flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600">
              <CheckCircle2 className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-base font-semibold">Tỷ lệ hoàn thành ảnh CCCD trong 7 ngày</h3>
              <p className="text-xs text-muted-foreground">
                Nhóm theo ngày vào làm; hoàn thành khi có đủ ảnh mặt trước và mặt sau.
              </p>
            </div>
          </div>

          {loading ? (
            <SectionLoading />
          ) : error ? (
            <ErrorState message={error} onRetry={onRetry} />
          ) : (
            <div
              className={
                compactMobile
                  ? "grid grid-cols-2 gap-2"
                  : "grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7"
              }
            >
              {completionDays.map((day) => {
                const rateLabel = day.rate === null ? "—" : `${Math.round(day.rate)}%`;
                return (
                  <button
                    key={day.date}
                    type="button"
                    onClick={() => setSelectedDay(day)}
                    className="min-w-0 rounded-2xl border border-border/70 bg-background p-3 text-left transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-soft"
                  >
                    <div className="truncate text-[11px] font-medium capitalize text-muted-foreground">
                      {formatDayLabel(day.date)}
                    </div>
                    <div className="mt-2 text-2xl font-bold tabular-nums">{rateLabel}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {day.completed}/{day.total} đã có
                    </div>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          day.rate === null
                            ? "bg-muted"
                            : day.rate === 100
                              ? "bg-emerald-500"
                              : "bg-amber-500",
                        )}
                        style={{ width: `${day.rate || 0}%` }}
                      />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>Thiếu {day.incomplete}</span>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <DuplicateDetailDialog
        group={selectedDuplicate}
        open={Boolean(selectedDuplicate)}
        onOpenChange={(open) => !open && setSelectedDuplicate(null)}
      />
      <CompletionDayDialog
        day={selectedDay}
        open={Boolean(selectedDay)}
        onOpenChange={(open) => !open && setSelectedDay(null)}
      />
    </>
  );
}

function MonthButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg px-3 py-1.5 text-xs font-medium transition",
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-destructive/40 bg-destructive/5 px-4 text-center">
      <p className="text-sm text-destructive">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-medium text-primary-foreground"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Thử lại
      </button>
    </div>
  );
}

function DuplicateDetailDialog({
  group,
  open,
  onOpenChange,
}: {
  group: CccdDuplicateGroup | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl rounded-3xl">
        <DialogHeader>
          <DialogTitle>Chi tiết CCCD trùng: {group?.cccd || "—"}</DialogTitle>
          <DialogDescription>
            {group?.fullName || "Người lao động"} · {group?.count || 0} lịch sử tại{" "}
            {group?.factoryCount || 0} nhà máy.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[65dvh] overflow-auto rounded-2xl border border-border/70">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead className="sticky top-0 bg-muted/95 text-xs text-muted-foreground backdrop-blur">
              <tr>
                <th className="px-4 py-3 font-semibold">Mã NV</th>
                <th className="px-4 py-3 font-semibold">Họ tên</th>
                <th className="px-4 py-3 font-semibold">Nhà máy</th>
                <th className="px-4 py-3 font-semibold">Ngày vào</th>
              </tr>
            </thead>
            <tbody>
              {group?.details.map((detail) => (
                <tr key={detail.id} className="border-t border-border/60">
                  <td className="px-4 py-3 font-medium">{detail.employeeCode}</td>
                  <td className="px-4 py-3">{detail.fullName}</td>
                  <td className="px-4 py-3">{detail.factoryName}</td>
                  <td className="px-4 py-3 tabular-nums">{formatDate(detail.joinDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CompletionDayDialog({
  day,
  open,
  onOpenChange,
}: {
  day: CccdCompletionDay | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, CccdCompletionItem[]>();
    for (const item of day?.items || []) {
      const bucket = map.get(item.factoryName) || [];
      bucket.push(item);
      map.set(item.factoryName, bucket);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, "vi", { sensitivity: "base" }));
  }, [day]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl rounded-3xl desktop:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Ảnh CCCD ngày {formatDate(day?.date)}</DialogTitle>
          <DialogDescription>
            {day?.completed || 0}/{day?.total || 0} lịch sử đã có đủ hai mặt CCCD. Danh sách được
            nhóm theo nhà máy và ưu tiên trường hợp chưa có.
          </DialogDescription>
        </DialogHeader>

        {groups.length === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center rounded-2xl border border-dashed text-center text-sm text-muted-foreground">
            <Building2 className="mb-2 h-8 w-8" />
            Không có lịch sử vào làm trong ngày này.
          </div>
        ) : (
          <div className="max-h-[68dvh] space-y-3 overflow-y-auto pr-1">
            {groups.map(([factoryName, items]) => {
              const completed = items.filter((item) => item.hasCccdImages).length;
              return (
                <section
                  key={factoryName}
                  className="overflow-hidden rounded-2xl border border-border/70"
                >
                  <div className="flex items-center justify-between gap-3 bg-muted/55 px-4 py-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <Building2 className="h-4 w-4 shrink-0 text-primary" />
                      <h4 className="truncate text-sm font-semibold">{factoryName}</h4>
                    </div>
                    <div className="flex gap-2">
                      <StatusChip tone="success">Đã có: {completed}</StatusChip>
                      <StatusChip tone="warning">Chưa có: {items.length - completed}</StatusChip>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[48rem] text-left text-sm">
                      <thead className="bg-background text-xs text-muted-foreground">
                        <tr>
                          <th className="px-4 py-2.5 font-semibold">Họ tên</th>
                          <th className="px-4 py-2.5 font-semibold">Nhà máy</th>
                          <th className="px-4 py-2.5 font-semibold">Người tuyển</th>
                          <th className="px-4 py-2.5 text-right font-semibold">Tình trạng</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item) => (
                          <tr key={item.id} className="border-t border-border/60">
                            <td className="px-4 py-3 font-medium">{item.fullName}</td>
                            <td className="px-4 py-3">{item.factoryName}</td>
                            <td className="px-4 py-3">{item.recruiterName}</td>
                            <td className="px-4 py-3 text-right">
                              <StatusChip tone={item.hasCccdImages ? "success" : "warning"}>
                                {item.hasCccdImages ? "Đã có" : "Chưa có"}
                              </StatusChip>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
