import { createFileRoute, redirect } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  History,
  LayoutGrid,
  List,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Settings2,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { pb } from "@/lib/pocketbase";
import { useAuth } from "@/lib/auth";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataLoadingState } from "@/components/ui/data-loading-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/counter")({
  beforeLoad: () => {
    if (typeof window === "undefined") return;
    const record = pb.authStore.record as { role?: string } | null;
    if (!record) return;
    if (record.role !== "user" && record.role !== "staff") throw redirect({ to: "/" });
  },
  component: CounterPage,
});

type LayoutMode = "grid" | "list";
type SortMode = "none" | "score" | "name";
type CounterPerson = { id: string; name: string; score: number; hue: number; order: number };
type AdjustmentHistory = {
  type: "adjustment";
  id: string;
  personId: string;
  personName: string;
  delta: number;
  scoreBefore: number;
  scoreAfter: number;
  createdAt: number;
  updatedAt: number;
};
type ResetPersonHistory = {
  type: "reset-person";
  id: string;
  personId: string;
  personName: string;
  scoreBefore: number;
  scoreAfter: 0;
  createdAt: number;
  updatedAt: number;
};
type ResetAllHistory = {
  type: "reset-all";
  id: string;
  peopleCount: number;
  totalScoreBefore: number;
  createdAt: number;
  updatedAt: number;
};
type CounterHistory = AdjustmentHistory | ResetPersonHistory | ResetAllHistory;
type CounterState = {
  version: 1;
  initialized: true;
  people: CounterPerson[];
  layout: LayoutMode;
  sort: SortMode;
  history: CounterHistory[];
};
type ConfirmAction =
  | { type: "reset-person" | "delete-person"; personId: string }
  | { type: "reset-all" | "clear-history" }
  | null;

const STORAGE_PREFIX = "jobconnect:score-counter:v1:";
const MAX_HISTORY = 30;
const BATCH_WINDOW_MS = 2000;
const NAME_MAX_LENGTH = 60;

function createId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto)
    return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function createPerson(name: string, order: number): CounterPerson {
  return {
    id: createId("person"),
    name,
    score: 0,
    hue: Math.round((24 + order * 137.508) % 360),
    order,
  };
}
function createInitialState(): CounterState {
  return {
    version: 1,
    initialized: true,
    people: [createPerson("Người 1", 0), createPerson("Người 2", 1)],
    layout: "list",
    sort: "none",
    history: [],
  };
}
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function isValidPerson(value: unknown): value is CounterPerson {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    value.name.length <= NAME_MAX_LENGTH &&
    Number.isSafeInteger(value.score) &&
    Number.isFinite(value.hue) &&
    Number.isFinite(value.order)
  );
}
function isValidHistory(value: unknown): value is CounterHistory {
  if (
    !isObject(value) ||
    typeof value.id !== "string" ||
    typeof value.type !== "string" ||
    !Number.isFinite(value.createdAt) ||
    !Number.isFinite(value.updatedAt)
  )
    return false;
  if (value.type === "adjustment")
    return (
      typeof value.personId === "string" &&
      typeof value.personName === "string" &&
      Number.isSafeInteger(value.delta) &&
      Number.isSafeInteger(value.scoreBefore) &&
      Number.isSafeInteger(value.scoreAfter)
    );
  if (value.type === "reset-person")
    return (
      typeof value.personId === "string" &&
      typeof value.personName === "string" &&
      Number.isSafeInteger(value.scoreBefore) &&
      value.scoreAfter === 0
    );
  return (
    value.type === "reset-all" &&
    Number.isSafeInteger(value.peopleCount) &&
    Number.isSafeInteger(value.totalScoreBefore)
  );
}
function trimHistory(history: CounterHistory[]) {
  return [...history].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_HISTORY);
}
function loadState(userId: string): CounterState {
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${userId}`);
    if (!raw) return createInitialState();
    const parsed: unknown = JSON.parse(raw);
    if (
      !isObject(parsed) ||
      parsed.version !== 1 ||
      parsed.initialized !== true ||
      !Array.isArray(parsed.people) ||
      !parsed.people.every(isValidPerson)
    )
      return createInitialState();
    return {
      version: 1,
      initialized: true,
      people: parsed.people,
      layout: parsed.layout === "grid" ? "grid" : "list",
      sort: parsed.sort === "score" || parsed.sort === "name" ? parsed.sort : "none",
      history: trimHistory(
        Array.isArray(parsed.history) ? parsed.history.filter(isValidHistory) : [],
      ),
    };
  } catch {
    return createInitialState();
  }
}
function saveState(userId: string, state: CounterState) {
  window.localStorage.setItem(`${STORAGE_PREFIX}${userId}`, JSON.stringify(state));
}
function sortPeople(people: CounterPerson[], mode: SortMode) {
  return [...people].sort((a, b) => {
    if (mode === "score" && b.score !== a.score) return b.score - a.score;
    if (mode === "name") {
      const order = a.name.localeCompare(b.name, "vi", { sensitivity: "base" });
      if (order !== 0) return order;
    }
    return a.order - b.order;
  });
}
function mergeAdjustmentHistory(
  history: CounterHistory[],
  person: CounterPerson,
  delta: number,
  scoreBefore: number,
  scoreAfter: number,
  now: number,
) {
  const relevantIndex = history.findIndex(
    (entry) => entry.type === "reset-all" || ("personId" in entry && entry.personId === person.id),
  );
  const relevant = relevantIndex >= 0 ? history[relevantIndex] : null;
  if (relevant?.type === "adjustment" && now - relevant.updatedAt <= BATCH_WINDOW_MS) {
    const combinedDelta = relevant.delta + delta;
    if (combinedDelta === 0) return history.filter((_, index) => index !== relevantIndex);
    const updated: AdjustmentHistory = {
      ...relevant,
      personName: person.name,
      delta: combinedDelta,
      scoreAfter,
      updatedAt: now,
    };
    return trimHistory([updated, ...history.filter((_, index) => index !== relevantIndex)]);
  }
  return trimHistory([
    {
      type: "adjustment",
      id: createId("history"),
      personId: person.id,
      personName: person.name,
      delta,
      scoreBefore,
      scoreAfter,
      createdAt: now,
      updatedAt: now,
    },
    ...history,
  ]);
}
function formatSigned(value: number) {
  return value > 0 ? `+${value}` : String(value);
}
function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}
function CounterPage() {
  const { user } = useAuth();
  const storageUserId = user?.id ?? "guest";
  const [state, setState] = useState<CounterState | null>(null);
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null);
  const stateRef = useRef<CounterState | null>(null);
  const sortTimerRef = useRef<number | null>(null);
  const [displayIds, setDisplayIds] = useState<string[]>([]);
  const [sortPending, setSortPending] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [actionsPersonId, setActionsPersonId] = useState<string | null>(null);
  const [renamePersonId, setRenamePersonId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [quickPersonId, setQuickPersonId] = useState<string | null>(null);
  const [quickAmount, setQuickAmount] = useState("1");
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);

  const commit = useCallback((next: CounterState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    const loaded = loadState(storageUserId);
    stateRef.current = loaded;
    setState(loaded);
    setDisplayIds(sortPeople(loaded.people, loaded.sort).map((person) => person.id));
    setLoadedUserId(storageUserId);
  }, [storageUserId]);

  useEffect(() => {
    if (state && loadedUserId === storageUserId) saveState(storageUserId, state);
  }, [loadedUserId, state, storageUserId]);

  useEffect(
    () => () => {
      if (sortTimerRef.current !== null) window.clearTimeout(sortTimerRef.current);
    },
    [],
  );

  const scheduleScoreSort = useCallback((next: CounterState) => {
    if (sortTimerRef.current !== null) window.clearTimeout(sortTimerRef.current);
    if (next.sort !== "score") {
      setSortPending(false);
      return;
    }
    setSortPending(true);
    sortTimerRef.current = window.setTimeout(() => {
      const latest = stateRef.current;
      if (latest?.sort === "score")
        setDisplayIds(sortPeople(latest.people, "score").map((person) => person.id));
      setSortPending(false);
      sortTimerRef.current = null;
    }, BATCH_WINDOW_MS);
  }, []);

  const applyScoreDelta = useCallback(
    (personId: string, delta: number) => {
      const current = stateRef.current;
      if (!current || !Number.isSafeInteger(delta) || delta === 0) return;
      const person = current.people.find((item) => item.id === personId);
      if (!person) return;
      const scoreAfter = person.score + delta;
      if (!Number.isSafeInteger(scoreAfter)) return;
      const next: CounterState = {
        ...current,
        people: current.people.map((item) =>
          item.id === personId ? { ...item, score: scoreAfter } : item,
        ),
        history: mergeAdjustmentHistory(
          current.history,
          person,
          delta,
          person.score,
          scoreAfter,
          Date.now(),
        ),
      };
      commit(next);
      scheduleScoreSort(next);
    },
    [commit, scheduleScoreSort],
  );

  const addPerson = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const current = stateRef.current;
    const name = newName.trim();
    if (!current || !name) return;
    const nextOrder = current.people.reduce((max, person) => Math.max(max, person.order), -1) + 1;
    const next: CounterState = {
      ...current,
      people: [...current.people, createPerson(name.slice(0, NAME_MAX_LENGTH), nextOrder)],
    };
    commit(next);
    setDisplayIds(sortPeople(next.people, next.sort).map((person) => person.id));
    setNewName("");
    setAddOpen(false);
  };

  const savePersonName = () => {
    const current = stateRef.current;
    const person = current?.people.find((item) => item.id === renamePersonId);
    const name = editName.trim();
    if (!current || !person || !name) return;
    const next: CounterState = {
      ...current,
      people: current.people.map((item) =>
        item.id === person.id ? { ...item, name: name.slice(0, NAME_MAX_LENGTH) } : item,
      ),
    };
    commit(next);
    if (next.sort === "name")
      setDisplayIds(sortPeople(next.people, next.sort).map((item) => item.id));
    setRenamePersonId(null);
  };

  const resetPerson = (personId: string) => {
    const current = stateRef.current;
    const person = current?.people.find((item) => item.id === personId);
    if (!current || !person || person.score === 0) return;
    const now = Date.now();
    const next: CounterState = {
      ...current,
      people: current.people.map((item) => (item.id === personId ? { ...item, score: 0 } : item)),
      history: trimHistory([
        {
          type: "reset-person",
          id: createId("history"),
          personId,
          personName: person.name,
          scoreBefore: person.score,
          scoreAfter: 0,
          createdAt: now,
          updatedAt: now,
        },
        ...current.history,
      ]),
    };
    commit(next);
    scheduleScoreSort(next);
  };

  const deletePerson = (personId: string) => {
    const current = stateRef.current;
    if (!current) return;
    const next = { ...current, people: current.people.filter((person) => person.id !== personId) };
    commit(next);
    setDisplayIds((ids) => ids.filter((id) => id !== personId));
    setActionsPersonId(null);
  };

  const resetAll = () => {
    const current = stateRef.current;
    if (!current) return;
    const affected = current.people.filter((person) => person.score !== 0);
    if (affected.length === 0) return;
    const now = Date.now();
    const next: CounterState = {
      ...current,
      people: current.people.map((person) => ({ ...person, score: 0 })),
      history: trimHistory([
        {
          type: "reset-all",
          id: createId("history"),
          peopleCount: affected.length,
          totalScoreBefore: affected.reduce((sum, person) => sum + person.score, 0),
          createdAt: now,
          updatedAt: now,
        },
        ...current.history,
      ]),
    };
    commit(next);
    scheduleScoreSort(next);
  };

  const updatePreferences = (changes: Partial<Pick<CounterState, "layout" | "sort">>) => {
    const current = stateRef.current;
    if (!current) return;
    const next = { ...current, ...changes };
    commit(next);
    if (sortTimerRef.current !== null) window.clearTimeout(sortTimerRef.current);
    setSortPending(false);
    setDisplayIds(sortPeople(next.people, next.sort).map((person) => person.id));
  };

  const applyQuickAmount = (direction: 1 | -1) => {
    const amount = Number(quickAmount);
    if (!Number.isSafeInteger(amount) || amount <= 0 || !quickPersonId) return;
    applyScoreDelta(quickPersonId, direction * amount);
    setQuickPersonId(null);
    setQuickAmount("1");
  };

  const executeConfirm = () => {
    const action = confirmAction;
    setConfirmAction(null);
    if (!action) return;
    if (action.type === "reset-person") resetPerson(action.personId);
    else if (action.type === "delete-person") deletePerson(action.personId);
    else if (action.type === "reset-all") resetAll();
    else {
      const current = stateRef.current;
      if (current) commit({ ...current, history: [] });
    }
  };

  const actionsPerson = state?.people.find((person) => person.id === actionsPersonId) ?? null;
  const quickPerson = state?.people.find((person) => person.id === quickPersonId) ?? null;
  const visiblePeople = useMemo(() => {
    if (!state) return [];
    const byId = new Map(state.people.map((person) => [person.id, person]));
    const ordered = displayIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
    const missing = sortPeople(
      state.people.filter((person) => !displayIds.includes(person.id)),
      state.sort,
    );
    return [...ordered, ...missing];
  }, [displayIds, state]);

  if (!state)
    return (
      <PageContainer title="Bộ đếm" subtitle="Đang tải dữ liệu...">
        <DataLoadingState variant="list" label="Đang tải bộ đếm..." rows={3} />
      </PageContainer>
    );
  return (
    <PageContainer title="Bộ đếm" subtitle="Theo dõi điểm nhanh cho mọi người">
      <div className="space-y-4">
        <Card className="rounded-3xl p-3 shadow-soft">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
                <Users className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold">{state.people.length} người</div>
                <div className="text-xs text-muted-foreground">
                  Tổng điểm: {state.people.reduce((sum, person) => sum + person.score, 0)}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setAddOpen(true)}
                aria-label="Thêm người"
              >
                <UserPlus />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setHistoryOpen(true)}
                aria-label="Xem lịch sử"
              >
                <History />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setSettingsOpen(true)}
                aria-label="Cài đặt"
              >
                <Settings2 />
              </Button>
            </div>
          </div>
          {state.sort === "score" && sortPending && (
            <div className="mt-2 rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
              Thứ tự sẽ cập nhật sau khi bạn dừng bấm điểm 2 giây.
            </div>
          )}
        </Card>

        <div className={cn(state.layout === "grid" ? "grid grid-cols-2 gap-3" : "space-y-3")}>
          {visiblePeople.map((person) => (
            <PersonCard
              key={person.id}
              person={person}
              layout={state.layout}
              onMinus={() => applyScoreDelta(person.id, -1)}
              onPlus={() => applyScoreDelta(person.id, 1)}
              onScore={() => {
                setQuickPersonId(person.id);
                setQuickAmount("1");
              }}
              onName={() => {
                setRenamePersonId(person.id);
                setEditName(person.name);
              }}
              onActions={() => setActionsPersonId(person.id)}
            />
          ))}
        </div>

        {state.people.length === 0 && (
          <Card className="rounded-3xl border-dashed p-6 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
              <Users className="h-6 w-6" />
            </div>
            <div className="mt-3 text-sm font-semibold">Chưa có người nào</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Thêm người để bắt đầu đếm điểm.
            </div>
            <Button type="button" className="mt-4" onClick={() => setAddOpen(true)}>
              <UserPlus /> Thêm người
            </Button>
          </Card>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border bg-card p-3 shadow-soft">
          <div className="text-xs text-muted-foreground">
            {state.history.length}/{MAX_HISTORY} bản ghi lịch sử
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={state.people.every((person) => person.score === 0)}
            onClick={() => setConfirmAction({ type: "reset-all" })}
          >
            <RotateCcw /> Đặt lại tất cả
          </Button>
        </div>
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="rounded-3xl">
          <DialogHeader>
            <DialogTitle>Thêm người</DialogTitle>
            <DialogDescription>Người mới sẽ bắt đầu với 0 điểm.</DialogDescription>
          </DialogHeader>
          <form onSubmit={addPerson} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="counter-new-name">Họ và tên</Label>
              <Input
                id="counter-new-name"
                value={newName}
                maxLength={NAME_MAX_LENGTH}
                autoFocus
                onChange={(event) => setNewName(event.target.value)}
                placeholder="Ví dụ: Nguyễn Văn A"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                Hủy
              </Button>
              <Button type="submit" disabled={!newName.trim()}>
                Thêm người
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="rounded-3xl">
          <DialogHeader>
            <DialogTitle>Cài đặt bộ đếm</DialogTitle>
            <DialogDescription>Chọn cách hiển thị và sắp xếp danh sách.</DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            <SettingChoiceGroup
              label="Giao diện"
              options={[
                { value: "list" as const, label: "Card ngang", icon: List },
                { value: "grid" as const, label: "Ô vuông", icon: LayoutGrid },
              ]}
              value={state.layout}
              onChange={(layout) => updatePreferences({ layout })}
            />
            <SettingChoiceGroup
              label="Sắp xếp"
              options={[
                { value: "none" as const, label: "Không sắp xếp" },
                { value: "score" as const, label: "Theo điểm" },
                { value: "name" as const, label: "Theo tên" },
              ]}
              value={state.sort}
              onChange={(sort) => updatePreferences({ sort })}
            />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="rounded-3xl">
          <DialogHeader>
            <DialogTitle>Lịch sử điểm</DialogTitle>
            <DialogDescription>
              Tối đa {MAX_HISTORY} bản ghi gần nhất được lưu trên thiết bị.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[55dvh] space-y-2 overflow-y-auto pr-1">
            {state.history.length === 0 ? (
              <div className="rounded-2xl border border-dashed p-5 text-center text-sm text-muted-foreground">
                Chưa có lịch sử điểm.
              </div>
            ) : (
              state.history.map((entry) => (
                <div key={entry.id} className="rounded-2xl border bg-card p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">
                        {entry.type === "reset-all" ? "Tất cả người" : entry.personName}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {entry.type === "adjustment" && (
                          <>
                            {formatSigned(entry.delta)} điểm · {entry.scoreBefore} →{" "}
                            {entry.scoreAfter}
                          </>
                        )}
                        {entry.type === "reset-person" && (
                          <>Đặt lại điểm · {entry.scoreBefore} → 0</>
                        )}
                        {entry.type === "reset-all" && (
                          <>
                            Đặt lại {entry.peopleCount} người · tổng {entry.totalScoreBefore} → 0
                          </>
                        )}
                      </div>
                    </div>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {formatTime(entry.updatedAt)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="destructive"
              disabled={state.history.length === 0}
              onClick={() => setConfirmAction({ type: "clear-history" })}
            >
              <Trash2 /> Xóa lịch sử
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(renamePersonId)}
        onOpenChange={(open) => !open && setRenamePersonId(null)}
      >
        <DialogContent className="rounded-3xl">
          <DialogHeader>
            <DialogTitle>Đổi tên người chơi</DialogTitle>
            <DialogDescription>
              Chạm trực tiếp vào họ tên trên card để mở nhanh hộp thoại này.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              savePersonName();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="counter-edit-name">Họ và tên</Label>
              <Input
                id="counter-edit-name"
                value={editName}
                maxLength={NAME_MAX_LENGTH}
                autoFocus
                onChange={(event) => setEditName(event.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenamePersonId(null)}>
                Hủy
              </Button>
              <Button type="submit" disabled={!editName.trim()}>
                <Pencil /> Lưu tên
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(actionsPerson)}
        onOpenChange={(open) => !open && setActionsPersonId(null)}
      >
        <DialogContent className="rounded-3xl">
          <DialogHeader>
            <DialogTitle>Thao tác người chơi</DialogTitle>
            <DialogDescription>Reset điểm hoặc xóa người chơi khỏi danh sách.</DialogDescription>
          </DialogHeader>
          {actionsPerson && (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={actionsPerson.score === 0}
                onClick={() => {
                  setActionsPersonId(null);
                  setConfirmAction({ type: "reset-person", personId: actionsPerson.id });
                }}
              >
                <RotateCcw /> Reset ?i?m
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  setActionsPersonId(null);
                  setConfirmAction({ type: "delete-person", personId: actionsPerson.id });
                }}
              >
                <Trash2 /> X?a ng??i
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(quickPerson)} onOpenChange={(open) => !open && setQuickPersonId(null)}>
        <DialogContent className="rounded-3xl">
          <DialogHeader>
            <DialogTitle>Điều chỉnh điểm</DialogTitle>
            <DialogDescription>
              {quickPerson ? `Điều chỉnh nhanh cho ${quickPerson.name}.` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="counter-quick-amount">Số điểm</Label>
              <Input
                id="counter-quick-amount"
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                value={quickAmount}
                autoFocus
                onChange={(event) => setQuickAmount(event.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" onClick={() => applyQuickAmount(-1)}>
                − Trừ điểm
              </Button>
              <Button type="button" onClick={() => applyQuickAmount(1)}>
                + Cộng điểm
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirmAction !== null}
        onOpenChange={(open) => !open && setConfirmAction(null)}
      >
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmTitle(confirmAction)}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDescription(confirmAction, state)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Hủy</AlertDialogCancel>
            <AlertDialogAction onClick={executeConfirm}>Xác nhận</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}

function PersonCard({
  person,
  layout,
  onMinus,
  onPlus,
  onScore,
  onName,
  onActions,
}: {
  person: CounterPerson;
  layout: LayoutMode;
  onMinus: () => void;
  onPlus: () => void;
  onScore: () => void;
  onName: () => void;
  onActions: () => void;
}) {
  const accent = `hsl(${person.hue} 72% 45%)`;
  const tint = `hsl(${person.hue} 80% 94%)`;
  return (
    <Card
      className={cn(
        "relative flex overflow-hidden rounded-3xl border-l-4 bg-card p-3 shadow-soft",
        layout === "grid" ? "aspect-square flex-col" : "min-h-[8.5rem] flex-col",
      )}
      style={{ borderLeftColor: accent }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: accent }} />
          <button
            type="button"
            className="min-w-0 truncate rounded-lg px-1 text-left text-sm font-semibold transition hover:bg-muted active:scale-[0.98]"
            title={`Đổi tên ${person.name}`}
            onClick={onName}
          >
            {person.name}
          </button>
        </div>
        <button
          type="button"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-muted active:scale-95"
          onClick={onActions}
          aria-label={`Thao tác với ${person.name}`}
        >
          <MoreHorizontal className="h-5 w-5" />
        </button>
      </div>
      <div className="mt-auto flex items-center gap-2 pt-4">
        <button
          type="button"
          className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border bg-background text-xl font-semibold transition hover:bg-muted active:scale-95"
          onClick={onMinus}
          aria-label={`Trừ 1 điểm cho ${person.name}`}
        >
          −
        </button>
        <button
          type="button"
          className="flex min-w-0 flex-1 flex-col items-center justify-center rounded-2xl px-1 py-2 transition active:scale-95"
          style={{ backgroundColor: tint, color: accent }}
          onClick={onScore}
          aria-label={`Điểm của ${person.name}: ${person.score}. Chạm để điều chỉnh nhanh`}
        >
          <span className="text-3xl font-bold leading-none">{person.score}</span>
          <span className="mt-1 truncate text-[9px] font-medium uppercase tracking-wide opacity-75">
            Nhập nhanh
          </span>
        </button>
        <button
          type="button"
          className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border bg-background text-xl font-semibold transition hover:bg-muted active:scale-95"
          onClick={onPlus}
          aria-label={`Cộng 1 điểm cho ${person.name}`}
        >
          +
        </button>
      </div>
    </Card>
  );
}

function SettingChoiceGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ value: T; label: string; icon?: typeof List }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="grid grid-cols-2 gap-2">
        {options.map((option) => {
          const Icon = option.icon;
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              className={cn(
                "flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-medium transition active:scale-[0.98]",
                active ? "border-primary bg-primary/10 text-primary" : "bg-card hover:bg-muted",
              )}
            >
              {Icon && <Icon className="h-4 w-4" />}
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function confirmTitle(action: ConfirmAction) {
  if (action?.type === "delete-person") return "Xóa người này?";
  if (action?.type === "clear-history") return "Xóa lịch sử điểm?";
  if (action?.type === "reset-all") return "Đặt lại tất cả điểm?";
  return "Đặt lại điểm?";
}
function confirmDescription(action: ConfirmAction, state: CounterState) {
  if (action?.type === "delete-person")
    return "Người này sẽ bị xóa khỏi danh sách. Lịch sử cũ vẫn được giữ lại.";
  if (action?.type === "clear-history")
    return "Các bản ghi lịch sử hiện có sẽ bị xóa và không thể khôi phục.";
  if (action?.type === "reset-all")
    return "Điểm của tất cả người đang có điểm khác 0 sẽ được đưa về 0.";
  const person =
    action?.type === "reset-person"
      ? state.people.find((item) => item.id === action.personId)
      : null;
  return person ? `Điểm của ${person.name} sẽ được đưa về 0.` : "Điểm sẽ được đưa về 0.";
}
