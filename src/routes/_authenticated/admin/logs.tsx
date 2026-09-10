import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Search } from "lucide-react";
import { useDebouncedSearch } from "@/hooks/use-debounced-search";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { DataLoadingState } from "@/components/ui/data-loading-state";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusChip } from "@/components/ui/status-chip";
import { escapePb, relationInFilter } from "@/lib/delegations";
import { pb, type UserRecord } from "@/lib/pocketbase";
import {
  formatStaffActionDateTime,
  getStaffActionActorName,
  getWorkerActionSummary,
  type StaffActionLogRecord,
} from "@/lib/staff-log";

export const Route = createFileRoute("/_authenticated/admin/logs")({
  beforeLoad: () => {
    const currentUser = pb.authStore.record as UserRecord | null;
    if (!currentUser || currentUser.role !== "admin")
      throw redirect({ to: "/account", search: {} as never });
  },
  component: SystemActionLogsPage,
});

const ACTION_LABELS: Record<string, string> = {
  create: "Tạo mới",
  update: "Cập nhật",
  delete: "Xóa",
  import: "Nhập dữ liệu",
  report_advance: "Báo ứng",
  report_leave: "Báo nghỉ",
  report_join: "Báo đi làm mới",
  update_bank: "Cập nhật ngân hàng",
};

const COLLECTION_LABELS: Record<string, string> = {
  employment_histories: "Lịch sử đi làm",
  staff_action_logs: "Nhật ký thao tác",
  users: "Tài khoản",
  advances: "Tạm ứng",
  check_attendance_items: "Chấm công",
  check_salary_items: "Tính lương",
  factory_managers: "Quản lý nhà máy",
};

const ROLE_LABELS: Record<string, string> = {
  admin: "Quản trị viên",
  staff: "Nhân sự",
  user: "Người lao động",
};

function getLogSnapshot(log: StaffActionLogRecord | null | undefined) {
  if (!log?.before || typeof log.before !== "object" || Array.isArray(log.before)) return null;
  return log.before as Record<string, unknown>;
}

function getTargetName(log: StaffActionLogRecord | null | undefined) {
  if (!log) return "";
  const snapshot = getLogSnapshot(log);
  const snapshotName = [snapshot?.full_name, snapshot?.username, snapshot?.uid].find(
    (value) => typeof value === "string" && value.trim(),
  );
  return (
    log.expand?.target_user?.full_name ||
    log.expand?.target_user?.username ||
    (typeof snapshotName === "string" ? snapshotName : "") ||
    log.target_user ||
    ""
  );
}

function joinPbFilters(parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" && ");
}

function buildLogFilter(actionFilter: string, search: string) {
  const q = escapePb(search.trim());
  const searchFilter = q
    ? `(${[
        "actor.full_name",
        "actor.username",
        "actor",
        "target_user.full_name",
        "target_user.username",
        "target_collection",
        "note",
        "action",
      ]
        .map((field) => `${field}~"${q}"`)
        .join(" || ")})`
    : "";

  return joinPbFilters([
    actionFilter === "all" ? "" : `action="${escapePb(actionFilter)}"`,
    searchFilter,
  ]);
}

function SystemActionLogsPage() {
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [logs, setLogs] = useState<StaffActionLogRecord[]>([]);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedSearch(search);
  const [actionFilter, setActionFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedLog, setSelectedLog] = useState<StaffActionLogRecord | null>(null);

  useEffect(() => {
    let alive = true;
    if (page === 1) {
      setInitialLoading(true);
    } else {
      setLoadingMore(true);
    }
    const filter = buildLogFilter(actionFilter, debouncedSearch);

    pb.collection("staff_action_logs")
      .getList<StaffActionLogRecord>(page, 50, {
        filter,
        sort: "-created",
        expand: "actor,target_user,target_worker",
      })
      .then(async (res) => {
        if (!alive) return;
        const missingActorIds = res.items
          .filter((item) => item.actor && !item.expand?.actor)
          .map((item) => item.actor);
        if (missingActorIds.length > 0) {
          try {
            const actors = await pb.collection("users").getFullList<UserRecord>({
              filter: relationInFilter("id", missingActorIds),
              fields: "id,full_name,username,phone,role,tenant_company",
            });
            const actorsById = new Map(actors.map((actor) => [actor.id, actor]));
            for (const actorId of missingActorIds) {
              if (actorsById.has(actorId)) continue;
              try {
                const actor = await pb.collection("users").getOne<UserRecord>(actorId, {
                  fields: "id,full_name,username,phone,role,tenant_company",
                });
                actorsById.set(actor.id, actor);
              } catch {
                // Keep the ID fallback for deleted or inaccessible historical actors.
              }
            }
            for (const item of res.items) {
              const actor = actorsById.get(item.actor);
              if (actor) item.expand = { ...item.expand, actor };
            }
          } catch (error) {
            console.warn("[admin-logs] Không tải được tên tài khoản người thao tác", error);
          }
        }
        if (!alive) return;
        setLogs((current) => (page === 1 ? res.items : [...current, ...res.items]));
        setTotalPages(res.totalPages || 1);
      })
      .finally(() => {
        if (!alive) return;
        if (page === 1) {
          setInitialLoading(false);
        } else {
          setLoadingMore(false);
        }
      });

    return () => {
      alive = false;
    };
  }, [actionFilter, debouncedSearch, page]);

  const updateActionFilter = (value: string) => {
    setActionFilter(value);
    setPage(1);
    setLogs([]);
  };

  const updateSearch = (value: string) => {
    setSearch(value);
    setPage(1);
    setLogs([]);
  };

  return (
    <PageContainer
      title="Nhật ký thao tác hệ thống"
      subtitle="Theo dõi các thao tác nhập dữ liệu, cập nhật và xử lý nghiệp vụ trong hệ thống"
      right={
        <Link
          to="/"
          className="flex h-9 items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 text-xs font-medium text-foreground shadow-soft"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Tài khoản
        </Link>
      }
    >
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(event) => updateSearch(event.target.value)}
          placeholder="Tìm theo người thao tác, người liên quan, nhóm dữ liệu, ghi chú..."
          className="rounded-full pl-9"
        />
      </div>

      <Select value={actionFilter} onValueChange={updateActionFilter}>
        <SelectTrigger className="rounded-xl">
          <SelectValue placeholder="Lọc theo thao tác" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Tất cả thao tác</SelectItem>
          {Object.keys(ACTION_LABELS).map((action) => (
            <SelectItem key={action} value={action}>
              {ACTION_LABELS[action]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {initialLoading ? (
        <DataLoadingState variant="list" label="Đang tải nhật ký thao tác..." rows={4} />
      ) : logs.length === 0 ? (
        <EmptyState
          icon={Search}
          title="Chưa có nhật ký phù hợp"
          description="Thử đổi bộ lọc hoặc thao tác thêm trên màn hình nhân sự/quản trị để hệ thống ghi nhật ký mới."
        />
      ) : (
        <>
          {logs.map((item) => {
            const actorName = getStaffActionActorName(item);
            const actorUsername = item.expand?.actor?.username;
            const targetName = getTargetName(item);
            const roleLabel = item.actor_role_snapshot || "user";
            const collectionLabel =
              COLLECTION_LABELS[item.target_collection] || item.target_collection;
            return (
              <button
                type="button"
                key={item.id}
                onClick={() => setSelectedLog(item)}
                className="flex w-full min-w-0 items-start gap-2 rounded-xl border border-border/60 bg-card p-2.5 text-left shadow-sm transition-colors hover:bg-muted/40 active:scale-[0.99]"
              >
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-sm font-semibold">
                        {ACTION_LABELS[item.action] || item.action}
                      </span>
                      <StatusChip tone="info">{collectionLabel}</StatusChip>
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {actorName}
                      {actorUsername ? ` @${actorUsername}` : ""}
                      {" - "}
                      {ROLE_LABELS[roleLabel] || roleLabel}
                      {targetName ? ` -> ${targetName}` : ""}
                    </div>
                  </div>
                  <span className="shrink-0 text-[11px] text-muted-foreground sm:text-right">
                    {formatStaffActionDateTime(item.created)}
                  </span>
                </div>
                {item.note && (
                  <div className="mt-1 truncate text-[11px] leading-relaxed text-muted-foreground">
                    {getWorkerActionSummary(item)}
                  </div>
                )}
              </button>
            );
          })}
          {page < totalPages && (
            <Button
              type="button"
              variant="outline"
              className="w-full rounded-full"
              disabled={loadingMore}
              onClick={() => setPage((current) => current + 1)}
            >
              {loadingMore ? "Đang tải..." : "Tải thêm nhật ký"}
            </Button>
          )}
        </>
      )}

      <LogDetailDialog log={selectedLog} onOpenChange={(open) => !open && setSelectedLog(null)} />
    </PageContainer>
  );
}

function LogDetailDialog({
  log,
  onOpenChange,
}: {
  log: StaffActionLogRecord | null;
  onOpenChange: (open: boolean) => void;
}) {
  const actorName = log ? getStaffActionActorName(log) : "Không rõ";
  const targetName = getTargetName(log);
  const collectionLabel = log
    ? COLLECTION_LABELS[log.target_collection] || log.target_collection
    : "";
  const roleLabel = log ? ROLE_LABELS[log.actor_role_snapshot] || log.actor_role_snapshot : "";

  return (
    <Dialog open={!!log} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88dvh] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle>
            {log ? ACTION_LABELS[log.action] || log.action : "Chi tiết nhật ký"}
          </DialogTitle>
          <DialogDescription>{formatDateTime(log?.created)}</DialogDescription>
        </DialogHeader>
        {log && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <LogDetailItem label="Người thao tác" value={actorName || "Không rõ"} />
              <LogDetailItem label="Vai trò" value={roleLabel || "Không rõ"} />
              <LogDetailItem label="Người liên quan" value={targetName || "Không có"} />
              <LogDetailItem label="Nhóm dữ liệu" value={collectionLabel} />
              <LogDetailItem label="Bản ghi" value={log.target_record || "Không có"} />
              <LogDetailItem label="Hành động" value={log.action} />
            </div>
            {log.note && (
              <div className="rounded-xl bg-muted/40 p-3">
                <div className="text-[11px] text-muted-foreground">Ghi chú</div>
                <div className="mt-1 break-words">{log.note}</div>
              </div>
            )}
            <LogSnapshot label="Dữ liệu trước" value={log.before} />
            <LogSnapshot label="Dữ liệu sau" value={log.after} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function LogSnapshot({ label, value }: { label: string; value: unknown }) {
  if (!value || typeof value !== "object") return null;
  return (
    <div className="rounded-xl border border-border/60 bg-card p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function LogDetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/40 p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-1 break-words font-medium">{value}</div>
    </div>
  );
}

function formatDateTime(value?: string) {
  if (!value) return "Không rõ thời gian";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("vi-VN");
}
