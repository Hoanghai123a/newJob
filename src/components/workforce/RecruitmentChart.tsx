import { useEffect, useMemo, useState } from "react";
import { Bar, CartesianGrid, Cell, ComposedChart, LabelList, Line, XAxis, YAxis } from "recharts";
import { Building2, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { EmploymentHistoryRecord } from "@/lib/employment";
import type { FactoryRecord } from "@/lib/factories";
import type { UserRecord } from "@/lib/pocketbase";
import {
  RecruitmentDayDetailDialog,
  type RecruitmentDayDetails,
} from "./RecruitmentDayDetailDialog";
import {
  datePart,
  enumerateDates,
  getActiveHistoriesAtDate,
  localIsoDate,
  shiftIsoDate,
} from "./workforce-stats";

export type RecruitmentChartProps = {
  histories: EmploymentHistoryRecord[];
  users: UserRecord[];
  factories: FactoryRecord[];
  from?: string;
  to?: string;
  dayDetailPresentation?: "inline" | "dialog";
};

type DailyRecruitment = {
  date: string;
  label: string;
  joined: number;
  working: number;
  left: number;
};

const chartConfig = {
  joined: { label: "Tuyển mới", color: "oklch(0.65 0.2 250)" },
  working: { label: "Còn đi làm", color: "oklch(0.7 0.18 145)" },
  left: { label: "Đã nghỉ", color: "oklch(0.68 0.2 35)" },
} satisfies ChartConfig;

function displayUserName(user?: UserRecord | null) {
  return user?.full_name?.trim() || user?.username?.trim() || "Không xác định";
}

function buildRecruitmentDayDetails({
  histories,
  users,
  factories,
  selectedDay,
}: {
  histories: EmploymentHistoryRecord[];
  users: UserRecord[];
  factories: FactoryRecord[];
  selectedDay: string | null;
}): RecruitmentDayDetails {
  if (!selectedDay) return { groups: [], workers: [] };

  const dayHistories = histories.filter((history) => datePart(history.join_date) === selectedDay);
  const userById = new Map(users.map((user) => [user.id, user]));
  const factoryById = new Map(factories.map((factory) => [factory.id, factory]));
  const factoryMap = new Map<
    string,
    {
      factoryName: string;
      recruiters: Map<string, { name: string; username: string; isVendor: boolean; count: number }>;
    }
  >();

  for (const history of dayHistories) {
    const factoryId = history.factory || "__none__";
    const partner = history.expand?.recruiter_partner;
    const staff =
      history.expand?.recruiter_staff ||
      (history.recruiter_staff ? userById.get(history.recruiter_staff) : undefined);
    const recruiterId = partner
      ? `partner:${partner.id}`
      : staff
        ? `internal:${staff.id}`
        : "__none__";
    const factoryName =
      history.expand?.factory?.name || factoryById.get(factoryId)?.name || "Không xác định";
    const recruiter = partner
      ? { name: partner.name || "Đối tác chưa xác định", username: "", isVendor: true }
      : {
          name: displayUserName(staff),
          username: staff?.username || "",
          isVendor: false,
        };
    const group = factoryMap.get(factoryId) || {
      factoryName,
      recruiters: new Map<
        string,
        { name: string; username: string; isVendor: boolean; count: number }
      >(),
    };
    const recruiterEntry = group.recruiters.get(recruiterId) || { ...recruiter, count: 0 };
    recruiterEntry.count++;
    group.recruiters.set(recruiterId, recruiterEntry);
    factoryMap.set(factoryId, group);
  }

  const groups = [...factoryMap.entries()]
    .map(([factoryId, group]) => {
      const recruiters = [...group.recruiters.entries()]
        .map(([recruiterId, entry]) => ({
          id: recruiterId,
          name: entry.name,
          username: entry.username,
          count: entry.count,
          isVendor: entry.isVendor,
        }))
        .sort(
          (a, b) =>
            b.count - a.count || a.name.localeCompare(b.name, "vi", { sensitivity: "base" }),
        );

      return {
        factoryId,
        factoryName: group.factoryName,
        total: recruiters.reduce((sum, item) => sum + item.count, 0),
        recruiters,
      };
    })
    .sort(
      (a, b) =>
        b.total - a.total ||
        a.factoryName.localeCompare(b.factoryName, "vi", { sensitivity: "base" }),
    );

  const workers = dayHistories
    .map((history) => {
      const partner = history.expand?.recruiter_partner;
      const recruiter =
        history.expand?.recruiter_staff ||
        (history.recruiter_staff ? userById.get(history.recruiter_staff) : undefined);
      const factory = history.expand?.factory || factoryById.get(history.factory);
      const joinDate = datePart(history.join_date);

      return {
        id: history.id,
        factoryName: factory?.name?.trim() || "—",
        employeeCode: history.employee_code?.trim() || "—",
        workerName: history.worker_name_snapshot?.trim() || "Thiếu thông tin",
        mainHouseName: history.expand?.main_house?.name?.trim() || "—",
        recruiterName: partner?.name || (recruiter ? displayUserName(recruiter) : "—"),
        joinDate: joinDate ? new Date(`${joinDate}T12:00:00`).toLocaleDateString("vi-VN") : "—",
      };
    })
    .sort(
      (a, b) =>
        a.factoryName.localeCompare(b.factoryName, "vi", { sensitivity: "base" }) ||
        a.workerName.localeCompare(b.workerName, "vi", { sensitivity: "base" }),
    );

  return { groups, workers };
}

export function RecruitmentChart({
  histories,
  users,
  factories,
  from,
  to,
  dayDetailPresentation = "inline",
}: RecruitmentChartProps) {
  const resolvedTo = to || localIsoDate();
  const resolvedFrom = from || shiftIsoDate(resolvedTo, -6);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedFactoryId, setSelectedFactoryId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedDay && (selectedDay < resolvedFrom || selectedDay > resolvedTo)) {
      setSelectedDay(null);
      setSelectedFactoryId(null);
    }
  }, [resolvedFrom, resolvedTo, selectedDay]);

  const dailyData = useMemo(() => {
    return enumerateDates(resolvedFrom, resolvedTo).map((date) => ({
      date,
      label: new Date(`${date}T12:00:00`).toLocaleDateString("vi-VN", {
        day: "2-digit",
        month: "2-digit",
      }),
      joined: histories.filter((history) => datePart(history.join_date) === date).length,
      left: histories.filter((history) => datePart(history.leave_date) === date).length,
      working: getActiveHistoriesAtDate(histories, date).length,
    }));
  }, [histories, resolvedFrom, resolvedTo]);

  const dayDetails = useMemo(
    () => buildRecruitmentDayDetails({ histories, users, factories, selectedDay }),
    [factories, histories, selectedDay, users],
  );
  const breakdown = dayDetails.groups;

  const selectedFactory = useMemo(
    () => breakdown.find((group) => group.factoryId === selectedFactoryId) || null,
    [breakdown, selectedFactoryId],
  );

  const selectedDayLabel = selectedDay
    ? new Date(`${selectedDay}T00:00:00`).toLocaleDateString("vi-VN")
    : "";

  return (
    <div className="space-y-4">
      <ChartContainer config={chartConfig} className="h-[240px] w-full">
        <ComposedChart
          data={dailyData}
          margin={{ top: 16, right: 4, bottom: 0, left: -8 }}
          onClick={(state) => {
            const payload = state?.activePayload?.[0]?.payload as DailyRecruitment | undefined;
            const date =
              payload?.date || dailyData.find((entry) => entry.label === state?.activeLabel)?.date;
            if (!date) return;
            setSelectedDay(date);
            setSelectedFactoryId(null);
          }}
          className="cursor-pointer"
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            interval={Math.max(0, Math.ceil(dailyData.length / 14) - 1)}
            tick={{ fontSize: 11 }}
            tickLine={false}
          />
          <YAxis yAxisId="left" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar yAxisId="left" dataKey="joined" radius={[4, 4, 0, 0]} cursor="pointer">
            <LabelList
              dataKey="joined"
              position="top"
              fontSize={11}
              fontWeight={600}
              formatter={(value: number) => (value > 0 ? value : "")}
            />
            {dailyData.map((entry) => (
              <Cell
                key={entry.date}
                fill={selectedDay === entry.date ? "oklch(0.55 0.22 250)" : "var(--color-joined)"}
              />
            ))}
          </Bar>
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="working"
            stroke="var(--color-working)"
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="left"
            stroke="var(--color-left)"
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />
        </ComposedChart>
      </ChartContainer>

      {selectedDay && dayDetailPresentation === "inline" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium text-muted-foreground">
              Chi tiết tuyển mới ngày{" "}
              {new Date(`${selectedDay}T00:00:00`).toLocaleDateString("vi-VN")}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="hidden desktop:inline-flex"
              onClick={() => setSelectedDay(null)}
            >
              <EyeOff className="h-3.5 w-3.5" />
              Ẩn chi tiết
            </Button>
          </div>

          {breakdown.length === 0 && (
            <p className="text-xs text-muted-foreground">Không có dữ liệu tuyển mới ngày này.</p>
          )}

          <div className="space-y-3 desktop:hidden">
            {breakdown.map((group) => {
              const internal = group.recruiters.filter((item) => !item.isVendor);
              const vendors = group.recruiters.filter((item) => item.isVendor);
              const internalTotal = internal.reduce((sum, item) => sum + item.count, 0);
              const vendorTotal = vendors.reduce((sum, item) => sum + item.count, 0);
              const internalPct = group.total ? Math.round((internalTotal / group.total) * 100) : 0;
              const vendorPct = group.total ? Math.round((vendorTotal / group.total) * 100) : 0;

              return (
                <div key={group.factoryId} className="space-y-2 rounded-xl border bg-card p-3">
                  <div className="flex items-center gap-1.5 text-xs font-medium">
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>{group.factoryName}</span>
                    <span className="text-muted-foreground">— {group.total}</span>
                  </div>

                  {internal.length > 0 && (
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 pl-5 text-[11px] font-semibold text-muted-foreground">
                        <span>Nội bộ</span>
                        <span className="ml-auto tabular-nums">
                          {internalTotal} ({internalPct}%)
                        </span>
                      </div>
                      <div className="space-y-0.5 pl-5">
                        {internal.map((item) => (
                          <div key={item.id} className="flex items-center gap-1.5 text-xs">
                            <span className="text-foreground">{item.name}</span>
                            <span className="ml-auto font-medium tabular-nums">{item.count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {vendors.length > 0 && (
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 pl-5 text-[11px] font-semibold text-purple-600">
                        <span>Đối tác</span>
                        <span className="ml-auto tabular-nums">
                          {vendorTotal} ({vendorPct}%)
                        </span>
                      </div>
                      <div className="space-y-0.5 pl-5">
                        {vendors.map((item) => (
                          <div key={item.id} className="flex items-center gap-1.5 text-xs">
                            <span className="text-foreground">{item.name}</span>
                            <span className="rounded-full bg-purple-600 px-2 py-0.5 text-[10px] font-medium leading-none text-white">
                              Đối tác
                            </span>
                            <span className="ml-auto font-medium tabular-nums">{item.count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="hidden gap-3 overflow-x-auto pb-2 desktop:flex">
            {breakdown.map((group) => {
              const internal = group.recruiters.filter((item) => !item.isVendor);
              const vendors = group.recruiters.filter((item) => item.isVendor);
              const internalTotal = internal.reduce((sum, item) => sum + item.count, 0);
              const vendorTotal = vendors.reduce((sum, item) => sum + item.count, 0);
              const internalPct = group.total ? Math.round((internalTotal / group.total) * 100) : 0;
              const vendorPct = group.total ? Math.round((vendorTotal / group.total) * 100) : 0;

              return (
                <button
                  key={group.factoryId}
                  type="button"
                  onClick={() => setSelectedFactoryId(group.factoryId)}
                  className="w-80 shrink-0 space-y-2 rounded-xl border bg-card p-3 text-left transition hover:border-primary/40 hover:shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
                    <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate" title={group.factoryName}>
                      {group.factoryName}
                    </span>
                    <span className="shrink-0 text-muted-foreground">— {group.total}</span>
                  </div>

                  {internal.length > 0 && (
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 pl-5 text-[11px] font-semibold text-muted-foreground">
                        <span>Nội bộ</span>
                        <span className="ml-auto tabular-nums">
                          {internalTotal} ({internalPct}%)
                        </span>
                      </div>
                      <div className="space-y-0.5 pl-5">
                        {internal.slice(0, 5).map((item) => (
                          <div key={item.id} className="flex min-w-0 items-center gap-1.5 text-xs">
                            <span
                              className="min-w-0 flex-1 truncate text-foreground"
                              title={item.name}
                            >
                              {item.name}
                            </span>
                            <span className="shrink-0 font-medium tabular-nums">{item.count}</span>
                          </div>
                        ))}
                        {internal.length > 5 && (
                          <div className="text-[11px] font-medium text-muted-foreground">
                            … và {internal.length - 5} người khác
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {vendors.length > 0 && (
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 pl-5 text-[11px] font-semibold text-purple-600">
                        <span>Đối tác</span>
                        <span className="ml-auto tabular-nums">
                          {vendorTotal} ({vendorPct}%)
                        </span>
                      </div>
                      <div className="space-y-0.5 pl-5">
                        {vendors.slice(0, 5).map((item) => (
                          <div key={item.id} className="flex min-w-0 items-center gap-1.5 text-xs">
                            <span
                              className="min-w-0 flex-1 truncate text-foreground"
                              title={item.name}
                            >
                              {item.name}
                            </span>
                            <span className="shrink-0 rounded-full bg-purple-600 px-2 py-0.5 text-[10px] font-medium leading-none text-white">
                              Đối tác
                            </span>
                            <span className="shrink-0 font-medium tabular-nums">{item.count}</span>
                          </div>
                        ))}
                        {vendors.length > 5 && (
                          <div className="text-[11px] font-medium text-purple-600">
                            … và {vendors.length - 5} người khác
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="border-t pt-2 text-[11px] font-medium text-primary">
                    Bấm để xem toàn bộ
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {dayDetailPresentation === "dialog" && (
        <RecruitmentDayDetailDialog
          open={Boolean(selectedDay)}
          selectedDay={selectedDay || ""}
          details={dayDetails}
          onOpenChange={(open) => {
            if (open) return;
            setSelectedDay(null);
            setSelectedFactoryId(null);
          }}
        />
      )}

      <Dialog
        open={Boolean(selectedFactory)}
        onOpenChange={(open) => {
          if (!open) setSelectedFactoryId(null);
        }}
      >
        <DialogContent
          layout="raw"
          className="hidden max-h-[82dvh] overflow-hidden p-0 desktop:grid desktop:max-w-2xl"
        >
          {selectedFactory &&
            (() => {
              const internal = selectedFactory.recruiters.filter((item) => !item.isVendor);
              const vendors = selectedFactory.recruiters.filter((item) => item.isVendor);
              const internalTotal = internal.reduce((sum, item) => sum + item.count, 0);
              const vendorTotal = vendors.reduce((sum, item) => sum + item.count, 0);

              return (
                <>
                  <DialogHeader className="border-b px-5 pb-4 pt-5 pr-14">
                    <DialogTitle className="flex min-w-0 items-center gap-2">
                      <Building2 className="h-5 w-5 shrink-0 text-primary" />
                      <span className="min-w-0 truncate" title={selectedFactory.factoryName}>
                        {selectedFactory.factoryName}
                      </span>
                    </DialogTitle>
                    <DialogDescription>
                      Chi tiết tuyển mới ngày {selectedDayLabel} · Tổng {selectedFactory.total} lao
                      động
                    </DialogDescription>
                  </DialogHeader>

                  <div className="grid max-h-[65dvh] gap-4 overflow-y-auto px-5 pb-5 desktop:grid-cols-2">
                    <section className="space-y-2 rounded-xl border bg-muted/20 p-3">
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        <span>Nội bộ</span>
                        <span className="ml-auto tabular-nums text-muted-foreground">
                          {internalTotal}
                        </span>
                      </div>
                      {internal.length > 0 ? (
                        <div className="space-y-1.5">
                          {internal.map((item) => (
                            <div
                              key={item.id}
                              className="flex min-w-0 items-center gap-2 rounded-lg bg-background px-3 py-2 text-sm"
                            >
                              <span className="min-w-0 flex-1 break-words font-medium">
                                {item.name}
                              </span>
                              <span className="shrink-0 font-semibold tabular-nums">
                                {item.count}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Không có người tuyển nội bộ.
                        </p>
                      )}
                    </section>

                    <section className="space-y-2 rounded-xl border border-purple-200 bg-purple-50/40 p-3 dark:border-purple-900 dark:bg-purple-950/20">
                      <div className="flex items-center gap-2 text-sm font-semibold text-purple-700 dark:text-purple-300">
                        <span>Đối tác</span>
                        <span className="ml-auto tabular-nums">{vendorTotal}</span>
                      </div>
                      {vendors.length > 0 ? (
                        <div className="space-y-1.5">
                          {vendors.map((item) => (
                            <div
                              key={item.id}
                              className="flex min-w-0 items-center gap-2 rounded-lg bg-background px-3 py-2 text-sm"
                            >
                              <span className="min-w-0 flex-1 break-words font-medium">
                                {item.name}
                              </span>
                              <span className="shrink-0 rounded-full bg-purple-600 px-2 py-0.5 text-[10px] font-medium leading-none text-white">
                                Đối tác
                              </span>
                              <span className="shrink-0 font-semibold tabular-nums">
                                {item.count}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Không có đối tác tuyển dụng.
                        </p>
                      )}
                    </section>
                  </div>
                </>
              );
            })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
