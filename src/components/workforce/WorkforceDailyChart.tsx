import { useMemo, useState } from "react";
import { Bar, CartesianGrid, Cell, ComposedChart, LabelList, Line, XAxis, YAxis } from "recharts";
import { Building2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
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

const chartConfig = {
  joined: { label: "Tuyển mới", color: "oklch(0.65 0.2 250)" },
  working: { label: "Còn đi làm", color: "oklch(0.7 0.18 145)" },
  left: { label: "Đã nghỉ", color: "oklch(0.68 0.2 35)" },
} satisfies ChartConfig;

export function WorkforceDailyChart({
  days,
  lookups,
}: {
  days: WorkforceDashboardDay[];
  lookups: WorkforceLookups | null;
}) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const factoryNames = useMemo(
    () => new Map((lookups?.factories || []).map((item) => [item.id, item.name])),
    [lookups],
  );
  const recruiterNames = useMemo(
    () =>
      new Map((lookups?.recruiters || []).map((item) => [`${item.source}:${item.id}`, item.name])),
    [lookups],
  );
  const data = useMemo(
    () =>
      days.map((day) => ({
        ...day,
        label: new Date(`${day.date}T12:00:00`).toLocaleDateString("vi-VN", {
          day: "2-digit",
          month: "2-digit",
        }),
      })),
    [days],
  );
  const selected = days.find((day) => day.date === selectedDay) || null;
  const workers = selected?.recruitedWorkers || [];

  return (
    <>
      <ChartContainer config={chartConfig} className="h-[240px] w-full">
        <ComposedChart data={data} margin={{ top: 16, right: 4, bottom: 0, left: -8 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="label"
            interval="preserveStartEnd"
            minTickGap={12}
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            yAxisId="left"
            allowDecimals={false}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            allowDecimals={false}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar
            yAxisId="left"
            dataKey="joined"
            fill="var(--color-joined)"
            radius={[5, 5, 0, 0]}
            onClick={(entry) => {
              const value = entry?.payload as WorkforceDashboardDay | undefined;
              if (value?.date) {
                setSelectedDay(value.date);
                setShowDetails(false);
              }
            }}
          >
            <LabelList
              dataKey="joined"
              position="top"
              fontSize={11}
              fontWeight={600}
              formatter={(value: number) => (value > 0 ? value : "")}
            />
            {data.map((entry) => (
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

      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedDay(null);
            setShowDetails(false);
          }
        }}
      >
        <DialogContent
          layout="raw"
          className="max-h-[92dvh] w-[calc(100%-1rem)] max-w-none overflow-hidden p-0 sm:w-[calc(100%-2rem)] desktop:w-[98vw] desktop:max-w-[98vw]"
        >
          {selected && (
            <>
              <DialogHeader className="border-b px-5 pb-4 pt-5 pr-14">
                <DialogTitle>
                  Chi tiết tuyển mới ngày{" "}
                  {new Date(`${selected.date}T12:00:00`).toLocaleDateString("vi-VN")}
                </DialogTitle>
                <DialogDescription>
                  {selected.joined} lượt tuyển mới, {selected.left} phát sinh nghỉ và{" "}
                  {selected.working} người còn làm.
                </DialogDescription>
              </DialogHeader>
              <div className="max-h-[68dvh] overflow-y-auto px-5 pb-5">
                <div className="grid gap-4 desktop:grid-cols-2">
                  {[...selected.factories]
                    .sort((a, b) => b.joined - a.joined)
                    .map((factory) => (
                      <section
                        key={factory.id}
                        className="rounded-2xl border border-border/70 bg-card p-4"
                      >
                        <div className="flex items-center gap-2 border-b pb-3 text-sm font-semibold">
                          <Building2 className="h-4 w-4 text-primary" />
                          <span className="min-w-0 flex-1 truncate">
                            {factoryNames.get(factory.id) || "Chưa gắn nhà máy"}
                          </span>
                          <span className="rounded-full bg-primary/10 px-2 py-1 text-xs text-primary">
                            {factory.joined}
                          </span>
                        </div>
                        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                          <div className="rounded-xl bg-primary/5 p-2">
                            <strong className="block text-base text-primary">
                              {factory.joined}
                            </strong>
                            Tuyển mới
                          </div>
                          <div className="rounded-xl bg-amber-500/5 p-2">
                            <strong className="block text-base text-amber-600">
                              {factory.left}
                            </strong>
                            Đã nghỉ
                          </div>
                          <div className="rounded-xl bg-emerald-500/5 p-2">
                            <strong className="block text-base text-emerald-600">
                              {factory.working}
                            </strong>
                            Còn làm
                          </div>
                        </div>
                      </section>
                    ))}
                  <section className="rounded-2xl border border-border/70 bg-card p-4 desktop:col-span-2">
                    <h4 className="mb-3 text-sm font-semibold">Theo người tuyển</h4>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {[...selected.recruiters]
                        .sort((a, b) => b.joined - a.joined)
                        .map((item) => (
                          <div
                            key={`${item.source}:${item.id}`}
                            className="flex items-center gap-3 rounded-xl bg-muted/50 px-3 py-2 text-sm"
                          >
                            <span className="min-w-0 flex-1 truncate">
                              {recruiterNames.get(`${item.source}:${item.id}`) ||
                                (item.source === "partner"
                                  ? "Đối tác chưa xác định"
                                  : "Nhân sự chưa xác định")}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {item.source === "partner" ? "Đối tác" : "Nội bộ"}
                            </span>
                            <strong className="tabular-nums text-primary">{item.joined}</strong>
                          </div>
                        ))}
                    </div>
                  </section>
                </div>
                {workers.length === 0 ? (
                  <p className="mt-4 rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
                    {selected.joined > 0
                      ? "Đang cập nhật chi tiết tuyển mới..."
                      : "Không có dữ liệu tuyển mới."}
                  </p>
                ) : (
                  <div className="mt-4 flex justify-center">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowDetails((value) => !value)}
                    >
                      {showDetails ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                      {showDetails ? "Ẩn chi tiết" : "Xem chi tiết"}
                    </Button>
                  </div>
                )}
                {showDetails && workers.length > 0 && (
                  <>
                    <div className="mt-4 hidden overflow-x-hidden rounded-xl border sm:block">
                      <table className="w-full min-w-0 table-fixed border-collapse text-left text-xs">
                        <thead className="sticky top-0 bg-muted text-[11px] font-semibold text-muted-foreground">
                          <tr>
                            <th className="px-3 py-2">STT</th>
                            <th className="px-3 py-2">Mã NV</th>
                            <th className="px-3 py-2">Họ tên</th>
                            <th className="px-3 py-2">Nhà máy</th>
                            <th className="px-3 py-2">Nhà chính</th>
                            <th className="px-3 py-2">Người tuyển</th>
                            <th className="px-3 py-2">Ngày vào</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {workers.map((worker, index) => (
                            <tr key={worker.id}>
                              <td className="px-3 py-2">{index + 1}</td>
                              <td className="px-3 py-2">{worker.employeeCode}</td>
                              <td className="px-3 py-2 font-medium">{worker.workerName}</td>
                              <td className="px-3 py-2">{worker.factoryName}</td>
                              <td className="px-3 py-2">{worker.mainHouseName}</td>
                              <td className="px-3 py-2">{worker.recruiterName}</td>
                              <td className="whitespace-nowrap px-3 py-2">
                                {new Date(`${worker.joinDate}T12:00:00`).toLocaleDateString(
                                  "vi-VN",
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-4 space-y-2 sm:hidden">
                      {workers.map((worker, index) => (
                        <article
                          key={worker.id}
                          className="space-y-3 rounded-xl border border-border/70 bg-card p-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-[11px] text-muted-foreground">
                                STT {index + 1} · {worker.employeeCode}
                              </div>
                              <div className="mt-0.5 break-words text-sm font-semibold">
                                {worker.workerName}
                              </div>
                            </div>
                            <span className="shrink-0 text-[11px] text-muted-foreground">
                              {new Date(`${worker.joinDate}T12:00:00`).toLocaleDateString("vi-VN")}
                            </span>
                          </div>
                          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                            <div>
                              <dt className="text-muted-foreground">Nhà máy</dt>
                              <dd className="mt-0.5 font-medium">{worker.factoryName}</dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground">Nhà chính</dt>
                              <dd className="mt-0.5 font-medium">{worker.mainHouseName}</dd>
                            </div>
                            <div className="col-span-2">
                              <dt className="text-muted-foreground">Người tuyển</dt>
                              <dd className="mt-0.5 font-medium">{worker.recruiterName}</dd>
                            </div>
                          </dl>
                        </article>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
