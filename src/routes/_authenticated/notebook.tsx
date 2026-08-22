import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pb, type UserRecord } from "@/lib/pocketbase";
import { useAuth } from "@/lib/auth";
import { companyFilter, companyPayload } from "@/lib/tenant";
import { useDebouncedSearch } from "@/hooks/use-debounced-search";
import {
  fetchCachedStaffWorkspace,
  fetchStaffWorkspace,
  type StaffWorkerRecord,
} from "@/lib/staff-permissions";
import { useStaffCacheSignal } from "@/lib/use-staff-cache-signal";
import { PageContainer } from "@/components/layout/PageContainer";
import { FilterBar } from "@/components/ui/filter-bar";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { DataLoadingState } from "@/components/ui/data-loading-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { escapePb } from "@/lib/delegations";
import { formatMoneyInput, parseMoneyInput } from "@/lib/money";
import { toast } from "@/lib/toast";
import {
  Ban,
  BookOpenText,
  Check,
  CircleDashed,
  CircleHelp,
  NotebookPen,
  Pencil,
  Plus,
  Settings2,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/notebook")({
  component: NotebookPage,
});

type EntryStatus = "pending" | "done" | "cancelled" | "other";
type StatusTab = "all" | EntryStatus;

type CategoryRecord = {
  id: string;
  name: string;
  created_by: string;
  created: string;
};

type NotebookEntry = {
  id: string;
  date: string;
  category: string;
  worker: string;
  other_person: string;
  amount: number;
  note: string;
  status: EntryStatus;
  created_by: string;
  created: string;
  expand?: {
    category?: CategoryRecord;
    worker?: UserRecord;
  };
};

const STATUS_LABELS: Record<EntryStatus, string> = {
  pending: "Đang xử lý",
  done: "Đã xong",
  cancelled: "Hủy",
  other: "Khác",
};

const STATUS_TONES: Record<EntryStatus, string> = {
  pending: "warning",
  done: "success",
  cancelled: "danger",
  other: "neutral",
};

function NotebookPage() {
  const { user } = useAuth();
  const isStaffOrAdmin = user?.role === "staff" || user?.role === "admin";

  const [entries, setEntries] = useState<NotebookEntry[]>([]);
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [workers, setWorkers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedSearch(search);
  const [statusTab, setStatusTab] = useState<StatusTab>("all");
  const [catFilter, setCatFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [showCatMgr, setShowCatMgr] = useState(false);
  const [editingEntry, setEditingEntry] = useState<NotebookEntry | null>(null);

  // Form state
  const [fDate, setFDate] = useState("");
  const [fCategory, setFCategory] = useState("");
  const [fWorker, setFWorker] = useState("");
  const [fOtherPerson, setFOtherPerson] = useState("");
  const [fAmount, setFAmount] = useState("");
  const [fNote, setFNote] = useState("");
  const [sending, setSending] = useState(false);

  // Category manager
  const [newCatName, setNewCatName] = useState("");
  const [catSending, setCatSending] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CategoryRecord | null>(null);
  const [editingCatName, setEditingCatName] = useState("");
  const [catUpdating, setCatUpdating] = useState(false);

  const loadCategories = useCallback(async () => {
    if (!user?.id) {
      setCategories([]);
      return;
    }
    try {
      const res = await pb.collection("notebook_categories").getList(1, 200, {
        filter: `${companyFilter(user)} && created_by="${escapePb(user.id)}"`,
        sort: "name",
      });
      setCategories(res.items as unknown as CategoryRecord[]);
    } catch {}
  }, [user?.id]);

  const loadEntries = useCallback(async () => {
    if (!user?.id) {
      setEntries([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const parts: string[] = [companyFilter(user), `created_by="${escapePb(user.id)}"`];

      if (statusTab !== "all") {
        parts.push(`status="${statusTab}"`);
      }
      if (catFilter) {
        parts.push(`category="${escapePb(catFilter)}"`);
      }
      if (dateFrom) {
        parts.push(`date>="${dateFrom} 00:00:00"`);
      }
      if (dateTo) {
        parts.push(`date<="${dateTo} 23:59:59"`);
      }
      if (debouncedSearch.trim()) {
        const q = escapePb(debouncedSearch.trim());
        parts.push(`(other_person~"${q}" || worker.full_name~"${q}" || note~"${q}")`);
      }

      const filter = parts.join(" && ");
      const res = await pb.collection("notebook_entries").getList(1, 300, {
        filter: filter || undefined,
        sort: "-date,-created",
        expand: "category,worker",
      });
      setEntries(res.items as unknown as NotebookEntry[]);
    } catch (e: any) {
      toast.error(e?.message || "Lỗi tải dữ liệu");
    } finally {
      setLoading(false);
    }
  }, [user?.id, statusTab, catFilter, dateFrom, dateTo, debouncedSearch]);

  const loadWorkers = useCallback(async () => {
    if (!isStaffOrAdmin || !user) return;
    try {
      const workspace = await fetchStaffWorkspace(user as UserRecord);
      setWorkers(workspace.workers.map((w: StaffWorkerRecord) => w.user));
    } catch {}
  }, [isStaffOrAdmin, user]);

  useEffect(() => {
    loadCategories();
    loadWorkers();
  }, [loadCategories, loadWorkers]);

  const cacheSignal = useStaffCacheSignal();
  useEffect(() => {
    if (!isStaffOrAdmin || !user?.id || cacheSignal === 0) return;
    const timer = setTimeout(async () => {
      const ws = await fetchCachedStaffWorkspace(user as UserRecord);
      if (ws) setWorkers(ws.workers.map((w) => w.user));
    }, 150);
    return () => clearTimeout(timer);
  }, [cacheSignal, isStaffOrAdmin, user?.id]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  // Stats
  const stats = useMemo(() => {
    const s = { pending: 0, done: 0, cancelled: 0, other: 0 };
    for (const e of entries) {
      s[e.status] = (s[e.status] || 0) + (e.amount || 0);
    }
    return s;
  }, [entries]);

  const openCreateForm = () => {
    setEditingEntry(null);
    setFDate(new Date().toISOString().slice(0, 10));
    setFCategory("");
    setFWorker("");
    setFOtherPerson("");
    setFAmount("");
    setFNote("");
    setShowForm(true);
  };

  const openEditForm = (entry: NotebookEntry) => {
    setEditingEntry(entry);
    setFDate(entry.date ? entry.date.slice(0, 10) : "");
    setFCategory(entry.category || "");
    setFWorker(entry.worker || "");
    setFOtherPerson(entry.other_person || "");
    setFAmount(entry.amount ? formatMoneyInput(entry.amount) : "");
    setFNote(entry.note || "");
    setShowForm(true);
  };

  const submitEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseMoneyInput(fAmount);
    const hasData =
      fDate || fCategory || fWorker || fOtherPerson.trim() || amount > 0 || fNote.trim();
    if (!hasData) {
      toast.error("Cần nhập ít nhất 1 thông tin");
      return;
    }
    setSending(true);
    try {
      const data: any = {
        date: fDate ? `${fDate} 12:00:00` : null,
        category: fCategory || null,
        worker: fWorker || null,
        other_person: fOtherPerson.trim(),
        amount: amount || 0,
        note: fNote.trim(),
        status: editingEntry?.status || "pending",
        created_by: user!.id,
        ...companyPayload(user),
      };
      if (editingEntry) {
        await pb.collection("notebook_entries").update(editingEntry.id, data);
        toast.success("Đã cập nhật");
      } else {
        await pb.collection("notebook_entries").create(data);
        toast.success("Đã thêm mới");
      }
      setShowForm(false);
      loadEntries();
    } catch (e: any) {
      toast.error(e?.message || "Lỗi lưu dữ liệu");
    } finally {
      setSending(false);
    }
  };

  const updateStatus = async (entry: NotebookEntry, status: EntryStatus) => {
    try {
      await pb.collection("notebook_entries").update(entry.id, { status });
      toast.success(`Đã chuyển: ${STATUS_LABELS[status]}`);
      loadEntries();
    } catch (e: any) {
      toast.error(e?.message || "Lỗi cập nhật");
    }
  };

  const deleteEntry = async (entry: NotebookEntry) => {
    if (!confirm("Xoá bản ghi này?")) return;
    try {
      await pb.collection("notebook_entries").delete(entry.id);
      toast.success("Đã xoá");
      loadEntries();
    } catch (e: any) {
      toast.error(e?.message || "Lỗi xoá");
    }
  };

  const createCategory = async () => {
    if (!newCatName.trim()) return;
    setCatSending(true);
    try {
      await pb.collection("notebook_categories").create({
        name: newCatName.trim(),
        created_by: user!.id,
        ...companyPayload(user),
      });
      setNewCatName("");
      loadCategories();
      toast.success("Đã tạo danh mục");
    } catch (e: any) {
      toast.error(e?.message || "Lỗi tạo danh mục");
    } finally {
      setCatSending(false);
    }
  };

  const deleteCategory = async (cat: CategoryRecord) => {
    if (!confirm(`Xoá danh mục "${cat.name}"?`)) return;
    try {
      await pb.collection("notebook_categories").delete(cat.id);
      loadCategories();
      toast.success("Đã xoá danh mục");
    } catch (e: any) {
      toast.error(e?.message || "Lỗi xoá");
    }
  };

  const openCategoryEditor = (category: CategoryRecord) => {
    setEditingCategory(category);
    setEditingCatName(category.name || "");
  };

  const closeCategoryEditor = () => {
    if (catUpdating) return;
    setEditingCategory(null);
    setEditingCatName("");
  };

  const updateCategory = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingCategory || !editingCatName.trim()) return;

    const name = editingCatName.trim();
    if (name === editingCategory.name) {
      closeCategoryEditor();
      return;
    }

    setCatUpdating(true);
    try {
      await pb.collection("notebook_categories").update(editingCategory.id, { name });
      await Promise.all([loadCategories(), loadEntries()]);
      setEditingCategory(null);
      setEditingCatName("");
      toast.success("Đã cập nhật tên danh mục");
    } catch (error: unknown) {
      toast.error((error as { message?: string })?.message || "Lỗi cập nhật danh mục");
    } finally {
      setCatUpdating(false);
    }
  };

  const statusChips = [
    { key: "all", label: "Tất cả", count: entries.length },
    { key: "pending", label: "Đang xử lý" },
    { key: "done", label: "Đã xong" },
    { key: "cancelled", label: "Hủy" },
    { key: "other", label: "Khác" },
  ];

  return (
    <PageContainer
      title="Sổ tay"
      subtitle="Ghi chú, ghi nợ theo ngày"
      right={
        <div className="flex gap-1.5">
          <Button
            size="icon"
            variant="ghost"
            className="h-9 w-9 rounded-full"
            onClick={() => setShowCatMgr(true)}
          >
            <Settings2 className="h-4 w-4" />
          </Button>
          <Button size="sm" className="h-9 rounded-full gap-1" onClick={openCreateForm}>
            <Plus className="h-4 w-4" /> Thêm
          </Button>
        </div>
      }
    >
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-2.5 desktop:mx-auto desktop:w-full desktop:max-w-4xl desktop:grid-cols-4">
        <StatCard
          label="Đang xử lý"
          value={stats.pending.toLocaleString("vi-VN")}
          icon={CircleDashed}
          tone="warning"
          className="desktop:!p-2.5 desktop:[&>div:first-child>div:first-child]:!text-[10px] desktop:[&>div:first-child>div:last-child]:!h-6 desktop:[&>div:first-child>div:last-child]:!w-6 desktop:[&>div:first-child>div:last-child>svg]:!h-3 desktop:[&>div:first-child>div:last-child>svg]:!w-3 desktop:[&>div:nth-child(2)]:!mt-0.5 desktop:[&>div:nth-child(2)]:!text-lg"
        />
        <StatCard
          label="Đã xong"
          value={stats.done.toLocaleString("vi-VN")}
          icon={Check}
          tone="success"
          className="desktop:!p-2.5 desktop:[&>div:first-child>div:first-child]:!text-[10px] desktop:[&>div:first-child>div:last-child]:!h-6 desktop:[&>div:first-child>div:last-child]:!w-6 desktop:[&>div:first-child>div:last-child>svg]:!h-3 desktop:[&>div:first-child>div:last-child>svg]:!w-3 desktop:[&>div:nth-child(2)]:!mt-0.5 desktop:[&>div:nth-child(2)]:!text-lg"
        />
        <StatCard
          label="Hủy"
          value={stats.cancelled.toLocaleString("vi-VN")}
          icon={Ban}
          tone="danger"
          className="desktop:!p-2.5 desktop:[&>div:first-child>div:first-child]:!text-[10px] desktop:[&>div:first-child>div:last-child]:!h-6 desktop:[&>div:first-child>div:last-child]:!w-6 desktop:[&>div:first-child>div:last-child>svg]:!h-3 desktop:[&>div:first-child>div:last-child>svg]:!w-3 desktop:[&>div:nth-child(2)]:!mt-0.5 desktop:[&>div:nth-child(2)]:!text-lg"
        />
        <StatCard
          label="Khác"
          value={stats.other.toLocaleString("vi-VN")}
          icon={CircleHelp}
          tone="info"
          className="desktop:!p-2.5 desktop:[&>div:first-child>div:first-child]:!text-[10px] desktop:[&>div:first-child>div:last-child]:!h-6 desktop:[&>div:first-child>div:last-child]:!w-6 desktop:[&>div:first-child>div:last-child>svg]:!h-3 desktop:[&>div:first-child>div:last-child>svg]:!w-3 desktop:[&>div:nth-child(2)]:!mt-0.5 desktop:[&>div:nth-child(2)]:!text-lg"
        />
      </div>

      {/* Filters */}
      <FilterBar
        desktopSearchAfterChips
        search={search}
        onSearchChange={setSearch}
        placeholder="Tìm theo tên, ghi chú…"
        chips={statusChips}
        activeChip={statusTab}
        onChipChange={(k) => setStatusTab(k as StatusTab)}
      />

      {/* Date range + category filter */}
      <div className="flex flex-wrap gap-2">
        <Select
          value={catFilter || "__all__"}
          onValueChange={(v) => setCatFilter(v === "__all__" ? "" : v)}
        >
          <SelectTrigger className="h-9 w-auto min-w-[120px] rounded-full text-xs">
            <SelectValue placeholder="Danh mục" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Tất cả</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DateInput
          value={dateFrom}
          onChange={(v) => setDateFrom(v)}
          className="h-9 w-auto rounded-full text-xs"
          placeholder="Từ ngày"
        />
        <DateInput
          value={dateTo}
          onChange={(v) => setDateTo(v)}
          className="h-9 w-auto rounded-full text-xs"
          placeholder="Đến ngày"
        />
      </div>

      {/* Entry list */}
      {loading && entries.length > 0 && (
        <DataLoadingState variant="inline" label="Đang cập nhật sổ tay..." />
      )}
      {loading && entries.length === 0 ? (
        <DataLoadingState variant="list" label="Đang tải sổ tay..." rows={4} />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={BookOpenText}
          title="Chưa có ghi chú"
          description="Nhấn 'Thêm' để tạo ghi chú đầu tiên."
          action={
            <Button onClick={openCreateForm} size="sm" className="rounded-full gap-1">
              <Plus className="h-4 w-4" /> Thêm mới
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              onEdit={() => openEditForm(entry)}
              onStatusChange={(s) => updateStatus(entry, s)}
              onDelete={() => deleteEntry(entry)}
            />
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle>{editingEntry ? "Sửa ghi chú" : "Thêm ghi chú"}</DialogTitle>
            <DialogDescription>Nhập ít nhất 1 thông tin.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitEntry} className="space-y-3">
            <div>
              <Label className="text-xs">Ngày</Label>
              <DateInput value={fDate} onChange={(v) => setFDate(v)} />
            </div>
            <div>
              <Label className="text-xs">Danh mục</Label>
              <Select
                value={fCategory || "__none__"}
                onValueChange={(v) => setFCategory(v === "__none__" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Chọn danh mục" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Không chọn —</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {isStaffOrAdmin && (
              <div>
                <Label className="text-xs">Người lao động</Label>
                <WorkerSearchSelect workers={workers} value={fWorker} onChange={setFWorker} />
              </div>
            )}
            <div>
              <Label className="text-xs">
                {isStaffOrAdmin ? "Người khác (tự nhập)" : "Họ tên"}
              </Label>
              <Input
                value={fOtherPerson}
                onChange={(e) => setFOtherPerson(e.target.value)}
                placeholder="Nhập họ tên"
              />
            </div>
            <div>
              <Label className="text-xs">Số tiền</Label>
              <Input
                value={fAmount}
                onChange={(e) => setFAmount(formatMoneyInput(e.target.value))}
                inputMode="numeric"
                placeholder="0"
              />
            </div>
            <div>
              <Label className="text-xs">Ghi chú</Label>
              <Textarea
                value={fNote}
                onChange={(e) => setFNote(e.target.value)}
                placeholder="Nội dung ghi chú..."
                rows={3}
              />
            </div>
            <Button type="submit" className="w-full" disabled={sending}>
              {sending ? "Đang lưu..." : editingEntry ? "Cập nhật" : "Thêm mới"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Category Manager Dialog */}
      <Dialog open={showCatMgr} onOpenChange={setShowCatMgr}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle>Quản lý danh mục</DialogTitle>
            <DialogDescription>Tạo và xoá danh mục sổ tay.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder="Tên danh mục mới"
                className="flex-1"
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), createCategory())}
              />
              <Button
                size="sm"
                onClick={createCategory}
                disabled={catSending || !newCatName.trim()}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {categories.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Chưa có danh mục nào.
              </p>
            ) : (
              <div className="space-y-1">
                {categories.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between rounded-xl border border-border px-3 py-2"
                  >
                    <span className="text-sm">{c.name}</span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openCategoryEditor(c)}
                        className="text-muted-foreground transition hover:text-primary"
                        title={`Sửa tên danh mục ${c.name}`}
                        aria-label={`Sửa tên danh mục ${c.name}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteCategory(c)}
                        className="text-muted-foreground hover:text-destructive transition"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingCategory} onOpenChange={(open) => !open && closeCategoryEditor()}>
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Sửa tên danh mục</DialogTitle>
            <DialogDescription>Cập nhật tên danh mục.</DialogDescription>
          </DialogHeader>
          <form onSubmit={updateCategory} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="notebook-category-edit-name">Tên danh mục</Label>
              <Input
                id="notebook-category-edit-name"
                value={editingCatName}
                onChange={(event) => setEditingCatName(event.target.value)}
                placeholder="Tên danh mục"
                autoFocus
                required
                disabled={catUpdating}
              />
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={closeCategoryEditor}
                disabled={catUpdating}
              >
                Hủy
              </Button>
              <Button type="submit" disabled={catUpdating || !editingCatName.trim()}>
                {catUpdating ? "..." : "Cập nhật"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}

function EntryCard({
  entry,
  onEdit,
  onStatusChange,
  onDelete,
}: {
  entry: NotebookEntry;
  onEdit: () => void;
  onStatusChange: (s: EntryStatus) => void;
  onDelete: () => void;
}) {
  const catName = entry.expand?.category?.name;
  const workerName = entry.expand?.worker?.full_name || entry.expand?.worker?.username;
  const personLabel = workerName || entry.other_person;
  const dateStr = entry.date ? new Date(entry.date).toLocaleDateString("vi-VN") : "";

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-3 shadow-soft space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {personLabel && <div className="text-sm font-semibold truncate">{personLabel}</div>}
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            {dateStr && <span>{dateStr}</span>}
            {catName && (
              <>
                <span className="opacity-40">&bull;</span>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">
                  {catName}
                </span>
              </>
            )}
          </div>
        </div>
        {entry.amount > 0 && (
          <div className="shrink-0 text-sm font-semibold text-primary">
            {entry.amount.toLocaleString("vi-VN")}đ
          </div>
        )}
      </div>

      {entry.note && <p className="text-xs text-muted-foreground leading-relaxed">{entry.note}</p>}

      <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/40">
        <div className="flex gap-1 flex-wrap">
          {(["pending", "done", "cancelled", "other"] as EntryStatus[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onStatusChange(s)}
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-medium transition",
                entry.status === s
                  ? s === "done"
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                    : s === "cancelled"
                      ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                      : s === "pending"
                        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                        : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={onEdit}
            className="rounded-full p-1.5 text-muted-foreground hover:bg-muted transition"
          >
            <NotebookPen className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded-full p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function WorkerSearchSelect({
  workers,
  value,
  onChange,
}: {
  workers: UserRecord[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const selectedWorker = workers.find((w) => w.id === value);

  const filtered = useMemo(() => {
    if (!query.trim()) return workers;
    const q = query.toLowerCase();
    return workers.filter(
      (w) =>
        (w.full_name || "").toLowerCase().includes(q) ||
        (w.username || "").toLowerCase().includes(q),
    );
  }, [workers, query]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen(!open);
          setTimeout(() => inputRef.current?.focus(), 50);
        }}
        className="flex h-10 w-full items-center justify-between rounded-xl border border-border bg-card px-3 text-sm transition focus:border-primary focus:ring-2 focus:ring-primary/20"
      >
        <span className={selectedWorker ? "" : "text-muted-foreground"}>
          {selectedWorker ? selectedWorker.full_name || selectedWorker.username : "Chọn NLĐ"}
        </span>
        <svg
          className="h-4 w-4 text-muted-foreground"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-xl border border-border bg-card shadow-lg">
          <div className="p-2">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm tên lao động..."
              className="h-9 w-full rounded-lg border border-border bg-white px-3 text-sm text-slate-900 outline-none placeholder:text-slate-500 focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div className="max-h-48 overflow-y-auto px-1 pb-1">
            <button
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
                setQuery("");
              }}
              className="w-full rounded-lg px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted transition"
            >
              — Không chọn —
            </button>
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted-foreground">Không tìm thấy</p>
            ) : (
              filtered.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => {
                    onChange(w.id);
                    setOpen(false);
                    setQuery("");
                  }}
                  className={cn(
                    "w-full rounded-lg px-3 py-2 text-left text-sm transition",
                    w.id === value ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted",
                  )}
                >
                  {w.full_name || w.username}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
