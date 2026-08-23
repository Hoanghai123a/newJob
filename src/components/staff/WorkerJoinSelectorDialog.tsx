import { useMemo, useState } from "react";
import { RotateCcw, Search, UserRoundSearch } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DataLoadingState } from "@/components/ui/data-loading-state";
import { EmptyState } from "@/components/ui/empty-state";
import { FactoryPicker } from "@/components/workforce/UserPicker";
import {
  fetchEmploymentHistories,
  getLatestEmploymentHistory,
  isCurrentlyWorking,
  type EmploymentHistoryRecord,
} from "@/lib/employment";
import { escapePb, relationInFilter } from "@/lib/delegations";
import type { FactoryRecord } from "@/lib/factories";
import { pb, type UserRecord } from "@/lib/pocketbase";
import type { WorkerRecord } from "@/lib/workers";
import { toast } from "@/lib/toast";

const SOURCE_PAGE_SIZE = 50;
const RESULT_PAGE_SIZE = 20;
const MAX_SOURCE_PAGES_PER_LOAD = 3;
const FILTER_BATCH_SIZE = 40;

type WorkerJoinCandidate = {
  user: WorkerRecord;
  latest: EmploymentHistoryRecord;
};

function normalizeCode(value?: string) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("vi-VN");
}

function normalizeFullName(value?: string) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("vi-VN");
}

function formatDate(value?: string) {
  if (!value) return "—";
  const match = value.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function maskPhone(value?: string) {
  const phone = String(value || "").trim();
  if (!phone) return "—";
  if (phone.length <= 4) return "*".repeat(phone.length);
  return `${"*".repeat(Math.max(4, phone.length - 4))}${phone.slice(-4)}`;
}

async function fetchLatestHistories(userIds: string[]) {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  const historiesByUser = new Map<string, EmploymentHistoryRecord[]>();

  for (let index = 0; index < uniqueIds.length; index += FILTER_BATCH_SIZE) {
    const batch = uniqueIds.slice(index, index + FILTER_BATCH_SIZE);
    const histories = await pb
      .collection("employment_histories")
      .getFullList<EmploymentHistoryRecord>({
        filter: relationInFilter("worker", batch),
        sort: "-join_date,-created",
        fields: "id,user,factory,employee_code,join_date,leave_date,status,created,updated",
      });
    histories.forEach((history) => {
      const group = historiesByUser.get(history.worker) || [];
      group.push(history);
      historiesByUser.set(history.worker, group);
    });
  }

  const latestByUser = new Map<string, EmploymentHistoryRecord>();
  historiesByUser.forEach((histories, userId) => {
    const latest = getLatestEmploymentHistory(histories);
    if (latest) latestByUser.set(userId, latest);
  });
  return latestByUser;
}

async function fetchCandidateUsers(userIds: string[]) {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  const users: WorkerRecord[] = [];
  for (let index = 0; index < uniqueIds.length; index += FILTER_BATCH_SIZE) {
    const batch = uniqueIds.slice(index, index + FILTER_BATCH_SIZE);
    const rows = await pb.collection("workers").getFullList<WorkerRecord>({
      filter: relationInFilter("id", batch),
      sort: "full_name",
      fields: "id,full_name,phone,uid",
    });
    users.push(...rows);
  }
  return users;
}

export function WorkerJoinSelectorDialog({
  open,
  onOpenChange,
  viewer,
  factories,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  viewer: UserRecord | null;
  factories: FactoryRecord[];
  onSelect: (candidate: { user: WorkerRecord; histories: EmploymentHistoryRecord[] }) => void;
}) {
  const [employeeCode, setEmployeeCode] = useState("");
  const [fullName, setFullName] = useState("");
  const [factoryId, setFactoryId] = useState("");
  const [items, setItems] = useState<WorkerJoinCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [nextSourcePage, setNextSourcePage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const [selectingId, setSelectingId] = useState("");

  const searchFactories = useMemo(
    () => factories.filter((factory) => factory.status !== "inactive"),
    [factories],
  );
  const searchFactoryIds = useMemo(
    () => new Set(searchFactories.map((factory) => factory.id)),
    [searchFactories],
  );
  const hasFilter = Boolean(employeeCode.trim() || fullName.trim() || factoryId);

  const clearResults = () => {
    setItems([]);
    setHasSearched(false);
    setNextSourcePage(1);
    setHasMore(false);
    setError("");
  };

  const resetFilters = () => {
    setEmployeeCode("");
    setFullName("");
    setFactoryId("");
    clearResults();
  };

  const search = async (append = false) => {
    const code = normalizeCode(employeeCode);
    const name = normalizeFullName(fullName);
    const useNameFallback = !code && Boolean(name);
    if (!code && !name && !factoryId) {
      toast.warning("Nhập mã NV, họ tên hoặc chọn nhà máy");
      return;
    }
    if (useNameFallback && !factoryId) {
      toast.warning("Khi tìm theo họ tên, vui lòng chọn nhà máy");
      return;
    }
    if (!viewer?.id) return;

    if (append) setLoadingMore(true);
    else setLoading(true);
    setError("");
    if (!append) setHasSearched(true);

    try {
      if (useNameFallback) {
        let sourcePage = append ? nextSourcePage : 1;
        let sourceHasMore = true;
        let pagesScanned = 0;
        const candidateMap = new Map<string, WorkerJoinCandidate>(
          append ? items.map((item) => [item.user.id, item]) : [],
        );
        const initialCount = candidateMap.size;

        while (
          sourceHasMore &&
          pagesScanned < MAX_SOURCE_PAGES_PER_LOAD &&
          candidateMap.size - initialCount < RESULT_PAGE_SIZE
        ) {
          const response = await pb
            .collection("workers")
            .getList<WorkerRecord>(sourcePage, SOURCE_PAGE_SIZE, {
              filter: `full_name~"${escapePb(fullName.trim())}"`,
              sort: "full_name",
              fields: "id,full_name,phone,uid",
            });

          sourceHasMore = sourcePage < response.totalPages;
          sourcePage += 1;
          pagesScanned += 1;

          const exactUsers = response.items.filter(
            (user) => normalizeFullName(user.full_name) === name && !candidateMap.has(user.id),
          );
          if (!exactUsers.length) continue;

          const latestByUser = await fetchLatestHistories(exactUsers.map((user) => user.id));
          exactUsers.forEach((user) => {
            const latest = latestByUser.get(user.id);
            if (
              latest &&
              searchFactoryIds.has(latest.factory) &&
              latest.factory === factoryId &&
              !normalizeCode(latest.employee_code)
            ) {
              candidateMap.set(user.id, { user, latest });
            }
          });
        }

        setItems(
          [...candidateMap.values()].sort((left, right) =>
            (left.user.full_name || left.user.uid || "").localeCompare(
              right.user.full_name || right.user.uid || "",
              "vi",
            ),
          ),
        );
        setNextSourcePage(sourcePage);
        setHasMore(sourceHasMore);
        return;
      }

      const filters = [];
      // PocketBase's ~ operator narrows the query; exact matching is verified below.
      if (code) filters.push(`employee_code~"${escapePb(employeeCode.trim())}"`);
      if (factoryId) filters.push(`factory="${escapePb(factoryId)}"`);

      let sourcePage = append ? nextSourcePage : 1;
      let sourceHasMore = true;
      let pagesScanned = 0;
      const candidateMap = new Map<string, WorkerJoinCandidate>(
        append ? items.map((item) => [item.user.id, item]) : [],
      );
      const initialCount = candidateMap.size;

      while (
        sourceHasMore &&
        pagesScanned < MAX_SOURCE_PAGES_PER_LOAD &&
        candidateMap.size - initialCount < RESULT_PAGE_SIZE
      ) {
        const response = await pb
          .collection("employment_histories")
          .getList<EmploymentHistoryRecord>(sourcePage, SOURCE_PAGE_SIZE, {
            filter: filters.join(" && "),
            sort: "-join_date,-created",
            fields: "id,user,factory,employee_code,join_date,leave_date,status,created,updated",
          });

        sourceHasMore = sourcePage < response.totalPages;
        sourcePage += 1;
        pagesScanned += 1;

        const candidateUserIds = [
          ...new Set(
            response.items
              .map((history) => history.worker)
              .filter((userId) => userId && !candidateMap.has(userId)),
          ),
        ];
        if (!candidateUserIds.length) continue;

        const latestByUser = await fetchLatestHistories(candidateUserIds);
        const validLatest = [...latestByUser.values()].filter((latest) => {
          if (!searchFactoryIds.has(latest.factory)) return false;
          if (code && normalizeCode(latest.employee_code) !== code) return false;
          if (factoryId && latest.factory !== factoryId) return false;
          return true;
        });
        if (!validLatest.length) continue;

        const latestByUserId = new Map(validLatest.map((history) => [history.worker, history]));
        const users = await fetchCandidateUsers([...latestByUserId.keys()]);
        users.forEach((user) => {
          const latest = latestByUserId.get(user.id);
          if (latest) candidateMap.set(user.id, { user, latest });
        });
      }

      const nextItems = [...candidateMap.values()].sort((left, right) =>
        (left.user.full_name || left.user.uid || "").localeCompare(
          right.user.full_name || right.user.uid || "",
          "vi",
        ),
      );
      setItems(nextItems);
      setNextSourcePage(sourcePage);
      setHasMore(sourceHasMore);
    } catch (reason: unknown) {
      if (!append) setItems([]);
      setError(reason instanceof Error ? reason.message : "Không tìm được danh sách NLĐ");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const selectCandidate = async (item: WorkerJoinCandidate) => {
    if (selectingId) return;
    setSelectingId(item.user.id);
    try {
      const [user, histories] = await Promise.all([
        pb.collection("workers").getOne<WorkerRecord>(item.user.id),
        fetchEmploymentHistories([item.user.id]),
      ]);
      onSelect({ user, histories });
    } catch (reason: unknown) {
      toast.error(reason instanceof Error ? reason.message : "Không tải được hồ sơ NLĐ");
    } finally {
      setSelectingId("");
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) resetFilters();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-hidden rounded-2xl p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-4 py-4 pr-12 sm:px-5">
          <DialogTitle className="flex items-center gap-2">
            <UserRoundSearch className="h-5 w-5 text-primary" />
            Nối TN
          </DialogTitle>
          <DialogDescription>
            Tìm theo mã NV hoặc dùng họ tên khi lịch sử đi làm gần nhất chưa có mã NV.
          </DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-3 overflow-y-auto px-4 pb-5 sm:px-5">
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void search(false);
            }}
          >
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="space-y-1">
                <label className="text-xs font-medium">Mã NV</label>
                <Input
                  value={employeeCode}
                  onChange={(event) => {
                    setEmployeeCode(event.target.value);
                    clearResults();
                  }}
                  placeholder="Nhập đúng mã NV"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Họ tên</label>
                <Input
                  value={fullName}
                  disabled={Boolean(employeeCode.trim())}
                  onChange={(event) => {
                    setFullName(event.target.value);
                    clearResults();
                  }}
                  placeholder="Nhập đúng họ tên"
                />
                <p className="text-[11px] text-muted-foreground">
                  Dùng khi lịch sử gần nhất chưa có mã NV.
                </p>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Nhà máy</label>
                <FactoryPicker
                  factories={searchFactories}
                  value={factoryId}
                  onChange={(value) => {
                    setFactoryId(value);
                    clearResults();
                  }}
                  placeholder="Chọn nhà máy..."
                  allowClear
                />
              </div>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" className="gap-1.5" onClick={resetFilters}>
                <RotateCcw className="h-4 w-4" />
                Xóa lọc
              </Button>
              <Button type="submit" className="gap-1.5" disabled={!hasFilter || loading}>
                <Search className="h-4 w-4" />
                {loading ? "Đang tìm..." : "Tìm kiếm"}
              </Button>
            </div>
          </form>

          {loading ? (
            <DataLoadingState variant="list" label="Đang tìm NLĐ..." rows={4} />
          ) : error ? (
            <EmptyState
              icon={Search}
              title="Không tìm được danh sách NLĐ"
              description={error}
              action={
                <Button type="button" variant="outline" onClick={() => void search(false)}>
                  Thử lại
                </Button>
              }
            />
          ) : !hasSearched ? (
            <EmptyState
              icon={Search}
              title="Nhập điều kiện rồi bấm Tìm kiếm"
              description="Dữ liệu chỉ được tải khi tìm để tránh chậm khi số lượng NLĐ tăng lớn."
            />
          ) : items.length === 0 ? (
            <EmptyState
              icon={Search}
              title="Không tìm thấy NLĐ phù hợp"
              description="Mã NV, trạng thái chưa có mã và nhà máy đều được đối chiếu với lịch sử đi làm gần nhất."
              action={
                hasMore ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={loadingMore}
                    onClick={() => void search(true)}
                  >
                    {loadingMore ? "Đang tìm tiếp..." : "Tìm tiếp trong dữ liệu còn lại"}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="space-y-2">
              {items.map((item) => {
                const working = isCurrentlyWorking(item.latest);
                const factoryName =
                  factories.find((factory) => factory.id === item.latest.factory)?.name ||
                  "Chưa có nhà máy";
                return (
                  <button
                    key={item.user.id}
                    type="button"
                    disabled={working || Boolean(selectingId)}
                    onClick={() => void selectCandidate(item)}
                    className="w-full rounded-xl border border-border/70 bg-card p-3 text-left shadow-soft transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-65"
                  >
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">
                          {item.user.full_name || item.user.uid || "Người lao động"}
                        </div>
                        <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-3">
                          <span className="truncate">
                            Mã NV: {item.latest.employee_code || "—"}
                          </span>
                          <span className="truncate">Nhà máy: {factoryName}</span>
                          <span className="truncate">SĐT: {maskPhone(item.user.phone)}</span>
                          <span>Ngày vào: {formatDate(item.latest.join_date)}</span>
                          <span>
                            Ngày nghỉ: {working ? "Đang làm" : formatDate(item.latest.leave_date)}
                          </span>
                        </div>
                      </div>
                      {working ? (
                        <span className="shrink-0 rounded-full bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-800">
                          Đang làm, cần báo nghỉ
                        </span>
                      ) : (
                        <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-semibold text-emerald-800">
                          {selectingId === item.user.id ? "Đang mở..." : "Chọn"}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}

              {hasMore && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={loadingMore}
                  onClick={() => void search(true)}
                >
                  {loadingMore ? "Đang tải thêm..." : "Tải thêm kết quả"}
                </Button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
