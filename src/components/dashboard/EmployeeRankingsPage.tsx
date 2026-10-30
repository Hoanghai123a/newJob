import { useCallback, useEffect, useId, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Upload,
} from "lucide-react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MonthInput } from "@/components/ui/month-input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  parseEmployeeMonthlyHoursImport,
  type EmploymentStatusFilter,
  type EmployeeMonthlyHoursImportRow,
  type HourRankingRow,
  type HoursMetric,
  type SeniorityRankingRow,
} from "@/lib/employee-monthly-hours";
import { useAuth } from "@/lib/auth";
import { pb } from "@/lib/pocketbase";

const PAGE_SIZE = 50;
const IMPORT_HEADERS = [
  "UID lịch sử",
  "Mã NV",
  "Họ tên",
  "Tên nhà máy",
  "Tháng",
  "Số giờ HC",
  "Số giờ TC",
];

type FactoryOption = { id: string; name: string };
type RankingResponse<T> = {
  items: T[];
  totalItems: number;
  totalPages: number;
  page: number;
  perPage: number;
  factories: FactoryOption[];
};
type ImportPreview = {
  rows: Array<{ rowNumber: number; action: "create" | "update" }>;
  errors: Array<{ rowNumber: number; reason: string }>;
  created: number;
  updated: number;
  failed: number;
};
type ImportResult = Pick<ImportPreview, "errors" | "created" | "updated" | "failed">;

type HoursFilters = {
  monthFrom: string;
  monthTo: string;
  factoryId: string;
  employeeCode: string;
  workerName: string;
  status: EmploymentStatusFilter;
  metric: HoursMetric;
};
type SeniorityFilters = {
  factoryId: string;
  joinDateFrom: string;
  joinDateTo: string;
};

function currentMonth() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
}

async function requestEmployeeHours<T>(url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${pb.authStore.token}`);
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetch(url, { ...init, headers });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.message || "Không thể tải dữ liệu xếp hạng.");
  return body as T;
}

function formatHours(value: number) {
  return Number(value || 0).toLocaleString("vi-VN", { maximumFractionDigits: 2 });
}

function formatDate(value: string) {
  if (!value) return "—";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function StatusLabel({ status }: { status: HourRankingRow["status"] }) {
  const label = status === "working" ? "Đang làm" : status === "left" ? "Đã nghỉ" : "Chưa rõ";
  const tone =
    status === "working"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : status === "left"
        ? "border-rose-200 bg-rose-50 text-rose-800"
        : "border-border bg-muted text-muted-foreground";
  return <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-medium ${tone}`}>{label}</span>;
}

function MetricSwitch({ value, onChange }: { value: HoursMetric; onChange: (value: HoursMetric) => void }) {
  const choices: Array<{ value: HoursMetric; label: string }> = [
    { value: "hc", label: "Chỉ giờ HC" },
    { value: "tc", label: "Chỉ giờ TC" },
    { value: "both", label: "Cả hai" },
  ];
  return (
    <div className="inline-flex max-w-full rounded-md border bg-muted/40 p-1" role="group" aria-label="Chỉ số xếp hạng">
      {choices.map((choice) => (
        <button
          key={choice.value}
          type="button"
          aria-pressed={value === choice.value}
          onClick={() => onChange(choice.value)}
          className={`min-h-9 rounded px-3 text-xs font-medium transition-colors sm:text-sm ${
            value === choice.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}

export function EmployeeRankingsPage() {
  const { user, loading: authLoading } = useAuth();
  const monthFromId = useId();
  const monthToId = useId();
  const factoryId = useId();
  const codeId = useId();
  const nameId = useId();
  const statusId = useId();
  const joinFromId = useId();
  const joinToId = useId();
  const seniorityFactoryId = useId();
  const [tab, setTab] = useState("hours");
  const [hoursDraft, setHoursDraft] = useState<HoursFilters>(() => ({
    monthFrom: currentMonth(),
    monthTo: currentMonth(),
    factoryId: "",
    employeeCode: "",
    workerName: "",
    status: "all",
    metric: "both",
  }));
  const [hoursFilters, setHoursFilters] = useState(hoursDraft);
  const [hoursPage, setHoursPage] = useState(1);
  const [hoursRows, setHoursRows] = useState<HourRankingRow[]>([]);
  const [hoursTotal, setHoursTotal] = useState(0);
  const [hoursPages, setHoursPages] = useState(1);
  const [hoursLoading, setHoursLoading] = useState(true);
  const [hoursError, setHoursError] = useState("");

  const [seniorityDraft, setSeniorityDraft] = useState<SeniorityFilters>({
    factoryId: "",
    joinDateFrom: "",
    joinDateTo: "",
  });
  const [seniorityFilters, setSeniorityFilters] = useState(seniorityDraft);
  const [seniorityPage, setSeniorityPage] = useState(1);
  const [seniorityRows, setSeniorityRows] = useState<SeniorityRankingRow[]>([]);
  const [seniorityTotal, setSeniorityTotal] = useState(0);
  const [seniorityPages, setSeniorityPages] = useState(1);
  const [seniorityLoading, setSeniorityLoading] = useState(true);
  const [seniorityError, setSeniorityError] = useState("");
  const [factories, setFactories] = useState<FactoryOption[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const loadHours = useCallback(async () => {
    if (!user?.id) return;
    setHoursLoading(true);
    setHoursError("");
    const query = new URLSearchParams({
      view: "hours",
      monthFrom: hoursFilters.monthFrom,
      monthTo: hoursFilters.monthTo,
      page: String(hoursPage),
      perPage: String(PAGE_SIZE),
      metric: hoursFilters.metric,
      status: hoursFilters.status,
    });
    if (hoursFilters.factoryId) query.set("factoryId", hoursFilters.factoryId);
    if (hoursFilters.employeeCode.trim()) query.set("employeeCode", hoursFilters.employeeCode.trim());
    if (hoursFilters.workerName.trim()) query.set("workerName", hoursFilters.workerName.trim());
    try {
      const result = await requestEmployeeHours<RankingResponse<HourRankingRow>>(
        `/api/admin/employee-monthly-hours?${query}`,
      );
      setHoursRows(result.items);
      setHoursTotal(result.totalItems);
      setHoursPages(result.totalPages);
      setFactories(result.factories);
    } catch (error) {
      setHoursRows([]);
      setHoursTotal(0);
      setHoursPages(1);
      setHoursError(error instanceof Error ? error.message : "Không tải được bảng xếp hạng giờ.");
    } finally {
      setHoursLoading(false);
    }
  }, [hoursFilters, hoursPage, user?.id]);

  const loadSeniority = useCallback(async () => {
    if (!user?.id) return;
    setSeniorityLoading(true);
    setSeniorityError("");
    const query = new URLSearchParams({
      view: "seniority",
      page: String(seniorityPage),
      perPage: String(PAGE_SIZE),
    });
    if (seniorityFilters.factoryId) query.set("factoryId", seniorityFilters.factoryId);
    if (seniorityFilters.joinDateFrom) query.set("joinDateFrom", seniorityFilters.joinDateFrom);
    if (seniorityFilters.joinDateTo) query.set("joinDateTo", seniorityFilters.joinDateTo);
    try {
      const result = await requestEmployeeHours<RankingResponse<SeniorityRankingRow>>(
        `/api/admin/employee-monthly-hours?${query}`,
      );
      setSeniorityRows(result.items);
      setSeniorityTotal(result.totalItems);
      setSeniorityPages(result.totalPages);
      setFactories(result.factories);
    } catch (error) {
      setSeniorityRows([]);
      setSeniorityTotal(0);
      setSeniorityPages(1);
      setSeniorityError(error instanceof Error ? error.message : "Không tải được bảng thâm niên.");
    } finally {
      setSeniorityLoading(false);
    }
  }, [seniorityFilters, seniorityPage, user?.id]);

  useEffect(() => {
    void loadHours();
  }, [loadHours]);

  useEffect(() => {
    void loadSeniority();
  }, [loadSeniority]);

  if (authLoading) {
    return <main className="mx-auto w-full max-w-7xl px-4 py-8 text-sm text-muted-foreground">Đang tải...</main>;
  }
  if (user?.role !== "admin") {
    return <main className="mx-auto w-full max-w-7xl px-4 py-8 text-sm text-destructive">Bạn không có quyền xem bảng xếp hạng.</main>;
  }

  const applyHoursFilters = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setHoursPage(1);
    setHoursFilters(hoursDraft);
    setFiltersOpen(false);
  };
  const applySeniorityFilters = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSeniorityPage(1);
    setSeniorityFilters(seniorityDraft);
    setFiltersOpen(false);
  };

  return (
    <main className="mx-auto w-full max-w-[110rem] min-w-0 space-y-5 px-4 py-5 desktop:px-8 desktop:py-7">


      <Tabs value={tab} onValueChange={setTab} className="min-w-0 space-y-5">
        <TabsList aria-label="Loại xếp hạng" className="grid h-auto w-full max-w-md grid-cols-2">
          <TabsTrigger value="hours" className="min-h-10">Số giờ</TabsTrigger>
          <TabsTrigger value="seniority" className="min-h-10">Thâm niên</TabsTrigger>
        </TabsList>

        <TabsContent value="hours" className="mt-0 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <Button type="button" className="gap-2" onClick={() => setImportOpen(true)}>
                <Upload className="h-4 w-4" />
                Nhập Excel
              </Button>
              <Button
                type="button"
                variant="outline"
                className="gap-2"
                onClick={() => setFiltersOpen(true)}
              >
                <SlidersHorizontal className="h-4 w-4" />
                Bộ lọc
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Tải lại bảng xếp hạng giờ"
                title="Tải lại"
                onClick={() => void loadHours()}
              >
                <RefreshCw className={`h-4 w-4 ${hoursLoading ? "animate-spin" : ""}`} />
              </Button>
            </div>
            <span className="text-xs text-muted-foreground">
              {hoursTotal.toLocaleString("vi-VN")} kết quả
            </span>
          </div>

          {hoursError && <ErrorMessage message={hoursError} onRetry={() => void loadHours()} />}
          {!hoursError && hoursLoading && <LoadingRows />}
          {!hoursError && !hoursLoading && !hoursRows.length && <EmptyState message="Không có dữ liệu giờ trong khoảng đã chọn." />}
          {!hoursError && !hoursLoading && hoursRows.length > 0 && (
            <>
              <HoursDesktop rows={hoursRows} />
              <HoursMobile rows={hoursRows} />
              <Pager page={hoursPage} pages={hoursPages} total={hoursTotal} onChange={setHoursPage} />
            </>
          )}
        </TabsContent>

        <TabsContent value="seniority" className="mt-0 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className="gap-2"
                onClick={() => setFiltersOpen(true)}
              >
                <SlidersHorizontal className="h-4 w-4" />
                Bộ lọc
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Tải lại bảng thâm niên"
                title="Tải lại"
                onClick={() => void loadSeniority()}
              >
                <RefreshCw className={`h-4 w-4 ${seniorityLoading ? "animate-spin" : ""}`} />
              </Button>
            </div>
            <span className="text-xs text-muted-foreground">
              {seniorityTotal.toLocaleString("vi-VN")} kết quả đang làm
            </span>
          </div>

          {seniorityError && <ErrorMessage message={seniorityError} onRetry={() => void loadSeniority()} />}
          {!seniorityError && seniorityLoading && <LoadingRows />}
          {!seniorityError && !seniorityLoading && !seniorityRows.length && <EmptyState message="Không có NLĐ đang làm trong khoảng đã chọn." />}
          {!seniorityError && !seniorityLoading && seniorityRows.length > 0 && (
            <>
              <SeniorityDesktop rows={seniorityRows} />
              <SeniorityMobile rows={seniorityRows} />
              <Pager page={seniorityPage} pages={seniorityPages} total={seniorityTotal} onChange={setSeniorityPage} />
            </>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
        <DialogContent className="max-h-[90dvh] max-w-[calc(100vw-2rem)] overflow-hidden p-0 desktop:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{tab === "hours" ? "Lọc số giờ" : "Lọc thâm niên"}</DialogTitle>
            <DialogDescription>Chọn điều kiện rồi nhấn Lọc để cập nhật kết quả.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            {tab === "hours" ? (
              <form
                id="hours-filter-form"
                onSubmit={applyHoursFilters}
                className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
              >
                <Field label="Từ tháng" htmlFor={monthFromId}>
                  <MonthInput
                    id={monthFromId}
                    value={hoursDraft.monthFrom}
                    onChange={(monthFrom) => setHoursDraft((current) => ({ ...current, monthFrom }))}
                    required
                  />
                </Field>
                <Field label="Đến tháng" htmlFor={monthToId}>
                  <MonthInput
                    id={monthToId}
                    value={hoursDraft.monthTo}
                    onChange={(monthTo) => setHoursDraft((current) => ({ ...current, monthTo }))}
                    required
                  />
                </Field>
                <Field label="Nhà máy" htmlFor={factoryId}>
                  <select
                    id={factoryId}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={hoursDraft.factoryId}
                    onChange={(event) =>
                      setHoursDraft((current) => ({ ...current, factoryId: event.target.value }))
                    }
                  >
                    <option value="">Tất cả nhà máy</option>
                    {factories.map((factory) => (
                      <option key={factory.id} value={factory.id}>
                        {factory.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Trạng thái làm việc" htmlFor={statusId}>
                  <select
                    id={statusId}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={hoursDraft.status}
                    onChange={(event) =>
                      setHoursDraft((current) => ({
                        ...current,
                        status: event.target.value as EmploymentStatusFilter,
                      }))
                    }
                  >
                    <option value="all">Tất cả</option>
                    <option value="working">Đang làm</option>
                    <option value="left">Đã nghỉ</option>
                  </select>
                </Field>
                <Field label="Mã NV" htmlFor={codeId}>
                  <Input
                    id={codeId}
                    value={hoursDraft.employeeCode}
                    onChange={(event) =>
                      setHoursDraft((current) => ({ ...current, employeeCode: event.target.value }))
                    }
                    placeholder="Tìm theo mã NV"
                  />
                </Field>
                <Field label="Họ tên" htmlFor={nameId}>
                  <Input
                    id={nameId}
                    value={hoursDraft.workerName}
                    onChange={(event) =>
                      setHoursDraft((current) => ({ ...current, workerName: event.target.value }))
                    }
                    placeholder="Tìm theo họ tên"
                  />
                </Field>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Chỉ số xếp hạng</Label>
                  <MetricSwitch
                    value={hoursDraft.metric}
                    onChange={(metric) => setHoursDraft((current) => ({ ...current, metric }))}
                  />
                </div>
              </form>
            ) : (
              <form
                id="seniority-filter-form"
                onSubmit={applySeniorityFilters}
                className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
              >
                <Field label="Nhà máy" htmlFor={seniorityFactoryId}>
                  <select
                    id={seniorityFactoryId}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={seniorityDraft.factoryId}
                    onChange={(event) =>
                      setSeniorityDraft((current) => ({
                        ...current,
                        factoryId: event.target.value,
                      }))
                    }
                  >
                    <option value="">Tất cả nhà máy</option>
                    {factories.map((factory) => (
                      <option key={factory.id} value={factory.id}>
                        {factory.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Ngày vào làm từ" htmlFor={joinFromId}>
                  <Input
                    id={joinFromId}
                    type="date"
                    value={seniorityDraft.joinDateFrom}
                    onChange={(event) =>
                      setSeniorityDraft((current) => ({
                        ...current,
                        joinDateFrom: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="Ngày vào làm đến" htmlFor={joinToId}>
                  <Input
                    id={joinToId}
                    type="date"
                    value={seniorityDraft.joinDateTo}
                    onChange={(event) =>
                      setSeniorityDraft((current) => ({
                        ...current,
                        joinDateTo: event.target.value,
                      }))
                    }
                  />
                </Field>
              </form>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setFiltersOpen(false)}>
              Đóng
            </Button>
            <Button
              type="submit"
              form={tab === "hours" ? "hours-filter-form" : "seniority-filter-form"}
              className="gap-2"
            >
              <Search className="h-4 w-4" />
              Lọc
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EmployeeMonthlyHoursImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => void loadHours()}
      />
    </main>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return <div className="min-w-0 space-y-1.5"><Label htmlFor={htmlFor}>{label}</Label>{children}</div>;
}

function HoursDesktop({ rows }: { rows: HourRankingRow[] }) {
  return (
    <div className="hidden overflow-x-auto rounded-lg border md:block">
      <table className="w-full min-w-[900px] border-collapse text-sm">
        <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
          <tr>{["Hạng", "UID lịch sử", "Mã NV", "Họ tên", "Nhà máy", "Trạng thái làm việc", "Giờ HC", "Giờ TC", "Tổng giờ"].map((heading) => <th key={heading} className="px-3 py-2.5 font-medium">{heading}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.historyId} className="border-t border-border/70">
              <td className="px-3 py-2.5 font-semibold tabular-nums">{row.rank}</td>
              <td className="px-3 py-2.5 font-mono text-xs">{row.historyUid}</td>
              <td className="px-3 py-2.5">{row.employeeCode || "—"}</td>
              <td className="max-w-64 px-3 py-2.5 font-medium">{row.workerName || "—"}</td>
              <td className="max-w-56 px-3 py-2.5">{row.factoryName || "—"}</td>
              <td className="px-3 py-2.5"><StatusLabel status={row.status} /></td>
              <td className="px-3 py-2.5 text-right tabular-nums">{formatHours(row.regularHours)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{formatHours(row.overtimeHours)}</td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{formatHours(row.totalHours)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HoursMobile({ rows }: { rows: HourRankingRow[] }) {
  return (
    <div className="space-y-2 md:hidden">
      {rows.map((row) => (
        <article key={row.historyId} className="min-w-0 rounded-lg border bg-card p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="break-words text-sm font-semibold">{row.workerName || "Chưa có họ tên"}</div>
              <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                <span>{row.employeeCode || "Chưa có mã NV"}</span><span>{row.historyUid}</span>
              </div>
            </div>
            <div className="shrink-0 text-right"><div className="text-xs text-muted-foreground">Hạng</div><div className="text-lg font-bold tabular-nums">{row.rank}</div></div>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="min-w-0 break-words text-muted-foreground">{row.factoryName || "Chưa rõ nhà máy"}</span>
            <StatusLabel status={row.status} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 border-t pt-2 text-xs">
            <HourValue label="HC" value={row.regularHours} />
            <HourValue label="TC" value={row.overtimeHours} />
            <HourValue label="Tổng" value={row.totalHours} strong />
          </div>
        </article>
      ))}
    </div>
  );
}

function HourValue({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return <div className="min-w-0"><div className="text-muted-foreground">{label}</div><div className={`mt-0.5 truncate tabular-nums ${strong ? "font-semibold text-foreground" : "font-medium"}`}>{formatHours(value)}</div></div>;
}

function SeniorityDesktop({ rows }: { rows: SeniorityRankingRow[] }) {
  return (
    <div className="hidden overflow-x-auto rounded-lg border md:block">
      <table className="w-full min-w-[760px] border-collapse text-sm">
        <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
          <tr>{["Hạng", "UID lịch sử", "Mã NV", "Họ tên", "Nhà máy", "Ngày vào làm", "Thâm niên tích lũy"].map((heading) => <th key={heading} className="px-3 py-2.5 font-medium">{heading}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.historyId} className="border-t border-border/70">
              <td className="px-3 py-2.5 font-semibold tabular-nums">{row.rank}</td>
              <td className="px-3 py-2.5 font-mono text-xs">{row.historyUid}</td>
              <td className="px-3 py-2.5">{row.employeeCode || "—"}</td>
              <td className="px-3 py-2.5 font-medium">{row.workerName || "—"}</td>
              <td className="px-3 py-2.5">{row.factoryName || "—"}</td>
              <td className="px-3 py-2.5 tabular-nums">{formatDate(row.joinDate)}</td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{row.seniorityDays.toLocaleString("vi-VN")} ngày</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SeniorityMobile({ rows }: { rows: SeniorityRankingRow[] }) {
  return (
    <div className="space-y-2 md:hidden">
      {rows.map((row) => (
        <article key={row.historyId} className="min-w-0 rounded-lg border bg-card p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="break-words text-sm font-semibold">{row.workerName || "Chưa có họ tên"}</div>
              <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted-foreground"><span>{row.employeeCode || "Chưa có mã NV"}</span><span>{row.historyUid}</span></div>
            </div>
            <div className="shrink-0 text-right"><div className="text-xs text-muted-foreground">Hạng</div><div className="text-lg font-bold tabular-nums">{row.rank}</div></div>
          </div>
          <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground"><span className="min-w-0 break-words">{row.factoryName || "Chưa rõ nhà máy"}</span><span>Vào làm {formatDate(row.joinDate)}</span></div>
          <div className="mt-3 border-t pt-2 text-sm font-semibold tabular-nums">{row.seniorityDays.toLocaleString("vi-VN")} ngày tích lũy</div>
        </article>
      ))}
    </div>
  );
}

function Pager({ page, pages, total, onChange }: { page: number; pages: number; total: number; onChange: (page: number) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
      <span>{total.toLocaleString("vi-VN")} kết quả · Trang {page}/{pages}</span>
      <div className="flex items-center gap-2">
        <Button type="button" size="icon" variant="outline" aria-label="Trang trước" disabled={page <= 1} onClick={() => onChange(page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
        <Button type="button" size="icon" variant="outline" aria-label="Trang sau" disabled={page >= pages} onClick={() => onChange(page + 1)}><ChevronRight className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}

function LoadingRows() {
  return <div className="space-y-2" aria-label="Đang tải dữ liệu">{[0, 1, 2].map((item) => <div key={item} className="h-14 animate-pulse rounded-md bg-muted/60" />)}</div>;
}

function EmptyState({ message }: { message: string }) {
  return <div className="flex min-h-36 items-center justify-center rounded-lg border border-dashed px-4 text-center text-sm text-muted-foreground">{message}</div>;
}

function ErrorMessage({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"><span className="min-w-0 break-words">{message}</span><Button type="button" variant="outline" size="sm" className="gap-2" onClick={onRetry}><RefreshCw className="h-4 w-4" />Thử lại</Button></div>;
}

function downloadTemplate() {
  const sheet = XLSX.utils.aoa_to_sheet([IMPORT_HEADERS]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Gio lam NLĐ");
  XLSX.writeFile(workbook, "mau_nhap_gio_lam_NLD.xlsx");
}

function EmployeeMonthlyHoursImportDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}) {
  const fileInputId = useId();
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<EmployeeMonthlyHoursImportRow[]>([]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errors, setErrors] = useState<Array<{ rowNumber: number; reason: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reset = () => {
    setFileName("");
    setRows([]);
    setPreview(null);
    setResult(null);
    setErrors([]);
    setBusy(false);
    setError("");
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (busy) return;
    onOpenChange(nextOpen);
    if (!nextOpen) reset();
  };

  const previewFile = async (file?: File) => {
    if (!file) return;
    setFileName(file.name);
    setPreview(null);
    setResult(null);
    setErrors([]);
    setError("");
    setBusy(true);
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!firstSheet) throw new Error("File Excel không có trang tính dữ liệu.");
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, {
        defval: "",
        raw: true,
      });
      const parsed = parseEmployeeMonthlyHoursImport(rawRows);
      setErrors(parsed.errors);
      setRows(parsed.rows);
      if (!parsed.rows.length) return;
      const serverPreview = await requestEmployeeHours<ImportPreview>(
        "/api/admin/employee-monthly-hours",
        {
          method: "POST",
          body: JSON.stringify({ action: "preview", rows: parsed.rows }),
        },
      );
      setPreview(serverPreview);
      setErrors([...parsed.errors, ...serverPreview.errors]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không đọc được file Excel.");
    } finally {
      setBusy(false);
    }
  };

  const commitImport = async () => {
    if (!rows.length || !preview || (!preview.created && !preview.updated)) return;
    setBusy(true);
    setError("");
    try {
      const saved = await requestEmployeeHours<ImportResult>(
        "/api/admin/employee-monthly-hours",
        {
          method: "POST",
          body: JSON.stringify({ action: "commit", rows }),
        },
      );
      setResult(saved);
      setErrors(saved.errors);
      setPreview(null);
      onImported();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể nhập số giờ.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-[calc(100vw-2rem)] overflow-hidden p-0 desktop:max-w-2xl" onEscapeKeyDown={(event) => busy && event.preventDefault()} onInteractOutside={(event) => busy && event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Nhập số giờ làm việc</DialogTitle>
          <DialogDescription>{fileName || "Chọn file Excel để kiểm tra dữ liệu trước khi nhập."}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {!result && (
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <div className="space-y-1.5">
                <Label htmlFor={fileInputId}>File Excel</Label>
                <Input id={fileInputId} type="file" accept=".xlsx,.xls" disabled={busy} onChange={(event) => void previewFile(event.target.files?.[0])} />
              </div>
              <Button type="button" variant="outline" className="gap-2" disabled={busy} onClick={downloadTemplate}>
                <Download className="h-4 w-4" />Tải file mẫu
              </Button>
            </div>
          )}
          {busy && <div className="flex items-center gap-2 text-sm text-muted-foreground"><RefreshCw className="h-4 w-4 animate-spin" />{preview ? "Đang ghi dữ liệu..." : "Đang kiểm tra file..."}</div>}
          {error && <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
          {preview && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <ImportStat label="Tạo mới" value={preview.created} />
                <ImportStat label="Cập nhật" value={preview.updated} />
                <ImportStat label="Lỗi" value={errors.length} />
              </div>
              <div className="max-h-36 overflow-y-auto rounded-md border text-sm">
                {preview.rows.map((row) => <div key={`${row.rowNumber}-${row.action}`} className="flex justify-between gap-3 border-b px-3 py-2 last:border-0"><span>Dòng {row.rowNumber}</span><span className="font-medium">{row.action === "update" ? "Sẽ cập nhật" : "Sẽ tạo mới"}</span></div>)}
              </div>
            </div>
          )}
          {result && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <ImportStat label="Đã tạo" value={result.created} />
                <ImportStat label="Đã cập nhật" value={result.updated} />
                <ImportStat label="Lỗi" value={result.failed} />
              </div>
              <p className="text-sm">Đã xử lý file {fileName}.</p>
            </div>
          )}
          {errors.length > 0 && (
            <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border border-amber-300/60 bg-amber-50 p-3 text-xs text-amber-950">
              {errors.slice(0, 30).map((item, index) => <div key={`${item.rowNumber}-${index}`}><strong>Dòng {item.rowNumber}:</strong> {item.reason}</div>)}
              {errors.length > 30 && <div>Còn {errors.length - 30} lỗi khác.</div>}
            </div>
          )}
          {!busy && !preview && !result && !errors.length && !error && (
            <div className="flex items-start gap-2 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
              <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0" />
              <span>File cần có các cột UID lịch sử, Họ tên, Tên nhà máy, Tháng, Số giờ HC và Số giờ TC. Mã NV là tùy chọn.</span>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => handleOpenChange(false)}>{result ? "Đóng" : "Hủy"}</Button>
          {preview && !result && (
            <Button type="button" disabled={busy || (!preview.created && !preview.updated)} onClick={() => void commitImport()}>
              {busy ? "Đang nhập..." : `Nhập ${preview.created + preview.updated} dòng`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportStat({ label, value }: { label: string; value: number }) {
  return <div className="min-w-0 rounded-md border bg-background p-2"><div className="truncate text-muted-foreground">{label}</div><div className="mt-1 text-base font-semibold tabular-nums">{value.toLocaleString("vi-VN")}</div></div>;
}
