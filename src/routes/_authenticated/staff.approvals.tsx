import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { pb } from "@/lib/pocketbase";
import { useAuth } from "@/lib/auth";
import { useDebouncedSearch } from "@/hooks/use-debounced-search";
import { PageContainer } from "@/components/layout/PageContainer";
import { FilterBar } from "@/components/ui/filter-bar";
import { StatCard } from "@/components/ui/stat-card";
import { StatusChip, toneBorder } from "@/components/ui/status-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { DataLoadingState } from "@/components/ui/data-loading-state";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApprovalForm } from "@/components/approvals/ApprovalForm";
import { ApprovalDetail } from "@/components/approvals/ApprovalDetail";
import { escapePb, userDisplayName } from "@/lib/delegations";
import type {
  ApprovalRequestRecord,
  ApprovalResponseRecord,
  ApprovalStatus,
} from "@/lib/approval-requests";
import { deleteOldRequests } from "@/lib/approval-requests";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { ClipboardCheck, Clock, Plus, Trash2 } from "lucide-react";
import { joinTenantFilters } from "@/lib/tenant";

export const Route = createFileRoute("/_authenticated/staff/approvals")({
  component: ApprovalsPage,
});

type Tab = "pending" | "approved" | "rejected" | "completed" | "all";

const STATUS_META: Record<
  ApprovalStatus,
  { label: string; tone: "warning" | "success" | "danger" | "info" }
> = {
  pending: { label: "Chờ duyệt", tone: "warning" },
  approved: { label: "Đã duyệt", tone: "success" },
  rejected: { label: "Từ chối", tone: "danger" },
  completed: { label: "Hoàn thành", tone: "info" },
};

const TAB_FILTERS: Record<Tab, string> = {
  pending: 'status="pending"',
  approved: 'status="approved"',
  rejected: 'status="rejected"',
  completed: 'status="completed"',
  all: "",
};

function formatDate(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ApprovalsPage() {
  const { user, isAdmin } = useAuth();

  const [items, setItems] = useState<ApprovalRequestRecord[]>([]);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedSearch(search);
  const [tab, setTab] = useState<Tab>("pending");
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [stats, setStats] = useState<Record<Tab, number>>({
    pending: 0,
    approved: 0,
    rejected: 0,
    completed: 0,
    all: 0,
  });

  const [detailRequest, setDetailRequest] = useState<ApprovalRequestRecord | null>(null);
  const [detailResponses, setDetailResponses] = useState<ApprovalResponseRecord[]>([]);
  const [showDetail, setShowDetail] = useState(false);

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteBeforeDate, setDeleteBeforeDate] = useState("");
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const userId = escapePb(user.id);
      const rolePart = isAdmin
        ? `(admins ~ "${userId}" || creator = "${userId}")`
        : `creator = "${userId}"`;
      const tabPart = TAB_FILTERS[tab];
      const searchPart = debouncedSearch.trim()
        ? `title ~ "${escapePb(debouncedSearch.trim())}"`
        : "";
      const filter = joinTenantFilters(user, rolePart, tabPart, searchPart);

      const res = await pb.collection("approval_requests").getList(1, 200, {
        filter,
        sort: "-created",
        expand: "creator,admins",
      });
      setItems(res.items as unknown as ApprovalRequestRecord[]);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [user?.id, isAdmin, tab, debouncedSearch]);

  const loadStats = useCallback(async () => {
    if (!user?.id) return;
    const userId = escapePb(user.id);
    const rolePart = isAdmin
      ? `(admins ~ "${userId}" || creator = "${userId}")`
      : `creator = "${userId}"`;

    const searchPart = debouncedSearch.trim()
      ? `title ~ "${escapePb(debouncedSearch.trim())}"`
      : "";

    const counts = await Promise.all(
      (Object.keys(TAB_FILTERS) as Tab[]).map(async (key) => {
        const tabPart = TAB_FILTERS[key];
        const filter = joinTenantFilters(user, rolePart, tabPart, searchPart);
        try {
          const r = await pb
            .collection("approval_requests")
            .getList(1, 1, { filter, fields: "id" });
          return [key, r.totalItems] as const;
        } catch {
          return [key, 0] as const;
        }
      }),
    );
    setStats(Object.fromEntries(counts) as Record<Tab, number>);
  }, [user?.id, isAdmin, debouncedSearch]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    loadStats();
  }, [loadStats]);

  async function openDetail(req: ApprovalRequestRecord) {
    setDetailRequest(req);
    try {
      const res = await pb.collection("approval_responses").getFullList<ApprovalResponseRecord>({
        filter: joinTenantFilters(user, `request = "${escapePb(req.id)}"`),
        expand: "admin",
        sort: "created",
      });
      setDetailResponses(res);
    } catch {
      setDetailResponses([]);
    }
    setShowDetail(true);
  }

  async function handleDelete() {
    if (!deleteBeforeDate) return toast.error("Vui lòng chọn ngày");
    setDeleting(true);
    try {
      const count = await deleteOldRequests(deleteBeforeDate);
      toast.success(`Đã xóa ${count} yêu cầu`);
      setShowDeleteDialog(false);
      setDeleteBeforeDate("");
      load();
      loadStats();
    } catch {
      toast.error("Không thể xóa");
    } finally {
      setDeleting(false);
    }
  }

  const tabs = [
    { value: "pending" as Tab, label: `Chờ duyệt (${stats.pending})` },
    { value: "approved" as Tab, label: `Đã duyệt (${stats.approved})` },
    { value: "completed" as Tab, label: `Hoàn thành (${stats.completed})` },
    { value: "rejected" as Tab, label: `Từ chối (${stats.rejected})` },
    { value: "all" as Tab, label: `Tất cả (${stats.all})` },
  ];

  return (
    <PageContainer
      title="Phê duyệt"
      right={
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card text-primary shadow-sm transition hover:bg-muted active:scale-95"
          aria-label="Tạo yêu cầu phê duyệt"
        >
          <Plus className="h-4 w-4" />
        </button>
      }
    >
      <div className="space-y-3 pb-24">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatCard label="Chờ duyệt" value={stats.pending} tone="warning" />
          <StatCard label="Đã duyệt" value={stats.approved} tone="success" />
          <StatCard label="Hoàn thành" value={stats.completed} tone="info" />
          <StatCard label="Từ chối" value={stats.rejected} tone="danger" />
        </div>

        <FilterBar
          desktopSearchAfterChips
          search={search}
          onSearchChange={setSearch}
          placeholder="Tìm theo tiêu đề..."
          chips={tabs.map((t) => ({ key: t.value, label: t.label }))}
          activeChip={tab}
          onChipChange={(t: string) => setTab(t as Tab)}
        />

        {isAdmin && (
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDeleteDialog(true)}
              className="gap-1.5 text-xs text-muted-foreground"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Xóa dữ liệu cũ
            </Button>
          </div>
        )}

        {loading && !items.length ? (
          <DataLoadingState variant="list" label="Đang tải danh sách yêu cầu..." rows={3} />
        ) : loading ? (
          <DataLoadingState variant="inline" label="Đang cập nhật danh sách yêu cầu..." />
        ) : null}

        {!loading && !items.length && (
          <EmptyState
            icon={ClipboardCheck}
            title={isAdmin ? "Không có yêu cầu nào" : "Bạn chưa gửi yêu cầu nào"}
          />
        )}

        <div className="space-y-2">
          {items.map((item) => {
            const meta = STATUS_META[item.status];
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => openDetail(item)}
                className={cn("list-card w-full text-left", toneBorder[meta.tone])}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{item.title}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {formatDate(item.created)}
                    </div>
                    {isAdmin && item.expand?.creator && (
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        Từ: {userDisplayName(item.expand.creator)}
                      </div>
                    )}
                  </div>
                  <StatusChip tone={meta.tone}>{meta.label}</StatusChip>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <ApprovalForm
        open={showForm}
        onOpenChange={setShowForm}
        creatorId={user?.id || ""}
        currentUserId={user?.id || ""}
        onCreated={() => {
          load();
          loadStats();
        }}
      />

      <ApprovalDetail
        open={showDetail}
        onOpenChange={setShowDetail}
        request={detailRequest}
        responses={detailResponses}
        currentUserId={user?.id || ""}
        isAdmin={isAdmin}
        onUpdated={() => {
          load();
          loadStats();
        }}
      />

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="rounded-3xl sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Xóa dữ liệu cũ</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Xóa tất cả yêu cầu phê duyệt được tạo trước ngày:
          </p>
          <DateInput
            value={deleteBeforeDate}
            onChange={(v) => setDeleteBeforeDate(v)}
            className="rounded-xl"
          />
          <Button
            onClick={handleDelete}
            disabled={deleting || !deleteBeforeDate}
            variant="destructive"
            className="w-full gap-1.5 rounded-xl"
          >
            <Trash2 className="h-4 w-4" />
            {deleting ? "Đang xóa..." : "Xóa"}
          </Button>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
