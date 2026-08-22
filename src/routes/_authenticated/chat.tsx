import { createFileRoute, redirect } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pb, type UserRecord } from "@/lib/pocketbase";
import { useAuth } from "@/lib/auth";
import { useDebouncedSearch } from "@/hooks/use-debounced-search";
import { AppHeader } from "@/components/layout/BottomNav";
import { markSeen, getSeen } from "@/lib/seen";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { DataLoadingState } from "@/components/ui/data-loading-state";
import { StatusChip } from "@/components/ui/status-chip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/lib/toast";
import {
  Check,
  ChevronLeft,
  Clock3,
  MessageSquareText,
  Plus,
  Search,
  Send,
  ShieldCheck,
  SmilePlus,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ResponsiveOverlay } from "@/components/layout/ResponsiveOverlay";
import { companyFilter, companyPayload, joinTenantFilters } from "@/lib/tenant";

export const Route = createFileRoute("/_authenticated/chat")({
  beforeLoad: () => {
    throw redirect({ to: "/staff/workers" });
  },
  component: GroupChatPage,
});

type ChatUser = UserRecord & { chat_blocked?: boolean };

type ChatRoom = {
  id: string;
  tenant_company: string;
  name: string;
  description?: string;
  is_default?: boolean;
  created_by?: string;
  created?: string;
  updated?: string;
};

type ChatRoomMember = {
  id: string;
  tenant_company: string;
  room: string;
  user: string;
};

type JoinRequest = {
  id: string;
  tenant_company: string;
  room: string;
  user: string;
  status: "pending" | "approved" | "rejected";
  handled_by?: string;
  handled_at?: string;
  created?: string;
  expand?: {
    user?: ChatUser;
    room?: ChatRoom;
  };
};

type ChatMessage = {
  id: string;
  tenant_company: string;
  user: string;
  room?: string;
  content: string;
  created: string;
  expand?: { user?: ChatUser };
};

const PAGE_SIZE = 50;
const QUICK_EMOJIS = ["😀", "😂", "❤️", "👍", "🙏", "🎉", "😢", "😮", "🔥", "✅"];

function sortMessages(items: ChatMessage[]) {
  return [...items].sort((a, b) => new Date(a.created).getTime() - new Date(b.created).getTime());
}

function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  const map = new Map<string, ChatMessage>();
  for (const row of current) map.set(row.id, row);
  for (const row of incoming) map.set(row.id, row);
  return sortMessages(Array.from(map.values()));
}

function chatSeenScope(roomId: string) {
  return `chat:${roomId}`;
}
function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (message) return String(message);
  }
  return fallback;
}

function GroupChatPage() {
  const { user, isAdmin } = useAuth();
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [memberships, setMemberships] = useState<ChatRoomMember[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [meFresh, setMeFresh] = useState<ChatUser | null>(null);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedSearch(search);
  const [pendingRequests, setPendingRequests] = useState<JoinRequest[]>([]);
  const [myRequests, setMyRequests] = useState<JoinRequest[]>([]);
  const [showRequestsDialog, setShowRequestsDialog] = useState(false);
  const [selectedRequests, setSelectedRequests] = useState<Set<string>>(new Set());
  const [showRoomForm, setShowRoomForm] = useState<null | {
    mode: "create" | "edit";
    room?: ChatRoom;
  }>(null);
  const [roomForm, setRoomForm] = useState<{ name: string; description: string }>({
    name: "",
    description: "",
  });
  const metaRefreshInFlightRef = useRef(false);

  const activeRoom = useMemo(
    () => rooms.find((r) => r.id === activeRoomId) || null,
    [rooms, activeRoomId],
  );

  const myMemberRoomIds = useMemo(
    () => new Set(memberships.filter((m) => m.user === user?.id).map((m) => m.room)),
    [memberships, user?.id],
  );

  const myPendingRoomIds = useMemo(
    () =>
      new Set(
        myRequests.filter((r) => r.status === "pending" && r.user === user?.id).map((r) => r.room),
      ),
    [myRequests, user?.id],
  );

  const loadMe = useCallback(async () => {
    if (!user?.id) return;
    try {
      const mine = (await pb.collection("users").getOne(user.id)) as ChatUser;
      setMeFresh(mine);
    } catch {
      // ignore
    }
  }, [user?.id]);

  const loadRooms = useCallback(async () => {
    try {
      const res = await pb.collection("chat_rooms").getFullList({
        filter: companyFilter(user),
        sort: "-is_default,name",
      });
      setRooms(res as unknown as ChatRoom[]);
    } catch (error) {
      toast.error(getErrorMessage(error, "Lỗi tải danh sách phòng"));
    }
  }, [user]);

  const loadMemberships = useCallback(async () => {
    if (!user?.id) return;
    try {
      const filter = joinTenantFilters(user, !isAdmin && `user = "${user.id}"`);
      const res = await pb.collection("chat_room_members").getFullList({
        filter,
      });
      setMemberships(res as unknown as ChatRoomMember[]);
    } catch {
      // silent
    }
  }, [user?.id, isAdmin]);

  const loadJoinRequests = useCallback(async () => {
    if (!user?.id) return;
    try {
      if (isAdmin) {
        const res = await pb.collection("chat_join_requests").getFullList({
          filter: joinTenantFilters(user, 'status = "pending"'),
          sort: "-created",
          expand: "user,room",
        });
        setPendingRequests(res as unknown as JoinRequest[]);
      }
      const mine = await pb.collection("chat_join_requests").getFullList({
        filter: joinTenantFilters(user, `user = "${user.id}"`),
        sort: "-created",
      });
      setMyRequests(mine as unknown as JoinRequest[]);
    } catch {
      // silent
    }
  }, [user?.id, isAdmin]);

  const loadAll = useCallback(async () => {
    setRoomsLoading(true);
    try {
      await Promise.all([loadRooms(), loadMemberships(), loadJoinRequests(), loadMe()]);
    } finally {
      setRoomsLoading(false);
    }
  }, [loadRooms, loadMemberships, loadJoinRequests, loadMe]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    const refreshMeta = async () => {
      if (document.visibilityState !== "visible" || !window.navigator.onLine) return;
      if (metaRefreshInFlightRef.current) return;
      metaRefreshInFlightRef.current = true;
      try {
        await Promise.all([loadMemberships(), loadJoinRequests()]);
      } finally {
        metaRefreshInFlightRef.current = false;
      }
    };
    const timer = window.setInterval(() => void refreshMeta(), 5000);
    return () => window.clearInterval(timer);
  }, [loadMemberships, loadJoinRequests]);

  const visibleRooms = useMemo(() => {
    if (isAdmin) return rooms;
    return rooms.filter((r) => myMemberRoomIds.has(r.id));
  }, [rooms, myMemberRoomIds, isAdmin]);

  const searchResults = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return [];
    return rooms.filter(
      (r) =>
        !myMemberRoomIds.has(r.id) &&
        (r.name.toLowerCase().includes(q) || (r.description || "").toLowerCase().includes(q)),
    );
  }, [debouncedSearch, rooms, myMemberRoomIds]);

  const openRoom = (room: ChatRoom) => {
    setActiveRoomId(room.id);
  };

  const closeRoom = () => setActiveRoomId(null);

  const openCreateRoom = () => {
    setRoomForm({ name: "", description: "" });
    setShowRoomForm({ mode: "create" });
  };

  const openEditRoom = (room: ChatRoom) => {
    setRoomForm({ name: room.name, description: room.description || "" });
    setShowRoomForm({ mode: "edit", room });
  };

  const submitRoomForm = async () => {
    const name = roomForm.name.trim();
    if (!name) {
      toast.error("Tên phòng bắt buộc");
      return;
    }
    try {
      if (showRoomForm?.mode === "edit" && showRoomForm.room) {
        await pb.collection("chat_rooms").update(showRoomForm.room.id, {
          name,
          description: roomForm.description.trim(),
        });
        toast.success("Đã cập nhật phòng");
      } else {
        await pb.collection("chat_rooms").create({
          ...companyPayload(user),
          name,
          description: roomForm.description.trim(),
          is_default: false,
          created_by: user?.id || "",
        });
        toast.success("Đã tạo phòng mới");
      }
      setShowRoomForm(null);
      await loadRooms();
    } catch (error) {
      toast.error(getErrorMessage(error, "Lỗi lưu phòng"));
    }
  };

  const deleteRoom = async (room: ChatRoom) => {
    if (room.is_default) {
      toast.error("Không thể xoá nhóm mặc định");
      return;
    }
    if (!confirm(`Xoá phòng "${room.name}"? Tất cả tin nhắn sẽ bị mất.`)) return;
    try {
      await pb.collection("chat_rooms").delete(room.id);
      toast.success("Đã xoá phòng");
      setShowRoomForm(null);
      if (activeRoomId === room.id) setActiveRoomId(null);
      await loadAll();
    } catch (error) {
      toast.error(getErrorMessage(error, "Lỗi xoá phòng"));
    }
  };

  const requestJoin = async (room: ChatRoom) => {
    if (!user?.id) return;
    try {
      await pb.collection("chat_join_requests").create({
        ...companyPayload(user),
        room: room.id,
        user: user.id,
        status: "pending",
      });
      toast.success(`Đã gửi yêu cầu vào "${room.name}"`);
      setSearch("");
      await loadJoinRequests();
    } catch (error) {
      toast.error(getErrorMessage(error, "Lỗi gửi yêu cầu"));
    }
  };

  const toggleRequestSelected = (id: string) => {
    setSelectedRequests((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleRequests = async (approve: boolean) => {
    if (!selectedRequests.size) return;
    const ids = Array.from(selectedRequests);
    try {
      for (const id of ids) {
        const req = pendingRequests.find((r) => r.id === id);
        if (!req) continue;
        await pb.collection("chat_join_requests").update(id, {
          status: approve ? "approved" : "rejected",
          handled_by: user?.id || "",
          handled_at: new Date().toISOString().replace("T", " ").slice(0, 19),
        });
        if (approve) {
          const already = memberships.find((m) => m.room === req.room && m.user === req.user);
          if (!already) {
            await pb.collection("chat_room_members").create({
              ...companyPayload(user),
              room: req.room,
              user: req.user,
            });
          }
        }
      }
      toast.success(approve ? "Đã duyệt" : "Đã từ chối");
      setSelectedRequests(new Set());
      await Promise.all([loadJoinRequests(), loadMemberships()]);
    } catch (error) {
      toast.error(getErrorMessage(error, "Lỗi xử lý yêu cầu"));
    }
  };

  if (activeRoom) {
    return (
      <RoomChatView
        room={activeRoom}
        user={user}
        meFresh={meFresh}
        isAdmin={isAdmin}
        onBack={closeRoom}
        onRefreshMe={loadMe}
      />
    );
  }

  const pendingCount = pendingRequests.length;

  return (
    <div className="pb-nav">
      <AppHeader
        title="Trò chuyện"
        subtitle={
          roomsLoading
            ? "Đang tải..."
            : `${visibleRooms.length} phòng${isAdmin && pendingCount ? ` · ${pendingCount} yêu cầu` : ""}`
        }
        right={
          isAdmin ? (
            <button
              onClick={openCreateRoom}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm active:scale-95"
              aria-label="Tạo phòng"
            >
              <Plus className="h-4 w-4" />
            </button>
          ) : null
        }
      />
      <div className="space-y-3 px-3 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Tìm phòng chat để xin tham gia..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-2xl pl-10"
          />
        </div>

        {search.trim() && (
          <Card className="space-y-2 rounded-2xl p-3">
            <div className="text-xs font-semibold text-muted-foreground">
              Kết quả tìm kiếm ({searchResults.length})
            </div>
            {searchResults.length === 0 ? (
              <div className="text-xs text-muted-foreground">Không có phòng phù hợp</div>
            ) : (
              searchResults.map((room) => {
                const pending = myPendingRoomIds.has(room.id);
                return (
                  <div
                    key={room.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-card px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{room.name}</div>
                      {room.description && (
                        <div className="truncate text-[11px] text-muted-foreground">
                          {room.description}
                        </div>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant={pending ? "outline" : "default"}
                      disabled={pending}
                      onClick={() => void requestJoin(room)}
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      {pending ? "Đã gửi" : "Xin vào"}
                    </Button>
                  </div>
                );
              })
            )}
          </Card>
        )}

        {isAdmin && pendingCount > 0 && (
          <button
            type="button"
            onClick={() => {
              setSelectedRequests(new Set());
              setShowRequestsDialog(true);
            }}
            className="flex w-full items-center justify-between gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-left shadow-sm active:scale-[0.99]"
          >
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500 text-white">
                <UserPlus className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-semibold text-amber-900">Yêu cầu tham gia</div>
                <div className="text-[11px] text-amber-800">
                  {pendingCount} yêu cầu đang chờ duyệt
                </div>
              </div>
            </div>
            <StatusChip tone="warning">{pendingCount}</StatusChip>
          </button>
        )}

        {roomsLoading ? (
          <DataLoadingState variant="list" label="Đang tải danh sách phòng chat..." rows={3} />
        ) : visibleRooms.length === 0 ? (
          <EmptyState
            icon={MessageSquareText}
            title="Chưa có phòng nào"
            description={
              isAdmin
                ? "Bấm nút + để tạo phòng chat mới."
                : "Tìm phòng chat phía trên để xin tham gia."
            }
          />
        ) : (
          <div className="space-y-2">
            {visibleRooms.map((room) => (
              <RoomListItem
                key={room.id}
                room={room}
                userId={user?.id}
                isAdmin={isAdmin}
                onOpen={() => openRoom(room)}
                onEdit={() => openEditRoom(room)}
              />
            ))}
          </div>
        )}
      </div>

      <ResponsiveOverlay
        open={showRoomForm !== null}
        onOpenChange={(open) => !open && setShowRoomForm(null)}
        title={showRoomForm?.mode === "edit" ? "Sửa phòng chat" : "Tạo phòng chat"}
        description="Đặt tên và mô tả ngắn để người dùng dễ tìm phòng."
      >
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium">Tên phòng *</label>
            <Input
              value={roomForm.name}
              onChange={(e) => setRoomForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="VD: Thông báo, Nhà xưởng A..."
              className="mt-1"
            />
          </div>
          <div>
            <label className="text-xs font-medium">Mô tả</label>
            <Textarea
              value={roomForm.description}
              onChange={(e) => setRoomForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Mô tả ngắn về phòng này..."
              rows={3}
              className="mt-1 rounded-xl"
            />
          </div>
        </div>
        <DialogFooter>
          {showRoomForm?.mode === "edit" && showRoomForm.room && !showRoomForm.room.is_default && (
            <Button
              variant="destructive"
              onClick={() => showRoomForm.room && void deleteRoom(showRoomForm.room)}
              className="sm:mr-auto"
            >
              <Trash2 className="h-4 w-4" />
              Xoá phòng
            </Button>
          )}
          <Button variant="outline" onClick={() => setShowRoomForm(null)}>
            Huỷ
          </Button>
          <Button onClick={() => void submitRoomForm()}>
            <Check className="h-4 w-4" />
            Lưu
          </Button>
        </DialogFooter>
      </ResponsiveOverlay>

      <ResponsiveOverlay
        open={showRequestsDialog}
        onOpenChange={(open) => !open && setShowRequestsDialog(false)}
        title="Yêu cầu tham gia phòng"
        description="Chọn nhiều yêu cầu để duyệt hoặc từ chối cùng lúc."
        presentation="full"
      >
        {pendingRequests.length === 0 ? (
          <EmptyState
            icon={UserPlus}
            title="Không có yêu cầu"
            description="Tất cả yêu cầu đã được xử lý."
          />
        ) : (
          <>
            <label className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
              <Checkbox
                checked={
                  selectedRequests.size === pendingRequests.length && pendingRequests.length > 0
                }
                onCheckedChange={(c) =>
                  setSelectedRequests(c ? new Set(pendingRequests.map((r) => r.id)) : new Set())
                }
              />
              Chọn tất cả ({pendingRequests.length})
            </label>

            <div className="space-y-2">
              {pendingRequests.map((req) => {
                const u = req.expand?.user;
                const room = req.expand?.room;
                return (
                  <label
                    key={req.id}
                    className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-card px-3 py-2 shadow-sm"
                  >
                    <Checkbox
                      checked={selectedRequests.has(req.id)}
                      onCheckedChange={() => toggleRequestSelected(req.id)}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">
                        {u?.full_name || u?.username || "Ẩn danh"}
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        Xin vào: <span className="font-medium">{room?.name || "?"}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <StatusChip tone="warning">Chờ duyệt</StatusChip>
                        {req.created && (
                          <StatusChip tone="neutral">
                            {new Date(req.created).toLocaleDateString("vi-VN")}
                          </StatusChip>
                        )}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>

            {selectedRequests.size > 0 && (
              <div className="flex items-center justify-between gap-2 rounded-xl bg-primary/10 px-3 py-2">
                <span className="text-xs font-medium text-primary">
                  {selectedRequests.size} đã chọn
                </span>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => void handleRequests(true)}>
                    <Check className="h-3.5 w-3.5" /> Duyệt
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => void handleRequests(false)}
                  >
                    <X className="h-3.5 w-3.5" /> Từ chối
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </ResponsiveOverlay>
    </div>
  );
}

function RoomListItem({
  room,
  userId,
  isAdmin,
  onOpen,
  onEdit,
}: {
  room: ChatRoom;
  userId?: string;
  isAdmin: boolean;
  onOpen: () => void;
  onEdit: () => void;
}) {
  const [lastMessage, setLastMessage] = useState<ChatMessage | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const pressTimerRef = useRef<number | null>(null);
  const previewInFlightRef = useRef(false);

  const loadPreview = useCallback(async () => {
    if (previewInFlightRef.current) return;
    previewInFlightRef.current = true;
    try {
      const res = await pb.collection("group_chat_messages").getList(1, 1, {
        filter: joinTenantFilters(user, `room = "${room.id}"`),
        sort: "-created",
        expand: "user",
      });
      const items = (res.items as unknown as ChatMessage[]) || [];
      setLastMessage(items[0] || null);

      if (userId) {
        const seen = getSeen(chatSeenScope(room.id), userId);
        const seenIso = seen ? new Date(seen).toISOString().replace("T", " ") : "";
        const countRes = await pb.collection("group_chat_messages").getList(1, 1, {
          filter: joinTenantFilters(
            user,
            seenIso
              ? `room = "${room.id}" && created > "${seenIso}" && user != "${userId}"`
              : `room = "${room.id}" && user != "${userId}"`,
          ),
        });
        setUnreadCount(countRes.totalItems || 0);
      }
    } catch {
      // silent
    } finally {
      previewInFlightRef.current = false;
    }
  }, [room.id, userId]);

  useEffect(() => {
    const refreshPreview = () => {
      if (document.visibilityState === "visible" && window.navigator.onLine) void loadPreview();
    };
    refreshPreview();
    const timer = window.setInterval(refreshPreview, 5000);
    return () => window.clearInterval(timer);
  }, [loadPreview]);

  const startPress = () => {
    if (!isAdmin) return;
    if (pressTimerRef.current) window.clearTimeout(pressTimerRef.current);
    pressTimerRef.current = window.setTimeout(() => {
      onEdit();
    }, 520);
  };

  const stopPress = () => {
    if (!pressTimerRef.current) return;
    window.clearTimeout(pressTimerRef.current);
    pressTimerRef.current = null;
  };

  return (
    <button
      type="button"
      onClick={onOpen}
      onPointerDown={startPress}
      onPointerUp={stopPress}
      onPointerCancel={stopPress}
      onPointerLeave={stopPress}
      onContextMenu={(e) => {
        if (!isAdmin) return;
        e.preventDefault();
        onEdit();
      }}
      className="flex w-full items-start gap-3 rounded-2xl border border-border/60 bg-card px-3 py-3 text-left shadow-sm transition active:scale-[0.99]"
    >
      <div
        className={cn(
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-primary-foreground shadow-sm",
          room.is_default ? "bg-primary" : "bg-accent-foreground/80",
        )}
      >
        <Users className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold">{room.name}</span>
          {room.is_default && (
            <StatusChip tone="info" className="h-5 px-1.5 text-[10px]">
              Mặc định
            </StatusChip>
          )}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {lastMessage
            ? `${lastMessage.expand?.user?.full_name || lastMessage.expand?.user?.username || "Ai đó"}: ${lastMessage.content}`
            : room.description || "Chưa có tin nhắn"}
        </div>
      </div>
      {unreadCount > 0 && (
        <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-sm">
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      )}
    </button>
  );
}

function RoomChatView({
  room,
  user,
  meFresh,
  isAdmin,
  onBack,
  onRefreshMe,
}: {
  room: ChatRoom;
  user: UserRecord | null;
  meFresh: ChatUser | null;
  isAdmin: boolean;
  onBack: () => void;
  onRefreshMe: () => Promise<void>;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [content, setContent] = useState("");
  const [showEmojis, setShowEmojis] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sending, setSending] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [actionMessage, setActionMessage] = useState<ChatMessage | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const pressTimerRef = useRef<number | null>(null);
  const pageRef = useRef(1);
  const latestPageIdsRef = useRef<Set<string>>(new Set());
  const refreshInFlightRef = useRef(false);

  const fetchMessagePage = useCallback(
    async (pageNo: number) => {
      const res = await pb.collection("group_chat_messages").getList(pageNo, PAGE_SIZE, {
        filter: joinTenantFilters(user, `room = "${room.id}"`),
        sort: "-created",
        expand: "user",
      });
      return {
        items: ((res.items as unknown as ChatMessage[]) || []).reverse(),
        totalItems: res.totalItems || 0,
        totalPages: res.totalPages || 1,
      };
    },
    [room.id],
  );

  const loadInitial = useCallback(async () => {
    setLoading(true);
    try {
      const pageData = await fetchMessagePage(1);
      await onRefreshMe();
      setMessages(pageData.items);
      setTotalCount(pageData.totalItems);
      setHasMore(pageData.totalPages > 1);
      setPage(1);
      pageRef.current = 1;
      const latest = pageData.items[pageData.items.length - 1];
      markSeen(
        chatSeenScope(room.id),
        user?.id,
        latest ? new Date(latest.created).getTime() : Date.now(),
      );
      window.setTimeout(() => endRef.current?.scrollIntoView({ behavior: "auto" }), 0);
    } catch (error) {
      toast.error(getErrorMessage(error, "Lỗi tải trò chuyện"));
    } finally {
      setLoading(false);
    }
  }, [fetchMessagePage, onRefreshMe, room.id, user?.id]);

  const refreshLatest = useCallback(async () => {
    if (refreshInFlightRef.current) return;
    if (document.visibilityState !== "visible" || !window.navigator.onLine) return;
    refreshInFlightRef.current = true;
    try {
      const pageData = await fetchMessagePage(1);
      setTotalCount(pageData.totalItems);
      setHasMore(pageRef.current < pageData.totalPages);
      latestPageIdsRef.current = new Set(pageData.items.map((item) => item.id));
      setMessages((current) =>
        pageRef.current <= 1 ? pageData.items : mergeMessages(current, pageData.items),
      );
      const latest = pageData.items[pageData.items.length - 1];
      if (latest) {
        markSeen(chatSeenScope(room.id), user?.id, new Date(latest.created).getTime());
      }
    } catch {
      // silent polling
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [fetchMessagePage, room.id, user?.id]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  useEffect(() => {
    const refresh = () => void refreshLatest();
    const timer = window.setInterval(refresh, 3000);
    return () => window.clearInterval(timer);
  }, [refreshLatest]);

  const loadOlder = async () => {
    if (!hasMore || loadingOlder) return;
    const box = scrollRef.current;
    const previousHeight = box?.scrollHeight || 0;
    const nextPage = page + 1;
    setLoadingOlder(true);
    try {
      const pageData = await fetchMessagePage(nextPage);
      setMessages((current) => mergeMessages(pageData.items, current));
      setPage(nextPage);
      pageRef.current = nextPage;
      setHasMore(nextPage < pageData.totalPages);
      window.setTimeout(() => {
        if (!box) return;
        box.scrollTop = box.scrollHeight - previousHeight;
      }, 0);
    } catch (error) {
      toast.error(getErrorMessage(error, "Không tải được tin nhắn cũ"));
    } finally {
      setLoadingOlder(false);
    }
  };

  const onScrollMessages = () => {
    if ((scrollRef.current?.scrollTop || 0) <= 16) {
      void loadOlder();
    }
  };

  const blocked = !!meFresh?.chat_blocked;
  const stats = useMemo(
    () => ({
      total: totalCount || messages.length,
      loaded: messages.length,
    }),
    [messages.length, totalCount],
  );

  const send = async () => {
    const text = content.trim();
    if (!text) {
      toast.error("Nội dung không được để trống");
      return;
    }
    if (!user?.id) return;
    if (!isAdmin && blocked) {
      toast.error("Bạn đang bị chặn trong trò chuyện");
      return;
    }

    setSending(true);
    try {
      await pb.collection("group_chat_messages").create({
        ...companyPayload(user),
        user: user.id,
        room: room.id,
        content: text,
      });
      setContent("");
      setShowEmojis(false);
      await refreshLatest();
      window.setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 0);
    } catch (error) {
      toast.error(getErrorMessage(error, "Lỗi gửi tin nhắn"));
    } finally {
      setSending(false);
    }
  };

  const appendEmoji = (emoji: string) => {
    setContent((current) => `${current}${emoji}`);
    inputRef.current?.focus();
  };

  const deleteMessage = async (id: string) => {
    if (!confirm("Xoá tin nhắn này?")) return;
    try {
      await pb.collection("group_chat_messages").delete(id);
      setActionMessage(null);
      await refreshLatest();
      setMessages((current) => current.filter((row) => row.id !== id));
    } catch (error) {
      toast.error(getErrorMessage(error, "Lỗi xoá tin nhắn"));
    }
  };

  const toggleBlock = async (target: ChatUser) => {
    try {
      await pb.collection("users").update(target.id, { chat_blocked: !target.chat_blocked });
      toast.success(target.chat_blocked ? "Đã bỏ chặn" : "Đã chặn");
      setActionMessage(null);
      await refreshLatest();
    } catch (error) {
      toast.error(getErrorMessage(error, "Lỗi chặn user"));
    }
  };

  const startPress = (message: ChatMessage) => {
    if (!isAdmin) return;
    if (pressTimerRef.current) window.clearTimeout(pressTimerRef.current);
    pressTimerRef.current = window.setTimeout(() => setActionMessage(message), 520);
  };

  const stopPress = () => {
    if (!pressTimerRef.current) return;
    window.clearTimeout(pressTimerRef.current);
    pressTimerRef.current = null;
  };

  const titleBadge = isAdmin ? "Admin" : blocked ? "Đang bị chặn" : "Hoạt động";

  return (
    <div
      className="flex min-h-0 flex-col overflow-hidden"
      style={{ height: "calc(100dvh - 5.5rem - env(safe-area-inset-bottom))" }}
    >
      <header
        className="sticky top-0 z-30 flex items-center gap-2 border-b border-border/60 bg-card/90 px-3 backdrop-blur-xl"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.5rem)", paddingBottom: "0.5rem" }}
      >
        <button
          onClick={onBack}
          className="-ml-1 flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition active:scale-95 active:bg-muted"
          aria-label="Quay lại"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold leading-tight tracking-tight">
            {room.name}
          </h1>
          <div className="truncate text-[11px] leading-tight text-muted-foreground">
            {`Đã tải ${stats.loaded}/${stats.total} tin`}
          </div>
        </div>
        <StatusChip tone={blocked ? "danger" : "success"}>{titleBadge}</StatusChip>
      </header>
      <main className="flex min-h-0 flex-1 flex-col gap-2 px-3 py-2">
        {!isAdmin && blocked && (
          <Card className="shrink-0 border-red-200 bg-red-50 p-3 text-sm text-red-700">
            Bạn đang bị chặn trong trò chuyện. Chỉ xem được nội dung.
          </Card>
        )}

        <Card className="min-h-0 flex-1 overflow-hidden rounded-2xl">
          <div
            ref={scrollRef}
            onScroll={onScrollMessages}
            className="h-full space-y-2 overflow-y-auto overscroll-contain px-3 py-3"
          >
            {hasMore && (
              <button
                type="button"
                onClick={() => void loadOlder()}
                disabled={loadingOlder}
                className="mx-auto block rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground"
              >
                {loadingOlder ? "Đang tải..." : "Tải thêm 50 tin cũ"}
              </button>
            )}

            {loading && messages.length === 0 ? (
              <DataLoadingState variant="list" label="Đang tải hội thoại..." rows={4} />
            ) : messages.length === 0 ? (
              <EmptyState
                icon={MessageSquareText}
                title="Chưa có tin nhắn"
                description="Gửi tin đầu tiên để bắt đầu hội thoại nhóm."
              />
            ) : (
              messages.map((m) => {
                const author = m.expand?.user;
                const mine = m.user === user?.id;
                const actionOpen = actionMessage?.id === m.id;
                const time = new Date(m.created).toLocaleString("vi-VN");
                return (
                  <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                    <div
                      className={cn("max-w-[82%] space-y-1", mine ? "items-end" : "items-start")}
                    >
                      {!mine && (
                        <div className="flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
                          <span className="font-medium text-foreground">
                            {author?.full_name || author?.username || "Ẩn danh"}
                          </span>
                          {author?.role === "admin" && (
                            <>
                              <span>·</span>
                              <span>Admin</span>
                            </>
                          )}
                          {author?.chat_blocked && (
                            <StatusChip tone="danger" className="h-5 px-2 text-[10px]">
                              Đã chặn
                            </StatusChip>
                          )}
                        </div>
                      )}
                      <button
                        type="button"
                        onPointerDown={() => startPress(m)}
                        onPointerUp={stopPress}
                        onPointerCancel={stopPress}
                        onPointerLeave={stopPress}
                        onContextMenu={(event) => {
                          if (!isAdmin) return;
                          event.preventDefault();
                          setActionMessage(m);
                        }}
                        className={cn(
                          "block rounded-2xl px-3 py-2 text-left shadow-sm",
                          mine
                            ? "bg-primary text-primary-foreground"
                            : "border border-border bg-card text-foreground",
                        )}
                      >
                        <div
                          className={cn(
                            "whitespace-pre-wrap text-[14px] leading-relaxed",
                            m.content.length <= 4 && "text-2xl",
                          )}
                        >
                          {m.content}
                        </div>
                        <div
                          className={cn(
                            "mt-1 flex items-center gap-1 text-[10px]",
                            mine
                              ? "justify-end text-primary-foreground/70"
                              : "text-muted-foreground",
                          )}
                        >
                          <Clock3 className="h-3 w-3" />
                          {time}
                        </div>
                      </button>

                      {isAdmin && author && actionOpen && (
                        <div className="flex items-center gap-1 rounded-full border border-border bg-background p-1 shadow-soft">
                          {author.id !== user?.id && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void toggleBlock(author)}
                            >
                              <ShieldCheck className="h-3.5 w-3.5" />
                              {author.chat_blocked ? "Bỏ chặn" : "Chặn"}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => void deleteMessage(m.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Xóa
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setActionMessage(null)}>
                            Đóng
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
            <div ref={endRef} />
          </div>
        </Card>

        <div className="shrink-0">
          <Card className="space-y-2 rounded-2xl border-border/80 bg-background/95 p-2 shadow-lg backdrop-blur">
            {!isAdmin && blocked ? (
              <div className="rounded-xl border border-dashed border-red-200 bg-red-50 p-3 text-sm text-red-700">
                Đang bị chặn nên không thể gửi tin nhắn.
              </div>
            ) : (
              <>
                {showEmojis && (
                  <div className="flex gap-1 overflow-x-auto pb-1">
                    {QUICK_EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => appendEmoji(emoji)}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-card text-base transition hover:bg-muted"
                        aria-label={`Thêm ${emoji}`}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    onClick={() => {
                      setShowEmojis((value) => !value);
                      inputRef.current?.focus();
                    }}
                    aria-label="Icon"
                    className="h-10 w-10 rounded-full"
                  >
                    <SmilePlus className="h-4 w-4" />
                  </Button>
                  <Textarea
                    ref={inputRef}
                    rows={1}
                    value={content}
                    onFocus={() => setShowEmojis(true)}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="Nhập tin nhắn..."
                    maxLength={500}
                    className="min-h-10 resize-none rounded-2xl py-2 text-sm"
                  />
                  <Button
                    type="button"
                    size="icon"
                    onClick={() => void send()}
                    disabled={sending}
                    aria-label="Gửi"
                    className="h-10 w-10 rounded-full"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </>
            )}
          </Card>
        </div>
      </main>
    </div>
  );
}
