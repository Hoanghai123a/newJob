import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  CheckCircle2,
  Circle,
  ClipboardList,
  Edit3,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
} from "lucide-react";
import { Cell, Pie, PieChart } from "recharts";
import { toast } from "@/lib/toast";
import { useAuth } from "@/lib/auth";
import {
  WORK_PROGRESS_COLLECTIONS,
  createWorkProgressStatus,
  createWorkProgressTab,
  createWorkProgressTask,
  deleteWorkProgressStatus,
  deleteWorkProgressTab,
  deleteWorkProgressTask,
  fetchWorkProgressData,
  subscribeWorkProgress,
  swapWorkProgressPositions,
  updateWorkProgressStatus,
  updateWorkProgressTab,
  updateWorkProgressTask,
  type WorkProgressData,
  type WorkProgressStatusRecord,
  type WorkProgressTabRecord,
  type WorkProgressTaskRecord,
} from "@/lib/work-progress";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";

const EMPTY_DATA: WorkProgressData = { tabs: [], statuses: [], tasks: [] };
const STATUS_COLORS = ["#0284c7", "#d97706", "#ea580c", "#c026d3", "#059669", "#0891b2"];

type EditorState =
  | { kind: "create-tab" }
  | { kind: "rename-tab"; record: WorkProgressTabRecord }
  | { kind: "create-status"; tab: WorkProgressTabRecord }
  | { kind: "rename-status"; record: WorkProgressStatusRecord }
  | { kind: "create-task"; tab: WorkProgressTabRecord }
  | { kind: "rename-task"; record: WorkProgressTaskRecord }
  | null;

type DeleteState =
  | { kind: "tab"; record: WorkProgressTabRecord; statusCount: number; taskCount: number }
  | { kind: "status"; record: WorkProgressStatusRecord }
  | { kind: "task"; record: WorkProgressTaskRecord }
  | null;

function sortByPosition<T extends { position: number; created: string }>(records: T[]) {
  return [...records].sort((a, b) => a.position - b.position || a.created.localeCompare(b.created));
}

function editorMeta(editor: NonNullable<EditorState>) {
  switch (editor.kind) {
    case "create-tab":
      return {
        title: "Thêm tab công việc",
        description: "Tạo nhóm công việc dùng chung cho tất cả Admin.",
        label: "Tên tab",
        placeholder: "Ví dụ: Công việc tuần này",
        maxLength: 80,
        initialValue: "",
      };
    case "rename-tab":
      return {
        title: "Đổi tên tab",
        description: "Tên mới sẽ hiển thị cho tất cả Admin.",
        label: "Tên tab",
        placeholder: "Nhập tên tab",
        maxLength: 80,
        initialValue: editor.record.name,
      };
    case "create-status":
      return {
        title: "Thêm trạng thái",
        description: `Thêm trạng thái vào tab “${editor.tab.name}”. Trạng thái cuối cùng được tính là hoàn thành.`,
        label: "Tên trạng thái",
        placeholder: "Ví dụ: Đang thực hiện",
        maxLength: 60,
        initialValue: "",
      };
    case "rename-status":
      return {
        title: "Đổi tên trạng thái",
        description: "Các công việc hiện tại vẫn giữ nguyên trạng thái.",
        label: "Tên trạng thái",
        placeholder: "Nhập tên trạng thái",
        maxLength: 60,
        initialValue: editor.record.name,
      };
    case "create-task":
      return {
        title: "Thêm công việc",
        description: `Công việc mới được đặt ở trạng thái đầu tiên của tab “${editor.tab.name}”.`,
        label: "Tên công việc",
        placeholder: "Nhập nội dung công việc",
        maxLength: 160,
        initialValue: "",
      };
    case "rename-task":
      return {
        title: "Đổi tên công việc",
        description: "Trạng thái hiện tại của công việc được giữ nguyên.",
        label: "Tên công việc",
        placeholder: "Nhập nội dung công việc",
        maxLength: 160,
        initialValue: editor.record.name,
      };
  }
}

export function WorkProgressBoard({ compact = false }: { compact?: boolean }) {
  const { user } = useAuth();
  const [data, setData] = useState<WorkProgressData>(EMPTY_DATA);
  const [activeTabId, setActiveTabId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [editor, setEditor] = useState<EditorState>(null);
  const [editorValue, setEditorValue] = useState("");
  const [deleteState, setDeleteState] = useState<DeleteState>(null);
  const [selectedChartStatusId, setSelectedChartStatusId] = useState("");
  const realtimeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      setData(await fetchWorkProgressData());
      setError("");
    } catch {
      setError(
        "Không tải được dữ liệu tiến độ. Hãy kiểm tra ba collection tiến độ trong PocketBase.",
      );
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void subscribeWorkProgress(() => {
      if (realtimeTimer.current) clearTimeout(realtimeTimer.current);
      realtimeTimer.current = setTimeout(() => void load(false), 150);
    })
      .then((stop) => (cancelled ? stop() : (unsubscribe = stop)))
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (realtimeTimer.current) clearTimeout(realtimeTimer.current);
      unsubscribe?.();
    };
  }, [load]);

  const tabs = useMemo(() => sortByPosition(data.tabs), [data.tabs]);
  useEffect(() => {
    if (!tabs.length) setActiveTabId("");
    else if (!tabs.some((tab) => tab.id === activeTabId)) setActiveTabId(tabs[0].id);
  }, [activeTabId, tabs]);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) || null;
  const statuses = useMemo(
    () => sortByPosition(data.statuses.filter((item) => item.tab === activeTabId)),
    [activeTabId, data.statuses],
  );
  const tasks = useMemo(
    () => sortByPosition(data.tasks.filter((item) => item.tab === activeTabId)),
    [activeTabId, data.tasks],
  );
  const finalStatus = statuses.at(-1) || null;
  const completedCount = finalStatus
    ? tasks.filter((task) => task.status === finalStatus.id).length
    : 0;
  const completionRate = tasks.length ? Math.round((completedCount / tasks.length) * 100) : 0;
  const chartRows = statuses.map((status, index) => ({
    id: status.id,
    name: status.name,
    value: tasks.filter((task) => task.status === status.id).length,
    color: STATUS_COLORS[index % STATUS_COLORS.length],
  }));
  const chartConfig = Object.fromEntries(
    chartRows.map((row) => [row.id, { label: row.name, color: row.color }]),
  ) satisfies ChartConfig;
  const selectedChartStatus = chartRows.find((row) => row.id === selectedChartStatusId) || null;
  const selectedChartTasks = selectedChartStatus
    ? tasks.filter((task) => task.status === selectedChartStatus.id)
    : [];

  const openEditor = (next: NonNullable<EditorState>) => {
    setEditor(next);
    setEditorValue(editorMeta(next).initialValue);
  };
  const runMutation = async (key: string, action: () => Promise<unknown>, success?: string) => {
    if (busyKey) return false;
    setBusyKey(key);
    try {
      await action();
      await load(false);
      if (success) toast.success(success);
      return true;
    } catch {
      toast.error("Không thể cập nhật dữ liệu. Vui lòng thử lại.");
      return false;
    } finally {
      setBusyKey("");
    }
  };

  const submitEditor = async () => {
    if (!editor || !user?.id) return;
    const value = editorValue.trim();
    if (!value) return toast.error("Vui lòng nhập đầy đủ tên");
    let action: () => Promise<unknown>;
    let message = "Đã cập nhật";
    switch (editor.kind) {
      case "create-tab":
        action = () => createWorkProgressTab(value, user.id);
        message = "Đã thêm tab công việc";
        break;
      case "rename-tab":
        action = () => updateWorkProgressTab(editor.record.id, { name: value });
        message = "Đã đổi tên tab";
        break;
      case "create-status":
        action = () => createWorkProgressStatus(editor.tab.id, value, user.id);
        message = "Đã thêm trạng thái";
        break;
      case "rename-status":
        action = () => updateWorkProgressStatus(editor.record.id, { name: value });
        message = "Đã đổi tên trạng thái";
        break;
      case "create-task": {
        if (!statuses[0])
          return toast.error("Hãy tạo ít nhất một trạng thái trước khi thêm công việc");
        action = () => createWorkProgressTask(editor.tab.id, statuses[0].id, value, user.id);
        message = "Đã thêm công việc";
        break;
      }
      case "rename-task":
        action = () => updateWorkProgressTask(editor.record.id, { name: value });
        message = "Đã đổi tên công việc";
        break;
    }
    if (await runMutation(`editor-${editor.kind}`, action, message)) setEditor(null);
  };

  const moveRecord = async (
    collection: (typeof WORK_PROGRESS_COLLECTIONS)[keyof typeof WORK_PROGRESS_COLLECTIONS],
    records: Array<{ id: string; position: number }>,
    id: string,
    direction: -1 | 1,
  ) => {
    const index = records.findIndex((record) => record.id === id);
    const adjacent = records[index + direction];
    if (index < 0 || !adjacent) return;
    await runMutation(`move-${id}`, () =>
      swapWorkProgressPositions(collection, records[index], adjacent),
    );
  };

  const requestStatusDelete = (record: WorkProgressStatusRecord) => {
    const count = tasks.filter((task) => task.status === record.id).length;
    if (count) return toast.error(`Không thể xóa: còn ${count} công việc đang ở trạng thái này`);
    setDeleteState({ kind: "status", record });
  };

  const confirmDelete = async () => {
    if (!deleteState) return;
    const current = deleteState;
    const action =
      current.kind === "tab"
        ? () => deleteWorkProgressTab(current.record.id)
        : current.kind === "status"
          ? () => deleteWorkProgressStatus(current.record.id)
          : () => deleteWorkProgressTask(current.record.id);
    const message =
      current.kind === "tab"
        ? "Đã xóa tab công việc"
        : current.kind === "status"
          ? "Đã xóa trạng thái"
          : "Đã xóa công việc";
    if (await runMutation(`delete-${current.record.id}`, action, message)) setDeleteState(null);
  };

  if (loading) return <BoardLoading />;
  if (error) return <BoardError message={error} onRetry={() => void load()} />;

  return (
    <>
      <section
        className={cn(
          "overflow-hidden rounded-3xl border border-border/70 bg-card shadow-soft",
          compact ? "p-4 desktop:p-5" : "p-4 desktop:p-6",
        )}
      >
        <div className="flex flex-col gap-4 border-b border-border/60 pb-4 desktop:flex-row desktop:items-center desktop:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-500/10 text-sky-600">
              <ClipboardList className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-base font-bold tracking-tight desktop:text-lg">
                Tiến độ công việc
              </h3>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground desktop:text-sm">
                Theo dõi công việc dùng chung và cập nhật trạng thái theo từng tab.
              </p>
            </div>
          </div>
          <Button size="sm" onClick={() => openEditor({ kind: "create-tab" })}>
            <Plus /> Thêm tab
          </Button>
        </div>

        {!tabs.length ? (
          <div className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/15 px-5 text-center">
            <ClipboardList className="mb-3 h-10 w-10 text-muted-foreground" />
            <h4 className="font-semibold">Chưa có tab công việc</h4>
            <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">
              Tạo tab đầu tiên, sau đó thêm các trạng thái và công việc cần theo dõi.
            </p>
            <Button className="mt-4" size="sm" onClick={() => openEditor({ kind: "create-tab" })}>
              <Plus /> Tạo tab đầu tiên
            </Button>
          </div>
        ) : (
          <div className="pt-4">
            <div className="flex items-center gap-2 overflow-x-auto pb-2">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTabId(tab.id)}
                  className={cn(
                    "min-h-10 shrink-0 rounded-xl border px-4 py-2 text-sm font-semibold transition",
                    tab.id === activeTabId
                      ? "border-primary bg-primary text-primary-foreground shadow-sm"
                      : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground",
                  )}
                >
                  {tab.name}
                </button>
              ))}
              <button
                type="button"
                onClick={() => openEditor({ kind: "create-tab" })}
                className="flex min-h-10 shrink-0 items-center gap-1 rounded-xl border border-dashed border-border px-3 text-xs font-medium text-muted-foreground hover:border-primary/50 hover:text-primary"
              >
                <Plus className="h-3.5 w-3.5" /> Thêm
              </button>
            </div>

            {activeTab && (
              <div className="mt-2 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-muted/35 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{activeTab.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {statuses.length} trạng thái · {tasks.length} công việc
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="shrink-0">
                        <Settings2 /> Quản lý tab
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuItem
                        onClick={() => openEditor({ kind: "rename-tab", record: activeTab })}
                      >
                        <Edit3 /> Đổi tên tab
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={tabs.findIndex((tab) => tab.id === activeTab.id) === 0}
                        onClick={() =>
                          void moveRecord(WORK_PROGRESS_COLLECTIONS.tabs, tabs, activeTab.id, -1)
                        }
                      >
                        <ArrowLeft /> Chuyển sang trái
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={
                          tabs.findIndex((tab) => tab.id === activeTab.id) === tabs.length - 1
                        }
                        onClick={() =>
                          void moveRecord(WORK_PROGRESS_COLLECTIONS.tabs, tabs, activeTab.id, 1)
                        }
                      >
                        <ArrowRight /> Chuyển sang phải
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() =>
                          setDeleteState({
                            kind: "tab",
                            record: activeTab,
                            statusCount: statuses.length,
                            taskCount: tasks.length,
                          })
                        }
                      >
                        <Trash2 /> Xóa tab
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="grid min-w-0 gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
                  <ProgressSummary
                    rows={chartRows}
                    config={chartConfig}
                    completed={completedCount}
                    total={tasks.length}
                    rate={completionRate}
                    onSelectStatus={setSelectedChartStatusId}
                  />
                  <StatusManager
                    statuses={statuses}
                    tasks={tasks}
                    busyKey={busyKey}
                    onAdd={() => openEditor({ kind: "create-status", tab: activeTab })}
                    onRename={(record) => openEditor({ kind: "rename-status", record })}
                    onDelete={requestStatusDelete}
                    onMove={(id, direction) =>
                      void moveRecord(WORK_PROGRESS_COLLECTIONS.statuses, statuses, id, direction)
                    }
                  />
                </div>

                <TaskList
                  tasks={tasks}
                  statuses={statuses}
                  busyKey={busyKey}
                  onAdd={() => openEditor({ kind: "create-task", tab: activeTab })}
                  onRename={(record) => openEditor({ kind: "rename-task", record })}
                  onDelete={(record) => setDeleteState({ kind: "task", record })}
                  onMove={(id, direction) =>
                    void moveRecord(WORK_PROGRESS_COLLECTIONS.tasks, tasks, id, direction)
                  }
                  onStatusChange={(task, statusId) =>
                    void runMutation(`status-${task.id}`, () =>
                      updateWorkProgressTask(task.id, { status: statusId }),
                    )
                  }
                />
              </div>
            )}
          </div>
        )}
      </section>
      <EditorDialog
        editor={editor}
        value={editorValue}
        busy={busyKey.startsWith("editor-")}
        onValueChange={setEditorValue}
        onOpenChange={(open) => !open && setEditor(null)}
        onSubmit={() => void submitEditor()}
      />
      <DeleteDialog
        state={deleteState}
        busy={busyKey.startsWith("delete-")}
        onOpenChange={(open) => !open && setDeleteState(null)}
        onConfirm={() => void confirmDelete()}
      />
      <StatusTasksDialog
        status={selectedChartStatus}
        tasks={selectedChartTasks}
        onOpenChange={(open) => !open && setSelectedChartStatusId("")}
      />
    </>
  );
}

function BoardLoading() {
  return (
    <section className="rounded-3xl border border-border/70 bg-card p-5 shadow-soft">
      <div className="mb-5 h-12 w-64 animate-pulse rounded-2xl bg-muted/60" />
      <div className="grid gap-4 desktop:grid-cols-[20rem_minmax(0,1fr)]">
        <div className="h-64 animate-pulse rounded-2xl bg-muted/50" />
        <div className="h-64 animate-pulse rounded-2xl bg-muted/50" />
      </div>
    </section>
  );
}

function BoardError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section className="rounded-3xl border border-destructive/30 bg-card p-5 shadow-soft">
      <div className="flex min-h-56 flex-col items-center justify-center text-center">
        <ClipboardList className="mb-3 h-9 w-9 text-destructive" />
        <h3 className="font-semibold">Chưa thể tải tiến độ công việc</h3>
        <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">{message}</p>
        <Button className="mt-4" size="sm" onClick={onRetry}>
          <RefreshCw /> Thử lại
        </Button>
      </div>
    </section>
  );
}

function ProgressSummary({
  rows,
  config,
  completed,
  total,
  rate,
  onSelectStatus,
}: {
  rows: Array<{ id: string; name: string; value: number; color: string }>;
  config: ChartConfig;
  completed: number;
  total: number;
  rate: number;
  onSelectStatus: (statusId: string) => void;
}) {
  return (
    <section className="min-w-0 max-w-full rounded-2xl border border-border/70 bg-background p-4">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold">Tổng quan tiến độ</h4>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {completed}/{total} công việc hoàn thành
          </p>
        </div>
        <span className="text-2xl font-bold tabular-nums text-primary">{rate}%</span>
      </div>
      <Progress value={rate} className="mt-3 h-2.5" />
      {!rows.length ? (
        <div className="flex h-48 items-center justify-center text-center text-sm text-muted-foreground">
          Thêm trạng thái để bắt đầu theo dõi.
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 justify-items-center gap-4 desktop:grid-cols-[9rem_minmax(0,1fr)] desktop:items-center desktop:justify-items-stretch desktop:gap-3">
          <ChartContainer config={config} className="h-36 w-36 max-w-full">
            <PieChart>
              <Pie
                data={rows}
                dataKey="value"
                nameKey="name"
                innerRadius={42}
                outerRadius={62}
                paddingAngle={rows.length > 1 ? 3 : 0}
                strokeWidth={0}
              >
                {rows.map((row) => (
                  <Cell
                    key={row.id}
                    fill={row.color}
                    className={row.value ? "cursor-pointer" : undefined}
                    role={row.value ? "button" : undefined}
                    aria-label={
                      row.value
                        ? `Xem ${row.value} công việc ở trạng thái ${row.name}`
                        : `${row.name}: chưa có công việc`
                    }
                    onClick={() => row.value > 0 && onSelectStatus(row.id)}
                  />
                ))}
              </Pie>
              <text
                x="50%"
                y="47%"
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-foreground text-xl font-bold"
              >
                {total}
              </text>
              <text
                x="50%"
                y="59%"
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-muted-foreground text-[10px]"
              >
                công việc
              </text>
            </PieChart>
          </ChartContainer>
          <div className="min-w-0 space-y-2">
            {rows.map((row) => (
              <div key={row.id} className="flex items-center gap-2 text-xs">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: row.color }}
                />
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{row.name}</span>
                <span className="font-semibold tabular-nums">{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function StatusTasksDialog({
  status,
  tasks,
  onOpenChange,
}: {
  status: { id: string; name: string; value: number; color: string } | null;
  tasks: WorkProgressTaskRecord[];
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={Boolean(status)} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl desktop:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: status?.color }} />
            Công việc theo tiến độ
          </DialogTitle>
          <DialogDescription>
            {status
              ? `${status.name}: ${tasks.length} công việc`
              : "Danh sách công việc theo trạng thái được chọn."}
          </DialogDescription>
        </DialogHeader>
        {status && tasks.length > 0 ? (
          <div className="max-h-[min(60vh,32rem)] space-y-2 overflow-y-auto pr-1">
            {tasks.map((task, index) => (
              <div
                key={task.id}
                className="flex min-w-0 items-center gap-3 rounded-xl border border-border/70 bg-muted/20 px-3 py-2.5"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-bold text-muted-foreground">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 break-words text-sm font-medium">{task.name}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex min-h-36 items-center justify-center rounded-2xl border border-dashed px-5 text-center text-sm leading-6 text-muted-foreground">
            Hiện không còn công việc ở trạng thái này.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StatusManager({
  statuses,
  tasks,
  busyKey,
  onAdd,
  onRename,
  onDelete,
  onMove,
}: {
  statuses: WorkProgressStatusRecord[];
  tasks: WorkProgressTaskRecord[];
  busyKey: string;
  onAdd: () => void;
  onRename: (record: WorkProgressStatusRecord) => void;
  onDelete: (record: WorkProgressStatusRecord) => void;
  onMove: (id: string, direction: -1 | 1) => void;
}) {
  return (
    <section className="min-w-0 max-w-full rounded-2xl border border-border/70 bg-background p-4">
      <div className="flex min-w-0 flex-col gap-3 desktop:flex-row desktop:items-center desktop:justify-between">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold">Các trạng thái</h4>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Trạng thái cuối cùng luôn được tính là hoàn thành.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={onAdd} className="w-full desktop:w-auto">
          <Plus /> Thêm trạng thái
        </Button>
      </div>
      {!statuses.length ? (
        <div className="mt-4 flex min-h-32 items-center justify-center rounded-xl border border-dashed px-4 text-center text-sm text-muted-foreground">
          Chưa có trạng thái. Hãy tạo trạng thái trước khi thêm công việc.
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {statuses.map((status, index) => {
            const count = tasks.filter((task) => task.status === status.id).length;
            return (
              <div
                key={status.id}
                className="flex min-h-12 min-w-0 flex-wrap items-center gap-2 rounded-xl border border-border/70 px-3 py-2"
              >
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ background: STATUS_COLORS[index % STATUS_COLORS.length] }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{status.name}</span>
                    {index === statuses.length - 1 && (
                      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                        Hoàn thành
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground">{count} công việc</div>
                </div>
                <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-0.5">
                  <IconButton
                    label="Đưa trạng thái lên"
                    disabled={index === 0 || busyKey === `move-${status.id}`}
                    onClick={() => onMove(status.id, -1)}
                  >
                    <ArrowUp />
                  </IconButton>
                  <IconButton
                    label="Đưa trạng thái xuống"
                    disabled={index === statuses.length - 1 || busyKey === `move-${status.id}`}
                    onClick={() => onMove(status.id, 1)}
                  >
                    <ArrowDown />
                  </IconButton>
                  <IconButton label="Đổi tên trạng thái" onClick={() => onRename(status)}>
                    <Edit3 />
                  </IconButton>
                  <IconButton label="Xóa trạng thái" destructive onClick={() => onDelete(status)}>
                    <Trash2 />
                  </IconButton>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function TaskList({
  tasks,
  statuses,
  busyKey,
  onAdd,
  onRename,
  onDelete,
  onMove,
  onStatusChange,
}: {
  tasks: WorkProgressTaskRecord[];
  statuses: WorkProgressStatusRecord[];
  busyKey: string;
  onAdd: () => void;
  onRename: (record: WorkProgressTaskRecord) => void;
  onDelete: (record: WorkProgressTaskRecord) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onStatusChange: (task: WorkProgressTaskRecord, statusId: string) => void;
}) {
  return (
    <section className="rounded-2xl border border-border/70 bg-background p-4">
      <div className="flex flex-col gap-3 desktop:flex-row desktop:items-center desktop:justify-between">
        <div>
          <h4 className="text-sm font-semibold">Danh sách công việc</h4>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Tick một trạng thái để cập nhật tiến độ của từng công việc.
          </p>
        </div>
        <Button size="sm" onClick={onAdd} disabled={!statuses.length}>
          <Plus /> Thêm công việc
        </Button>
      </div>
      {!statuses.length ? (
        <div className="mt-4 rounded-xl border border-amber-300/60 bg-amber-50 p-4 text-sm text-amber-900">
          Cần tạo ít nhất một trạng thái trước khi thêm công việc.
        </div>
      ) : !tasks.length ? (
        <div className="mt-4 flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed px-4 text-center">
          <CheckCircle2 className="mb-2 h-8 w-8 text-muted-foreground" />
          <div className="text-sm font-medium">Chưa có công việc</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Thêm công việc đầu tiên để bắt đầu cập nhật tiến độ.
          </div>
          <Button className="mt-3" size="sm" variant="outline" onClick={onAdd}>
            <Plus /> Thêm công việc
          </Button>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {tasks.map((task, taskIndex) => {
            const activeIndex = statuses.findIndex((status) => status.id === task.status);
            const completed = activeIndex === statuses.length - 1;
            return (
              <article
                key={task.id}
                className={cn(
                  "rounded-2xl border p-3 transition desktop:p-4",
                  completed ? "border-emerald-300/70 bg-emerald-50/45" : "border-border/70 bg-card",
                )}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-xs font-bold",
                      completed ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {completed ? <Check className="h-4 w-4" /> : taskIndex + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div
                      className={cn(
                        "text-sm font-semibold leading-6",
                        completed && "line-through opacity-75",
                      )}
                    >
                      {task.name}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {activeIndex >= 0
                        ? statuses[activeIndex].name
                        : "Trạng thái không còn tồn tại"}
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label="Tùy chọn công việc"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem onClick={() => onRename(task)}>
                        <Edit3 /> Đổi tên
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={taskIndex === 0}
                        onClick={() => onMove(task.id, -1)}
                      >
                        <ArrowUp /> Đưa lên
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={taskIndex === tasks.length - 1}
                        onClick={() => onMove(task.id, 1)}
                      >
                        <ArrowDown /> Đưa xuống
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => onDelete(task)}
                      >
                        <Trash2 /> Xóa công việc
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div
                  role="radiogroup"
                  aria-label={`Trạng thái của ${task.name}`}
                  className="mt-3 flex gap-2 overflow-x-auto pb-1"
                >
                  {statuses.map((status, index) => {
                    const checked = task.status === status.id;
                    return (
                      <button
                        key={status.id}
                        type="button"
                        role="radio"
                        aria-checked={checked}
                        disabled={Boolean(busyKey)}
                        onClick={() => onStatusChange(task, status.id)}
                        className={cn(
                          "flex min-h-10 shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition",
                          checked
                            ? "border-primary bg-primary/10 text-primary shadow-sm"
                            : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground",
                        )}
                      >
                        {checked ? (
                          <CheckCircle2 className="h-4 w-4" />
                        ) : (
                          <Circle className="h-4 w-4" />
                        )}
                        <span>{status.name}</span>
                        {index === statuses.length - 1 && (
                          <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">
                            Đích
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function IconButton({
  label,
  children,
  onClick,
  disabled,
  destructive = false,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-35",
        destructive && "hover:bg-destructive/10 hover:text-destructive",
      )}
    >
      {children}
    </button>
  );
}

function EditorDialog({
  editor,
  value,
  busy,
  onValueChange,
  onOpenChange,
  onSubmit,
}: {
  editor: EditorState;
  value: string;
  busy: boolean;
  onValueChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
}) {
  const meta = editor ? editorMeta(editor) : null;
  return (
    <Dialog open={Boolean(editor)} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl desktop:max-w-md">
        <DialogHeader>
          <DialogTitle>{meta?.title}</DialogTitle>
          <DialogDescription>{meta?.description}</DialogDescription>
        </DialogHeader>
        {meta && (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="work-progress-name">{meta.label}</Label>
              <Input
                id="work-progress-name"
                autoFocus
                value={value}
                maxLength={meta.maxLength}
                placeholder={meta.placeholder}
                onChange={(event) => onValueChange(event.target.value)}
              />
              <div className="text-right text-[11px] text-muted-foreground">
                {value.length}/{meta.maxLength}
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={busy}
              >
                Hủy
              </Button>
              <Button type="submit" disabled={busy || !value.trim()}>
                {busy ? "Đang lưu..." : "Lưu"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({
  state,
  busy,
  onOpenChange,
  onConfirm,
}: {
  state: DeleteState;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const title =
    state?.kind === "tab"
      ? "Xóa tab công việc?"
      : state?.kind === "status"
        ? "Xóa trạng thái?"
        : "Xóa công việc?";
  const description =
    state?.kind === "tab"
      ? `Tab “${state.record.name}” có ${state.statusCount} trạng thái và ${state.taskCount} công việc. Toàn bộ dữ liệu trong tab sẽ bị xóa và không thể khôi phục.`
      : state?.kind === "status"
        ? `Trạng thái “${state.record.name}” sẽ bị xóa và không thể khôi phục.`
        : state?.kind === "task"
          ? `Công việc “${state.record.name}” sẽ bị xóa và không thể khôi phục.`
          : "";
  return (
    <AlertDialog open={Boolean(state)} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Hủy</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {busy ? "Đang xóa..." : "Xóa"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
