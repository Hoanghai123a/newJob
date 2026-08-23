import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  BarChart3,
  Building2,
  ChevronRight,
  Clock3,
  Download,
  RefreshCw,
  Search,
  Users,
} from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataLoadingState } from "@/components/ui/data-loading-state";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatCard } from "@/components/ui/stat-card";
import { StatusChip } from "@/components/ui/status-chip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { escapePb, relationInFilter } from "@/lib/delegations";
import type { EmploymentHistoryRecord } from "@/lib/employment";
import { exportToExcel } from "@/lib/excel";
import {
  buildWorkerHourStats,
  groupWorkerHourStats,
  type AttendanceHourItem,
  type RecruiterHourGroup,
  type SalaryHourItem,
} from "@/lib/hour-stats";
import { pb, type UserRecord } from "@/lib/pocketbase";
import { toast } from "@/lib/toast";

export type HourStatsDashboardProps = {
  presentation?: "embedded" | "standalone";
};

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatHours(value: number) {
  return Number(value.toFixed(2)).toLocaleString("vi-VN", { maximumFractionDigits: 2 });
}

type HourStatsPayload = {
  attendance: AttendanceHourItem[];
  salary: SalaryHourItem[];
  histories: EmploymentHistoryRecord[];
};

const HOUR_STATS_CACHE_TTL = 60_000;
const HOUR_STATS_QUERY_CHUNK = 40;
const hourStatsCache = new Map<string, { expiresAt: number; payload: HourStatsPayload }>();

async function fetchRecordsByIds<T>(collection: string, ids: string[], fields: string) {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += HOUR_STATS_QUERY_CHUNK) {
    chunks.push(ids.slice(index, index + HOUR_STATS_QUERY_CHUNK));
  }
  const results = await Promise.all(
    chunks.map((chunk) =>
      pb.collection(collection).getFullList<T>({
        filter: `(${relationInFilter("id", chunk)})`,
        fields,
      }),
    ),
  );
  return results.flat();
}

function latestItemsByWorker<T extends { user: string; round_no?: number }>(items: T[]) {
  const latest = new Map<string, T>();
  for (const item of items) {
    const current = latest.get(item.worker);
    if (item.worker && (!current || Number(item.round_no || 0) > Number(current.round_no || 0))) {
      latest.set(item.worker, item);
    }
  }
  return [...latest.values()];
}

const HOUR_HISTORY_FIELDS =
  "id,user,factory,employee_code,recruiter_staff,recruiter_partner,join_date,leave_date,created,expand.user.id,expand.user.full_name,expand.user.username,expand.factory.id,expand.factory.name,expand.recruiter_staff.id,expand.recruiter_staff.full_name,expand.recruiter_staff.username,expand.recruiter_partner.id,expand.recruiter_partner.name";

async function fetchHourHistoriesForRecruiter(recruiterId: string) {
  return (await pb.collection("employment_histories").getFullList({
    filter: `recruiter_staff="${escapePb(recruiterId)}"`,
    sort: "-join_date,-created",
    expand: "worker,factory,recruiter_staff,recruiter_partner",
    fields: HOUR_HISTORY_FIELDS,
  })) as unknown as EmploymentHistoryRecord[];
}

async function fetchHourHistories(userIds: string[]) {
  if (!userIds.length) return [];
  const histories: EmploymentHistoryRecord[] = [];
  for (let index = 0; index < userIds.length; index += HOUR_STATS_QUERY_CHUNK) {
    const userFilter = relationInFilter(
      "user",
      userIds.slice(index, index + HOUR_STATS_QUERY_CHUNK),
    );
    histories.push(
      ...((await pb.collection("employment_histories").getFullList({
        filter: `(${userFilter})`,
        sort: "-join_date,-created",
        expand: "worker,factory,recruiter_staff,recruiter_partner",
        fields: HOUR_HISTORY_FIELDS,
      })) as unknown as EmploymentHistoryRecord[]),
    );
  }
  return histories;
}

export function HourStatsDashboard({ presentation = "embedded" }: HourStatsDashboardProps) {
  const { user, isAdmin } = useAuth();
  const viewer = user as UserRecord | null;
  const monthInputId = useId();
  const searchInputId = useId();
  const [month, setMonth] = useState(currentMonth());
  const [attendanceItems, setAttendanceItems] = useState<AttendanceHourItem[]>([]);
  const [salaryItems, setSalaryItems] = useState<SalaryHourItem[]>([]);
  const [histories, setHistories] = useState<EmploymentHistoryRecord[]>([]);
  const [search, setSearch] = useState("");
  const [factoryId, setFactoryId] = useState("all");
  const [recruiterId, setRecruiterId] = useState("all");
  const [selectedGroup, setSelectedGroup] = useState<RecruiterHourGroup | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshToken, setRefreshToken] = useState(0);

  const load = useCallback(async () => {
    if (!viewer?.id) return;
    setLoading(true);
    try {
      void refreshToken;
      const cacheKey = `${viewer.id}:${isAdmin ? "admin" : "staff"}:${month}`;
      const cached = hourStatsCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        setAttendanceItems(cached.payload.attendance);
        setSalaryItems(cached.payload.salary);
        setHistories(cached.payload.histories);
        return;
      }

      const staffHistories = isAdmin ? [] : await fetchHourHistoriesForRecruiter(viewer.id);
      const staffWorkerFilter = isAdmin
        ? ""
        : `(${relationInFilter(
            "user",
            staffHistories.map((history) => history.worker),
          )})`;
      const filter = [`month="${escapePb(month)}"`, staffWorkerFilter].filter(Boolean).join(" && ");
      const [attendanceRows, salaryRows] = await Promise.all([
        pb.collection("check_attendance_items").getFullList<AttendanceHourItem>({
          filter,
          fields: "id,user,month,round_no,summary",
        }),
        pb.collection("check_salary_items").getFullList<SalaryHourItem>({
          filter,
          fields: "id,user,month,round_no,personal",
        }),
      ]);
      let attendance = latestItemsByWorker(attendanceRows);
      let salary = latestItemsByWorker(salaryRows);
      const attendanceIds = new Set(attendance.map((item) => item.worker));
      const [attendanceDetails, salaryDetails] = await Promise.all([
        fetchRecordsByIds<Pick<AttendanceHourItem, "id" | "rows">>(
          "check_attendance_items",
          attendance
            .filter((item) => !Object.keys(item.summary || {}).length)
            .map((item) => item.id),
          "id,rows",
        ),
        fetchRecordsByIds<Pick<SalaryHourItem, "id" | "wage_lines">>(
          "check_salary_items",
          salary.filter((item) => !attendanceIds.has(item.worker)).map((item) => item.id),
          "id,wage_lines",
        ),
      ]);
      const attendanceDetailsById = new Map(attendanceDetails.map((item) => [item.id, item]));
      const salaryDetailsById = new Map(salaryDetails.map((item) => [item.id, item]));
      attendance = attendance.map((item) => ({ ...item, ...attendanceDetailsById.get(item.id) }));
      salary = salary.map((item) => ({ ...item, ...salaryDetailsById.get(item.id) }));
      const workerIds = [...new Set([...attendance, ...salary].map((item) => item.worker))];
      const workerIdSet = new Set(workerIds);
      const historyRows = isAdmin
        ? await fetchHourHistories(workerIds)
        : staffHistories.filter((history) => workerIdSet.has(history.worker));
      const payload = { attendance, salary, histories: historyRows };
      hourStatsCache.set(cacheKey, { expiresAt: Date.now() + HOUR_STATS_CACHE_TTL, payload });
      setAttendanceItems(attendance);
      setSalaryItems(salary);
      setHistories(historyRows);
    } catch (error: any) {
      setAttendanceItems([]);
      setSalaryItems([]);
      setHistories([]);
      toast.error(error?.message || "Không tải được thống kê giờ");
    } finally {
      setLoading(false);
    }
  }, [isAdmin, month, refreshToken, viewer?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const allRows = useMemo(
    () => buildWorkerHourStats({ month, attendanceItems, salaryItems, histories }),
    [attendanceItems, histories, month, salaryItems],
  );

  const scopedRows = useMemo(
    () =>
      isAdmin ? allRows : allRows.filter((row) => row.recruiterId === `internal:${viewer?.id}`),
    [allRows, isAdmin, viewer?.id],
  );

  const factories = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of scopedRows) if (row.factoryId) map.set(row.factoryId, row.factoryName);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], "vi"));
  }, [scopedRows]);

  const recruiters = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of scopedRows) map.set(row.recruiterId || "unassigned", row.recruiterName);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], "vi"));
  }, [scopedRows]);

  const filteredRows = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("vi");
    return scopedRows.filter((row) => {
      if (factoryId !== "all" && row.factoryId !== factoryId) return false;
      if (recruiterId !== "all" && (row.recruiterId || "unassigned") !== recruiterId) return false;
      if (!keyword) return true;
      return [row.fullName, row.employeeCode, row.factoryName, row.recruiterName].some((value) =>
        value.toLocaleLowerCase("vi").includes(keyword),
      );
    });
  }, [factoryId, recruiterId, scopedRows, search]);

  const groups = useMemo(() => groupWorkerHourStats(filteredRows), [filteredRows]);
  const totalHours = filteredRows.reduce((sum, row) => sum + row.hours, 0);
  const attendanceCount = filteredRows.filter((row) => row.source === "attendance").length;
  const salaryCount = filteredRows.length - attendanceCount;

  const handleExport = () => {
    if (!filteredRows.length) return toast.warning("Không có dữ liệu để xuất");
    exportToExcel(`thong_ke_gio_${month}`, {
      "Thống kê giờ": filteredRows.map((row) => ({
        "Người tuyển": row.recruiterName,
        "Nguồn tuyển":
          row.recruiterType === "partner"
            ? "Đối tác"
            : row.recruiterType === "internal"
              ? "Nội bộ"
              : "Chưa gắn",
        "Họ tên NLĐ": row.fullName,
        "Mã NV": row.employeeCode,
        "Nhà máy": row.factoryName,
        Nguồn: row.source === "attendance" ? "Bảng công" : "Bảng lương",
        "Lần tải": row.roundNo,
        "Tổng giờ": row.hours,
      })),
    });
  };

  const content = (
    <>
      <Card className="space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-[12rem_1fr_auto]">
          <div className="space-y-1">
            <Label htmlFor={monthInputId} className="text-xs">
              Tháng thống kê
            </Label>
            <Input
              id={monthInputId}
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={searchInputId} className="text-xs">
              Tìm NLĐ
            </Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id={searchInputId}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Tên, mã NV, nhà máy..."
                className="pl-9"
              />
            </div>
          </div>
          <div className="flex items-end gap-2">
            <Button type="button" variant="outline" onClick={handleExport} className="flex-1 gap-2">
              <Download className="h-4 w-4" />
              Xuất Excel
            </Button>
            {presentation === "embedded" && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => {
                  hourStatsCache.delete(`${viewer?.id}:${isAdmin ? "admin" : "staff"}:${month}`);
                  setRefreshToken((value) => value + 1);
                }}
                disabled={loading}
                aria-label="Tải lại thống kê"
                className="shrink-0"
              >
                <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              </Button>
            )}
          </div>
        </div>

        {isAdmin && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Nhà máy</Label>
              <select
                value={factoryId}
                onChange={(event) => setFactoryId(event.target.value)}
                className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
              >
                <option value="all">Tất cả nhà máy</option>
                {factories.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Người tuyển</Label>
              <select
                value={recruiterId}
                onChange={(event) => setRecruiterId(event.target.value)}
                className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
              >
                <option value="all">Tất cả người tuyển</option>
                {recruiters.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2 text-xs">
          <StatusChip tone="info">Bảng công: {attendanceCount} NLĐ</StatusChip>
          <StatusChip tone="success">Bảng lương: {salaryCount} NLĐ</StatusChip>
          {!isAdmin && <StatusChip tone="neutral">Phạm vi: Người tôi tuyển</StatusChip>}
        </div>
      </Card>

      {loading ? (
        <DataLoadingState variant="list" label="Đang tổng hợp dữ liệu giờ..." rows={4} />
      ) : filteredRows.length === 0 ? (
        <EmptyState
          icon={Clock3}
          title="Chưa có dữ liệu giờ"
          description="Chưa tìm thấy bảng công hoặc bảng lương phù hợp trong tháng đã chọn."
        />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <StatCard
              label="Tổng giờ"
              value={formatHours(totalHours)}
              icon={Clock3}
              tone="primary"
            />
            <StatCard label="Người lao động" value={filteredRows.length} icon={Users} tone="info" />
            <StatCard label="Người tuyển" value={groups.length} icon={BarChart3} tone="success" />
          </div>

          <div className="space-y-2">
            {groups.map((group) => (
              <button
                key={group.recruiterId || "unassigned"}
                type="button"
                onClick={() => setSelectedGroup(group)}
                className="list-card flex w-full items-center gap-3 text-left"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Users className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 truncate text-sm font-semibold">
                      {group.recruiterName}
                    </span>
                    <StatusChip tone={group.recruiterType === "partner" ? "info" : "neutral"}>
                      {group.recruiterType === "partner"
                        ? "Đối tác"
                        : group.recruiterType === "internal"
                          ? "Nội bộ"
                          : "Chưa gắn"}
                    </StatusChip>
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {group.workers.length} NLĐ · {formatHours(group.hours)} giờ
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            ))}
          </div>
        </>
      )}

      <Dialog
        open={Boolean(selectedGroup)}
        onOpenChange={(open) => !open && setSelectedGroup(null)}
      >
        <DialogContent className="max-h-[88dvh] overflow-y-auto rounded-3xl sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{selectedGroup?.recruiterName || "Chi tiết người tuyển"}</DialogTitle>
            <DialogDescription>
              {selectedGroup?.workers.length || 0} NLĐ · {formatHours(selectedGroup?.hours || 0)}{" "}
              giờ trong tháng {month}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {selectedGroup?.workers.map((row) => (
              <div key={row.userId} className="rounded-2xl border border-border/70 bg-card p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{row.fullName}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Mã NV: {row.employeeCode}
                    </div>
                    <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                      <Building2 className="h-3.5 w-3.5" />
                      {row.factoryName}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-lg font-bold tabular-nums">{formatHours(row.hours)}</div>
                    <div className="text-[11px] text-muted-foreground">giờ</div>
                  </div>
                </div>
                <div className="mt-2">
                  <StatusChip tone={row.source === "attendance" ? "info" : "success"}>
                    {row.source === "attendance" ? "Bảng công" : "Bảng lương"} · lần {row.roundNo}
                  </StatusChip>
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );

  if (presentation === "embedded") {
    return <div className="min-w-0 space-y-3">{content}</div>;
  }

  return (
    <PageContainer
      title="Thống kê giờ"
      subtitle={isAdmin ? "Tổng hợp theo người tuyển" : "Giờ làm của NLĐ bạn tuyển"}
      desktopWidth="wide"
      right={
        <button
          type="button"
          onClick={() => {
            hourStatsCache.delete(`${viewer?.id}:${isAdmin ? "admin" : "staff"}:${month}`);
            setRefreshToken((value) => value + 1);
          }}
          disabled={loading}
          aria-label="Tải lại thống kê"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-primary shadow-sm disabled:opacity-60"
        >
          <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
        </button>
      }
    >
      {content}
    </PageContainer>
  );
}
