import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Banknote,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileSpreadsheet,
  Filter,
  Loader2,
  Plus,
  QrCode,
  Search,
  X,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataLoadingState } from "@/components/ui/data-loading-state";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusChip } from "@/components/ui/status-chip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/lib/auth";
import { useDebouncedSearch } from "@/hooks/use-debounced-search";
import { pb, type UserRecord } from "@/lib/pocketbase";
import {
  fetchCachedStaffWorkspace,
  fetchStaffWorkspace,
  type StaffWorkerRecord,
} from "@/lib/staff-permissions";
import { useStaffCacheSignal } from "@/lib/use-staff-cache-signal";
import { SalaryHoldCreateDialog } from "@/components/staff/SalaryHoldCreateDialog";
import {
  SALARY_HOLD_STATUS,
  buildSalaryHoldTransferDescription,
  removeVietnameseTone,
  type SalaryHoldRecord,
  type SalaryHoldStatus,
} from "@/lib/salary-holds";
import { createStaffActionLog } from "@/lib/staff-log";
import { buildVietQrUrl } from "@/lib/vn-banks";
import { fetchFactories, type FactoryRecord } from "@/lib/factories";
import { exportToExcel } from "@/lib/excel";
import { companyFilter } from "@/lib/tenant";

export const Route = createFileRoute("/_authenticated/staff/salary-holds")({
  component: SalaryHoldsPage,
});
const QR_TEMPLATE_KEY = "jobconnect.salaryHoldTransferDescriptionTemplate";
const DEFAULT_QR_TEMPLATE = "Giải ngân giữ lương + tên";
type Tab = SalaryHoldStatus | "all";
type RejectRequest = { mode: "single"; row: SalaryHoldRecord } | { mode: "bulk"; count: number };

function formatHistoryDate(value?: string, fallback = "Chưa có") {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("vi-VN");
}

function SalaryHoldsPage() {
  const { user, isAdmin } = useAuth();
  const viewer = user as UserRecord;
  const [rows, setRows] = useState<SalaryHoldRecord[]>([]);
  const [workers, setWorkers] = useState<StaffWorkerRecord[]>([]);
  const [factories, setFactories] = useState<FactoryRecord[]>([]);
  const [tab, setTab] = useState<Tab>(isAdmin ? "received" : "received");
  const [search, setSearch] = useState("");
  const [factoryIds, setFactoryIds] = useState<Set<string>>(new Set());
  const [factorySearch, setFactorySearch] = useState("");
  const debouncedSearch = useDebouncedSearch(search);
  const debouncedFactorySearch = useDebouncedSearch(factorySearch);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<SalaryHoldRecord | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedWorkerId, setSelectedWorkerId] = useState("");
  const [workerSearch, setWorkerSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [rejectRequest, setRejectRequest] = useState<RejectRequest | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [qrTemplate, setQrTemplate] = useState(DEFAULT_QR_TEMPLATE);

  const load = useCallback(
    async (showLoading = true) => {
      if (!viewer?.id) return;
      if (showLoading) setLoading(true);
      try {
        const filter = [companyFilter(viewer), !isAdmin ? `staff="${viewer.id}"` : ""]
          .filter(Boolean)
          .join(" && ");
        const result = await pb.collection("salary_holds").getList<SalaryHoldRecord>(1, 500, {
          filter,
          sort: "-created",
          expand: "worker,staff,employment_history",
        });
        setRows(result.items);
        setDetail((current) =>
          current ? result.items.find((item) => item.id === current.id) || null : null,
        );
        setSelectedIds((current) => {
          const availableIds = new Set(result.items.map((item) => item.id));
          const next = new Set([...current].filter((id) => availableIds.has(id)));
          return next.size === current.size ? current : next;
        });
      } catch (error: any) {
        toast.error(error?.message || "Không tải được danh sách giữ lương");
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [isAdmin, viewer?.id],
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!viewer?.id) return;

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const filter = [companyFilter(viewer), !isAdmin ? `staff="${viewer.id}"` : ""]
      .filter(Boolean)
      .join(" && ");

    void pb
      .collection("salary_holds")
      .subscribe(
        "*",
        () => {
          if (refreshTimer) clearTimeout(refreshTimer);
          refreshTimer = setTimeout(() => void load(false), 150);
        },
        { filter },
      )
      .then((stop) => {
        if (cancelled) void stop();
        else unsubscribe = stop;
      })
      .catch((error) => {
        if (!cancelled) console.warn("[salary-holds] realtime subscription failed", error);
      });

    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      if (unsubscribe) void unsubscribe();
    };
  }, [isAdmin, load, viewer?.id]);
  useEffect(() => {
    try {
      setQrTemplate(localStorage.getItem(QR_TEMPLATE_KEY) || DEFAULT_QR_TEMPLATE);
    } catch {}
    if (isAdmin)
      fetchFactories(viewer)
        .then(setFactories)
        .catch(() => {});
    else
      fetchStaffWorkspace(viewer)
        .then((workspace) =>
          setWorkers(
            workspace.workers.filter(
              (worker) => worker.latestHistory?.recruiter_staff === viewer.id,
            ),
          ),
        )
        .catch(() => {});
  }, [isAdmin, viewer?.id]);

  const cacheSignal = useStaffCacheSignal();
  useEffect(() => {
    if (!viewer?.id || cacheSignal === 0 || isAdmin) return;
    const timer = setTimeout(async () => {
      const ws = await fetchCachedStaffWorkspace(viewer);
      if (ws)
        setWorkers(
          ws.workers.filter((worker) => worker.latestHistory?.recruiter_staff === viewer.id),
        );
    }, 150);
    return () => clearTimeout(timer);
  }, [cacheSignal, isAdmin, viewer?.id]);

  const filtered = useMemo(
    () =>
      rows.filter((row) => {
        if (tab !== "all" && row.status !== tab) return false;
        if (
          debouncedSearch.trim() &&
          !row.worker_name
            .toLocaleLowerCase("vi")
            .includes(debouncedSearch.trim().toLocaleLowerCase("vi"))
        )
          return false;
        if (factoryIds.size && !factoryIds.has(row.factory)) return false;
        return true;
      }),
    [debouncedSearch, factoryIds, rows, tab],
  );
  const filteredWorkers = useMemo(() => {
    const keyword = removeVietnameseTone(workerSearch.trim().toLocaleLowerCase("vi"));
    if (!keyword) return workers;
    return workers.filter((worker) => {
      const history = worker.latestHistory;
      const haystack = removeVietnameseTone(
        [
          history?.worker_name_snapshot,
          worker.user.full_name,
          worker.user.username,
          worker.user.phone,
          history?.employee_code,
          history?.expand?.factory?.name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase("vi"),
      );
      return haystack.includes(keyword);
    });
  }, [workerSearch, workers]);
  const selectedWorker = workers.find((worker) => worker.user.id === selectedWorkerId) || null;
  const receivedRows = filtered.filter((row) => row.status === "received");
  const approvedRows = filtered.filter((row) => row.status === "approved");
  const selectableRows = isAdmin
    ? tab === "received"
      ? receivedRows
      : tab === "approved"
        ? approvedRows
        : []
    : [];
  const selectedCount = selectableRows.filter((row) => selectedIds.has(row.id)).length;

  const exportSalaryHolds = () => {
    if (!filtered.length) {
      toast.info("Không có dữ liệu giữ lương để xuất");
      return;
    }

    const now = new Date();
    const fileDate = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("-");
    const sheetName = "Giữ lương";
    const exportRows = filtered.map((row, index) => ({
      STT: index + 1,
      "Mã NV": row.employee_code || "",
      "Họ tên": row.worker_name || "",
      "Nhà máy": row.company_name || "",
      "Ngày vào": row.expand?.employment_history?.join_date || "",
      "Ngày nghỉ": row.expand?.employment_history?.leave_date || "",
      "Số tiền": Number(row.amount) || 0,
      "Trạng thái": SALARY_HOLD_STATUS[row.status].label,
      "Nội dung": row.content || "",
      "Staff báo giữ": row.expand?.staff?.full_name || row.expand?.staff?.username || "",
      "Ngân hàng nhận": row.staff_bank_name || "",
      "Số tài khoản": row.staff_bank_account_number || "",
      "Chủ tài khoản": row.staff_bank_account_name || "",
      "Ngày tạo": row.created || "",
      "Ngày duyệt": row.approved_at || "",
      "Ngày từ chối": row.rejected_at || "",
      "Lý do từ chối": row.rejection_reason || "",
      "Ngày giải ngân": row.disbursed_at || "",
      "Ngày hủy": row.cancelled_at || "",
    }));

    try {
      exportToExcel(
        `danh-sach-giu-luong-${fileDate}.xlsx`,
        { [sheetName]: exportRows },
        {
          [sheetName]: [
            "Ngày vào",
            "Ngày nghỉ",
            "Ngày tạo",
            "Ngày duyệt",
            "Ngày từ chối",
            "Ngày giải ngân",
            "Ngày hủy",
          ],
        },
      );
      toast.success(`Đã xuất ${filtered.length} yêu cầu giữ lương`);
    } catch {
      toast.error("Không thể xuất file Excel");
    }
  };

  useEffect(() => {
    setSelectedIds(new Set());
  }, [debouncedSearch, factoryIds, tab]);

  const updateStatus = async (
    row: SalaryHoldRecord,
    status: SalaryHoldStatus,
    closeDetail = true,
    rejectionReason = "",
  ): Promise<boolean> => {
    if (status === "cancelled" && (row.status !== "received" || row.staff !== viewer.id)) {
      toast.error("Không thể hủy yêu cầu này");
      return false;
    }
    if (["approved", "rejected"].includes(status) && (!isAdmin || row.status !== "received")) {
      toast.error("Yêu cầu không còn ở trạng thái tiếp nhận");
      return false;
    }
    if (status === "rejected" && !rejectionReason.trim()) {
      toast.error("Vui lòng nhập lý do từ chối");
      return false;
    }
    if (status === "disbursed" && (!isAdmin || row.status !== "approved")) {
      toast.error("Chỉ giải ngân yêu cầu đã duyệt");
      return false;
    }

    const now = new Date().toISOString();
    const payload: Partial<SalaryHoldRecord> = { status };
    if (status === "approved") Object.assign(payload, { approved_by: viewer.id, approved_at: now });
    if (status === "rejected") {
      Object.assign(payload, {
        rejected_by: viewer.id,
        rejected_at: now,
        rejection_reason: rejectionReason.trim(),
      });
    }
    if (status === "disbursed")
      Object.assign(payload, { disbursed_by: viewer.id, disbursed_at: now });
    if (status === "cancelled") Object.assign(payload, { cancelled_at: now });

    try {
      await pb.collection("salary_holds").update(row.id, payload);
    } catch (error: any) {
      toast.error(error?.message || "Không thể cập nhật yêu cầu. Vui lòng thử lại.");
      return false;
    }

    try {
      await createStaffActionLog({
        actor: viewer,
        targetUserId: row.worker,
        targetCollection: "salary_holds",
        targetRecord: row.id,
        action: "update",
        before: { status: row.status },
        after: payload,
        note: `Chuyển trạng thái giữ lương sang ${status}`,
      });
    } catch {
      toast.warning("Đã cập nhật yêu cầu nhưng chưa ghi được nhật ký thao tác");
    }

    toast.success(status === "disbursed" ? "Đã đánh dấu giải ngân" : "Đã cập nhật yêu cầu");
    if (closeDetail) setDetail(null);
    await load();
    return true;
  };

  const bulkUpdateStatus = async (
    sourceStatus: "received" | "approved",
    status: "approved" | "rejected" | "disbursed",
    rejectionReason = "",
  ): Promise<boolean> => {
    const targets = filtered.filter(
      (row) => row.status === sourceStatus && selectedIds.has(row.id),
    );
    if (!targets.length || bulkProcessing) return false;
    if (status === "rejected" && !rejectionReason.trim()) {
      toast.error("Vui lòng nhập lý do từ chối");
      return false;
    }

    setBulkProcessing(true);
    const failedIds = new Set<string>();
    let successCount = 0;

    for (const row of targets) {
      const now = new Date().toISOString();
      const payload: Partial<SalaryHoldRecord> = { status };
      if (status === "approved") {
        Object.assign(payload, { approved_by: viewer.id, approved_at: now });
      }
      if (status === "rejected") {
        Object.assign(payload, {
          rejected_by: viewer.id,
          rejected_at: now,
          rejection_reason: rejectionReason.trim(),
        });
      }
      if (status === "disbursed") {
        Object.assign(payload, { disbursed_by: viewer.id, disbursed_at: now });
      }

      try {
        await pb.collection("salary_holds").update(row.id, payload);
        await createStaffActionLog({
          actor: viewer,
          targetUserId: row.worker,
          targetCollection: "salary_holds",
          targetRecord: row.id,
          action: "update",
          before: { status: row.status },
          after: payload,
          note:
            status === "approved"
              ? "Admin duyệt yêu cầu giữ lương hàng loạt"
              : status === "rejected"
                ? "Admin từ chối yêu cầu giữ lương hàng loạt"
                : "Admin xác nhận giải ngân giữ lương hàng loạt",
        });
        successCount += 1;
      } catch {
        failedIds.add(row.id);
      }
    }

    setSelectedIds(failedIds);
    await load();
    setBulkProcessing(false);

    const actionLabel =
      status === "approved" ? "duyệt" : status === "rejected" ? "từ chối" : "giải ngân";
    if (!failedIds.size) {
      toast.success(`Đã ${actionLabel} ${successCount} yêu cầu`);
    } else {
      toast.warning(
        `Đã ${actionLabel} ${successCount}/${targets.length} yêu cầu. Còn ${failedIds.size} yêu cầu chưa xử lý được.`,
      );
    }
    return successCount > 0;
  };

  const requestSingleReject = (row: SalaryHoldRecord) => {
    setRejectReason("");
    setRejectRequest({ mode: "single", row });
  };

  const requestBulkReject = () => {
    if (!selectedCount) return;
    setRejectReason("");
    setRejectRequest({ mode: "bulk", count: selectedCount });
  };

  const confirmReject = async () => {
    if (!rejectRequest || rejecting) return;
    const reason = rejectReason.trim();
    if (!reason) {
      toast.error("Vui lòng nhập lý do từ chối");
      return;
    }

    setRejecting(true);
    try {
      const succeeded =
        rejectRequest.mode === "single"
          ? await updateStatus(rejectRequest.row, "rejected", true, reason)
          : await bulkUpdateStatus("received", "rejected", reason);
      if (succeeded) {
        setRejectRequest(null);
        setRejectReason("");
      }
    } finally {
      setRejecting(false);
    }
  };

  const counts = useMemo(
    () =>
      rows.reduce<Record<SalaryHoldStatus, number>>(
        (a, r) => ({ ...a, [r.status]: a[r.status] + 1 }),
        { received: 0, approved: 0, disbursed: 0, rejected: 0, cancelled: 0 },
      ),
    [rows],
  );
  const tabs: Array<[Tab, string]> = isAdmin
    ? [
        ["received", "Tiếp nhận"],
        ["approved", "Đã duyệt"],
        ["disbursed", "Đã giải ngân"],
        ["rejected", "Từ chối"],
        ["cancelled", "Đã hủy"],
        ["all", "Tất cả"],
      ]
    : [
        ["received", "Đã tạo"],
        ["approved", "Đã duyệt"],
        ["disbursed", "Đã giải ngân"],
        ["rejected", "Từ chối"],
        ["cancelled", "Đã hủy"],
      ];

  return (
    <PageContainer
      title="Giữ lương"
      subtitle={
        isAdmin ? "Tiếp nhận và giải ngân yêu cầu của Staff" : "Tạo và theo dõi yêu cầu giữ lương"
      }
      right={
        !isAdmin ? (
          <Button size="sm" className="rounded-full px-3" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            Tạo mới
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-2 desktop:flex-row desktop:items-center">
        <div className="order-2 flex gap-2 overflow-x-auto pb-1 desktop:order-1 desktop:min-w-0 desktop:flex-1">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              onClick={() => {
                setTab(key);
                setSelectedIds(new Set());
              }}
              className={`shrink-0 rounded-full px-3 py-2 text-xs font-medium ${tab === key ? "bg-primary text-primary-foreground" : "border bg-card"}`}
            >
              {label}
              {key !== "all" ? ` (${counts[key]})` : ""}
            </button>
          ))}
        </div>
        <div className="order-1 flex items-center gap-2 desktop:order-2 desktop:ml-auto desktop:w-[30rem]">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo họ tên NLĐ"
            className="flex-1"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-9 shrink-0 px-3"
            disabled={!filtered.length}
            onClick={exportSalaryHolds}
            aria-label="Xuất danh sách giữ lương ra Excel"
            title="Xuất Excel"
          >
            <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
            <span className="hidden desktop:inline">Xuất Excel</span>
          </Button>
          {isAdmin && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition ${factoryIds.size ? "border-primary bg-primary/10 text-primary" : "bg-card text-muted-foreground"}`}
                  aria-label="Lọc công ty"
                >
                  <Filter className="h-4 w-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 rounded-xl p-3">
                <div className="mb-2 text-sm font-medium">
                  Lọc công ty {factoryIds.size ? `(${factoryIds.size})` : ""}
                </div>
                <Input
                  placeholder="Tìm công ty..."
                  onChange={(e) => setFactorySearch(e.target.value)}
                  value={factorySearch}
                  className="mb-2 h-8 text-sm"
                />
                <div className="max-h-60 space-y-2 overflow-y-auto">
                  {factories
                    .filter(
                      (f) =>
                        !debouncedFactorySearch.trim() ||
                        f.name
                          .toLocaleLowerCase("vi")
                          .includes(debouncedFactorySearch.trim().toLocaleLowerCase("vi")),
                    )
                    .map((factory) => (
                      <label key={factory.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={factoryIds.has(factory.id)}
                          onCheckedChange={(checked) =>
                            setFactoryIds((old) => {
                              const next = new Set(old);
                              if (checked) next.add(factory.id);
                              else next.delete(factory.id);
                              return next;
                            })
                          }
                        />
                        {factory.name}
                      </label>
                    ))}
                </div>
                {factoryIds.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setFactoryIds(new Set())}
                    className="mt-2 w-full rounded-lg border py-1.5 text-xs text-muted-foreground transition hover:bg-muted"
                  >
                    Bỏ lọc
                  </button>
                )}
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>
      {isAdmin && selectableRows.length > 0 && (
        <div className="sticky top-[var(--header-h,3.25rem)] z-20 flex flex-col gap-2 rounded-xl border bg-background/95 p-2 shadow-sm backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={
                selectedCount === selectableRows.length
                  ? true
                  : selectedCount > 0
                    ? "indeterminate"
                    : false
              }
              disabled={bulkProcessing}
              onCheckedChange={(checked) =>
                setSelectedIds(checked ? new Set(selectableRows.map((row) => row.id)) : new Set())
              }
            />
            Chọn tất cả ({selectableRows.length})
          </label>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="mr-auto text-xs font-medium text-primary sm:mr-0">
              {selectedCount} đã chọn
            </span>
            {tab === "received" && (
              <>
                <Button
                  size="sm"
                  disabled={!selectedCount || bulkProcessing}
                  onClick={() => void bulkUpdateStatus("received", "approved")}
                >
                  <Check className="mr-1 h-4 w-4" />
                  Duyệt ({selectedCount})
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={!selectedCount || bulkProcessing}
                  onClick={requestBulkReject}
                >
                  <X className="mr-1 h-4 w-4" />
                  Từ chối ({selectedCount})
                </Button>
              </>
            )}
            {tab === "approved" && (
              <Button
                size="sm"
                disabled={!selectedCount || bulkProcessing}
                onClick={() => void bulkUpdateStatus("approved", "disbursed")}
              >
                <Banknote className="mr-1 h-4 w-4" />
                Xác nhận đã giải ngân ({selectedCount})
              </Button>
            )}
          </div>
        </div>
      )}
      <div className="space-y-2">
        {loading && rows.length === 0 ? (
          <DataLoadingState variant="list" label="Đang tải danh sách giữ lương..." rows={3} />
        ) : (
          <>
            {loading && (
              <DataLoadingState variant="inline" label="Đang cập nhật danh sách giữ lương..." />
            )}
            {filtered.map((row) => {
              const selectable =
                isAdmin &&
                ((tab === "received" && row.status === "received") ||
                  (tab === "approved" && row.status === "approved"));
              return (
                <Card
                  key={row.id}
                  onClick={() => setDetail(row)}
                  className="cursor-pointer p-3 shadow-soft"
                >
                  <div className="flex items-start gap-3">
                    {selectable && (
                      <Checkbox
                        checked={selectedIds.has(row.id)}
                        disabled={bulkProcessing}
                        className="mt-0.5 shrink-0 desktop:mt-1"
                        onClick={(e) => e.stopPropagation()}
                        onCheckedChange={(checked) =>
                          setSelectedIds((old) => {
                            const next = new Set(old);
                            if (checked) next.add(row.id);
                            else next.delete(row.id);
                            return next;
                          })
                        }
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="space-y-2 desktop:grid desktop:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_auto_auto] desktop:items-center desktop:gap-4 desktop:space-y-0">
                        <div className="min-w-0">
                          <div className="truncate font-semibold">{row.worker_name}</div>
                          <div className="text-xs text-muted-foreground">
                            Mã NLĐ: {row.employee_code || "—"}
                          </div>
                        </div>
                        <div className="min-w-0 text-sm text-muted-foreground">
                          <div className="truncate">{row.company_name || "Chưa có nhà máy"}</div>
                          <div className="text-xs">
                            Vào {formatHistoryDate(row.expand?.employment_history?.join_date)} ·
                            Nghỉ{" "}
                            {formatHistoryDate(
                              row.expand?.employment_history?.leave_date,
                              "Chưa nghỉ",
                            )}
                          </div>
                        </div>
                        <div className="text-lg font-bold text-primary desktop:whitespace-nowrap">
                          {Number(row.amount).toLocaleString("vi-VN")} đ
                        </div>
                        <div className="desktop:justify-self-end">
                          <StatusChip tone={SALARY_HOLD_STATUS[row.status].tone}>
                            {SALARY_HOLD_STATUS[row.status].label}
                          </StatusChip>
                        </div>
                      </div>
                      <div className="mt-2 border-t border-border/60 pt-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">Nội dung: </span>
                        <span className="line-clamp-2">{row.content}</span>
                      </div>
                      {row.status === "rejected" && row.rejection_reason && (
                        <div className="mt-2 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                          <span className="font-semibold">Lý do từ chối: </span>
                          <span className="whitespace-pre-wrap break-words">
                            {row.rejection_reason}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </>
        )}
      </div>

      {!isAdmin && (
        <Dialog
          open={createOpen && !selectedWorker}
          onOpenChange={(open) => {
            setCreateOpen(open);
            if (!open) setWorkerSearch("");
          }}
        >
          <DialogContent className="rounded-2xl">
            <DialogHeader>
              <DialogTitle>Chọn NLĐ</DialogTitle>
              <DialogDescription>
                Chỉ hiển thị NLĐ có lịch sử gần nhất do bạn tuyển.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={workerSearch}
                  onChange={(event) => setWorkerSearch(event.target.value)}
                  placeholder="Tìm tên, mã NLĐ, SĐT, nhà máy..."
                  className="bg-white pl-9 pr-10 text-slate-900 placeholder:text-slate-400"
                  autoFocus
                />
                {workerSearch && (
                  <button
                    type="button"
                    onClick={() => setWorkerSearch("")}
                    className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
                    aria-label="Xóa nội dung tìm kiếm"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div className="max-h-72 space-y-2 overflow-y-auto rounded-xl border bg-white p-2">
                {filteredWorkers.length > 0 ? (
                  filteredWorkers.map((worker) => (
                    <button
                      key={worker.user.id}
                      type="button"
                      onClick={() => {
                        setSelectedWorkerId(worker.user.id);
                        setWorkerSearch("");
                      }}
                      className="w-full rounded-xl border bg-white p-3 text-left text-slate-900 transition hover:bg-slate-50"
                    >
                      <div className="font-medium">
                        {worker.latestHistory?.worker_name_snapshot ||
                          worker.user.full_name ||
                          worker.user.username ||
                          "Chưa có tên"}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        {[
                          worker.latestHistory?.employee_code
                            ? `Mã NLĐ: ${worker.latestHistory.employee_code}`
                            : "",
                          worker.latestHistory?.expand?.factory?.name || "Chưa có lịch sử đi làm",
                          worker.user.phone || "",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="py-8 text-center text-sm text-slate-500">
                    Không tìm thấy NLĐ phù hợp
                  </div>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {!isAdmin && selectedWorker && (
        <SalaryHoldCreateDialog
          open={createOpen}
          onOpenChange={(open) => {
            setCreateOpen(open);
            if (!open) setSelectedWorkerId("");
          }}
          viewer={viewer}
          worker={selectedWorker.user}
          history={selectedWorker.latestHistory}
          onCreated={load}
        />
      )}
      {detail && (
        <SalaryHoldDetailDialog
          row={detail}
          items={filtered}
          onSelectRow={setDetail}
          onClose={() => setDetail(null)}
          isAdmin={isAdmin}
          viewer={viewer}
          qrTemplate={qrTemplate}
          setQrTemplate={(value) => {
            setQrTemplate(value);
            try {
              localStorage.setItem(QR_TEMPLATE_KEY, value);
            } catch {}
          }}
          onStatus={updateStatus}
          onReject={requestSingleReject}
        />
      )}
      <Dialog
        open={!!rejectRequest}
        onOpenChange={(open) => {
          if (!open && !rejecting) {
            setRejectRequest(null);
            setRejectReason("");
          }
        }}
      >
        <DialogContent className="rounded-2xl bg-white text-slate-900 sm:max-w-md">
          <DialogHeader className="bg-white">
            <DialogTitle>Nhập lý do từ chối</DialogTitle>
            <DialogDescription>
              {rejectRequest?.mode === "bulk"
                ? `Lý do này sẽ áp dụng cho ${rejectRequest.count} yêu cầu đang chọn.`
                : "Staff sẽ nhìn thấy lý do này trong chi tiết yêu cầu."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="salary-hold-rejection-reason">Lý do từ chối</Label>
            <Textarea
              id="salary-hold-rejection-reason"
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              placeholder="Nhập lý do để Staff nắm được thông tin..."
              className="min-h-28 bg-white text-slate-900 placeholder:text-slate-400"
              maxLength={1000}
              disabled={rejecting}
              autoFocus
            />
            <div className="text-right text-xs text-slate-500">
              {rejectReason.length}/1000 ký tự
            </div>
          </div>
          <DialogFooter className="bg-white">
            <Button
              type="button"
              variant="outline"
              disabled={rejecting}
              onClick={() => {
                setRejectRequest(null);
                setRejectReason("");
              }}
            >
              Hủy
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={rejecting || !rejectReason.trim()}
              onClick={() => void confirmReject()}
            >
              {rejecting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Xác nhận từ chối
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}

function SalaryHoldDetailDialog({
  row,
  items,
  onSelectRow,
  onClose,
  isAdmin,
  viewer,
  qrTemplate,
  setQrTemplate,
  onStatus,
  onReject,
}: {
  row: SalaryHoldRecord;
  items: SalaryHoldRecord[];
  onSelectRow: (row: SalaryHoldRecord) => void;
  onClose: () => void;
  isAdmin: boolean;
  viewer: UserRecord;
  qrTemplate: string;
  setQrTemplate: (v: string) => void;
  onStatus: (
    row: SalaryHoldRecord,
    status: SalaryHoldStatus,
    closeDetail?: boolean,
    rejectionReason?: string,
  ) => Promise<boolean>;
  onReject: (row: SalaryHoldRecord) => void;
}) {
  const disbursingIdRef = useRef<string | null>(null);
  const [disbursingId, setDisbursingId] = useState<string | null>(null);

  const currentIndex = items.findIndex((item) => item.id === row.id);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < items.length - 1;
  const canDisburse = isAdmin && row.status === "approved";
  const isDisbursing = disbursingId === row.id;
  const qrUrl =
    row.status === "approved"
      ? buildVietQrUrl({
          bankName: row.staff_bank_name,
          accountNumber: row.staff_bank_account_number,
          accountName: row.staff_bank_account_name,
          amount: row.amount,
          description: buildSalaryHoldTransferDescription(qrTemplate, row.worker_name),
        })
      : null;

  const goPrev = useCallback(() => {
    if (hasPrev && !isDisbursing) onSelectRow(items[currentIndex - 1]);
  }, [currentIndex, hasPrev, isDisbursing, items, onSelectRow]);

  const goNext = useCallback(() => {
    if (hasNext && !isDisbursing) onSelectRow(items[currentIndex + 1]);
  }, [currentIndex, hasNext, isDisbursing, items, onSelectRow]);

  const disburseAndGoNext = useCallback(async () => {
    if (!canDisburse || !qrUrl || disbursingIdRef.current) return;

    const currentRow = row;
    const nextRow = hasNext ? items[currentIndex + 1] : null;
    disbursingIdRef.current = currentRow.id;
    setDisbursingId(currentRow.id);

    try {
      const succeeded = await onStatus(currentRow, "disbursed", false);
      if (!succeeded) return;
      if (nextRow) onSelectRow(nextRow);
      else onClose();
    } finally {
      if (disbursingIdRef.current === currentRow.id) disbursingIdRef.current = null;
      setDisbursingId((current) => (current === currentRow.id ? null : current));
    }
  }, [canDisburse, currentIndex, hasNext, items, onClose, onSelectRow, onStatus, qrUrl, row]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (!event.repeat && !isDisbursing) goPrev();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        if (event.repeat || isDisbursing) return;
        if (canDisburse) void disburseAndGoNext();
        else goNext();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canDisburse, disburseAndGoNext, goNext, goPrev, isDisbursing]);

  const nextDisabled = canDisburse ? !qrUrl || isDisbursing : !hasNext || isDisbursing;
  const navigationHint = canDisburse
    ? !qrUrl
      ? "Không thể tạo mã QR cho yêu cầu này"
      : isDisbursing
        ? "Đang xác nhận giải ngân..."
        : "Bấm nút hoặc phím → để đánh dấu đã giải ngân"
    : "Dùng phím ←/→ hoặc nút mũi tên để chuyển card";

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !isDisbursing) onClose();
      }}
    >
      <DialogContent className="max-h-[92dvh] overflow-y-auto rounded-2xl sm:max-w-lg desktop:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{row.worker_name}</DialogTitle>
          <DialogDescription>
            {currentIndex >= 0 ? `${currentIndex + 1} / ${items.length}` : "Chi tiết giữ lương"} ·{" "}
            {row.company_name} · {Number(row.amount).toLocaleString("vi-VN")} đ
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="h-11 w-11 shrink-0 rounded-full"
            disabled={!hasPrev || isDisbursing}
            onClick={goPrev}
            aria-label="Card trước"
            title="Card trước"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <span className="min-w-0 flex-1 text-center text-xs text-muted-foreground">
            {navigationHint}
          </span>
          <Button
            type="button"
            size="icon"
            variant={canDisburse ? "default" : "outline"}
            className="h-11 w-11 shrink-0 rounded-full"
            disabled={nextDisabled}
            onClick={() => {
              if (canDisburse) void disburseAndGoNext();
              else goNext();
            }}
            aria-label={canDisburse ? "Đánh dấu đã giải ngân và sang card tiếp" : "Card tiếp theo"}
            title={canDisburse ? "Đánh dấu đã giải ngân và sang card tiếp" : "Card tiếp theo"}
          >
            {isDisbursing ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <ChevronRight className="h-5 w-5" />
            )}
          </Button>
        </div>

        <div
          className={
            canDisburse
              ? "grid gap-3 desktop:grid-cols-[minmax(0,1fr)_15rem] desktop:items-start"
              : "space-y-3"
          }
        >
          <div className="space-y-3">
            <StatusChip tone={SALARY_HOLD_STATUS[row.status].tone}>
              {SALARY_HOLD_STATUS[row.status].label}
            </StatusChip>
            <div className="rounded-xl border bg-muted/30 p-3 text-sm">
              <div className="mb-2 font-semibold">Lần đi làm giữ lương</div>
              <div className="grid grid-cols-2 gap-2 desktop:grid-cols-5">
                <div className="min-w-0 rounded-lg border border-border/60 bg-background/70 px-2.5 py-2">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Mã NV
                  </div>
                  <div className="mt-0.5 truncate text-xs font-semibold">
                    {row.employee_code || "Chưa có"}
                  </div>
                </div>
                <div className="min-w-0 rounded-lg border border-border/60 bg-background/70 px-2.5 py-2">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Họ tên
                  </div>
                  <div className="mt-0.5 truncate text-xs font-semibold">
                    {row.worker_name || "Chưa có"}
                  </div>
                </div>
                <div className="min-w-0 rounded-lg border border-border/60 bg-background/70 px-2.5 py-2">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Nhà máy
                  </div>
                  <div className="mt-0.5 truncate text-xs font-semibold">
                    {row.company_name || "Chưa có"}
                  </div>
                </div>
                <div className="min-w-0 rounded-lg border border-border/60 bg-background/70 px-2.5 py-2">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Ngày vào
                  </div>
                  <div className="mt-0.5 truncate text-xs font-semibold">
                    {formatHistoryDate(row.expand?.employment_history?.join_date)}
                  </div>
                </div>
                <div className="min-w-0 rounded-lg border border-border/60 bg-background/70 px-2.5 py-2">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Ngày nghỉ
                  </div>
                  <div className="mt-0.5 truncate text-xs font-semibold">
                    {formatHistoryDate(row.expand?.employment_history?.leave_date, "Chưa nghỉ")}
                  </div>
                </div>
              </div>
            </div>
            <div className="rounded-xl bg-muted/30 p-3 text-sm">{row.content}</div>
            {row.status === "rejected" && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
                <div className="mb-1 font-semibold text-destructive">Lý do từ chối</div>
                <div className="whitespace-pre-wrap break-words text-foreground">
                  {row.rejection_reason || "Chưa có thông tin lý do từ chối."}
                </div>
              </div>
            )}
            <details className="rounded-xl border p-3">
              <summary className="cursor-pointer text-sm font-medium">STK Staff nhận tiền</summary>
              <div className="mt-2 text-sm">
                <div>{row.staff_bank_name}</div>
                <div>{row.staff_bank_account_number}</div>
                <div>{row.staff_bank_account_name}</div>
              </div>
            </details>
          </div>

          {isAdmin && row.status === "approved" && (
            <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3 desktop:sticky desktop:top-0">
              <Label>Nội dung chuyển khoản</Label>
              <Input
                value={qrTemplate}
                disabled={isDisbursing}
                onChange={(e) => setQrTemplate(e.target.value)}
              />
              <div className="text-[11px] text-muted-foreground">
                Dùng + tên để tự lấy họ tên NLĐ.
              </div>
              {qrUrl ? (
                <div className="flex flex-col items-center gap-2">
                  <div className="flex items-center gap-1 text-xs font-semibold text-primary">
                    <QrCode className="h-4 w-4" />
                    Mã QR chuyển khoản
                  </div>
                  <img src={qrUrl} alt="QR giải ngân giữ lương" className="h-48 w-48 rounded-lg" />
                  <div className="text-center text-xs text-muted-foreground">
                    Quét mã để chuyển {Number(row.amount).toLocaleString("vi-VN")} đ
                  </div>
                </div>
              ) : (
                <div className="text-sm text-destructive">
                  Không tạo được QR do ngân hàng hoặc STK không hợp lệ.
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          {!isAdmin && row.staff === viewer.id && row.status === "received" && (
            <Button
              variant="destructive"
              disabled={isDisbursing}
              onClick={() => void onStatus(row, "cancelled")}
            >
              <X className="mr-1 h-4 w-4" />
              Hủy yêu cầu
            </Button>
          )}
          {isAdmin && row.status === "received" && (
            <>
              <Button variant="destructive" disabled={isDisbursing} onClick={() => onReject(row)}>
                Từ chối
              </Button>
              <Button disabled={isDisbursing} onClick={() => void onStatus(row, "approved")}>
                <Check className="mr-1 h-4 w-4" />
                Duyệt
              </Button>
            </>
          )}
          <Button variant="outline" disabled={isDisbursing} onClick={onClose}>
            Đóng
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
