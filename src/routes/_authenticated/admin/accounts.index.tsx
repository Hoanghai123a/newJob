import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ClipboardList, Landmark, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { useDebouncedSearch } from "@/hooks/use-debounced-search";
import { PageContainer } from "@/components/layout/PageContainer";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { DataLoadingState } from "@/components/ui/data-loading-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusChip } from "@/components/ui/status-chip";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { pb, type UserRecord } from "@/lib/pocketbase";
import { escapePb } from "@/lib/delegations";
import { updateUserAndCache } from "@/lib/employment";
import { createStaffActionLog } from "@/lib/staff-log";
import { BankPicker } from "@/components/staff/BankNameInput";
import { DeleteWorkerDialog } from "@/components/admin/DeleteWorkerDialog";
import { companyFilter } from "@/lib/tenant";

function userSearchFilter(search: string) {
  const q = escapePb(search.trim());
  const roleFilter = '(role="user" || role="")';
  if (!q) return roleFilter;
  const searchFilter = `(${["full_name", "username", "phone"]
    .map((field) => `${field}~"${q}"`)
    .join(" || ")})`;
  return `${roleFilter} && ${searchFilter}`;
}

export const Route = createFileRoute("/_authenticated/admin/accounts/")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/staff" });
  },
  component: AdminAccountsPage,
});

function AdminAccountsPage() {
  const currentUser = pb.authStore.record as UserRecord | null;
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedSearch(search);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [detailUser, setDetailUser] = useState<UserRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserRecord | null>(null);
  const [bankForm, setBankForm] = useState({
    bank_name: "",
    bank_account_number: "",
    bank_account_name: "",
    bank_account_note: "",
  });
  const [profileForm, setProfileForm] = useState({
    full_name: "",
    cccd: "",
    phone: "",
  });
  const [saving, setSaving] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const userRows = await pb
        .collection("users")
        .getList<UserRecord>(1, 500, {
          filter: `${companyFilter(currentUser, "tenant_company")} && (${userSearchFilter(debouncedSearch)})`,
          sort: "full_name,username",
        })
        .then((res) => res.items);
      setUsers(userRows);
    } catch (error: any) {
      toast.error(error?.message || "Không tải được dữ liệu tài khoản");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const filteredUsers = users;

  const userCount = useMemo(() => users.length, [users]);

  const openDetail = (user: UserRecord) => {
    setDetailUser(user);
    setBankForm({
      bank_name: user.bank_name || "",
      bank_account_number: user.bank_account_number || "",
      bank_account_name: user.bank_account_name || "",
      bank_account_note: user.bank_account_note || "",
    });
    setProfileForm({
      full_name: user.full_name || "",
      cccd: user.cccd || "",
      phone: user.phone || "",
    });
  };

  const saveBankUpdate = async () => {
    if (!detailUser) return;
    setSaving(true);
    try {
      await pb.collection("users").update(detailUser.id, bankForm);
      setUsers((prev) => prev.map((u) => (u.id === detailUser.id ? { ...u, ...bankForm } : u)));
      setDetailUser((prev) => (prev ? { ...prev, ...bankForm } : prev));
      toast.success("Đã cập nhật tài khoản ngân hàng");
    } catch (error: any) {
      toast.error(error?.message || "Không cập nhật được STK");
    } finally {
      setSaving(false);
    }
  };

  const saveProfileUpdate = async () => {
    if (!detailUser) return;
    const payload = {
      full_name: profileForm.full_name.trim(),
      cccd: profileForm.cccd.trim(),
      phone: profileForm.phone.trim(),
    };
    if (!payload.full_name) {
      toast.warning("Vui lòng nhập họ tên");
      return;
    }
    const before = {
      full_name: detailUser.full_name || "",
      cccd: detailUser.cccd || "",
      phone: detailUser.phone || "",
    };
    setSavingProfile(true);
    try {
      await updateUserAndCache(detailUser.id, payload);
      const actor = pb.authStore.record as UserRecord | null;
      await createStaffActionLog({
        actor,
        targetUserId: detailUser.id,
        targetCollection: "users",
        targetRecord: detailUser.id,
        action: "update",
        before,
        after: payload,
        note: "Admin cập nhật thông tin cá nhân",
      });
      setUsers((prev) => prev.map((u) => (u.id === detailUser.id ? { ...u, ...payload } : u)));
      setDetailUser((prev) => (prev ? { ...prev, ...payload } : prev));
      toast.success("Đã cập nhật thông tin cá nhân");
    } catch (error: any) {
      toast.error(error?.message || "Không cập nhật được thông tin");
    } finally {
      setSavingProfile(false);
    }
  };

  return (
    <PageContainer
      title="Tài khoản người lao động"
      subtitle="Quản lý tài khoản NLĐ. Staff được quản lý ở trang riêng."
    >
      <div className="grid grid-cols-2 gap-2">
        <Link
          to="/admin/logs"
          className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card px-3 py-3 text-left text-sm font-medium shadow-soft"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ClipboardList className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">Nhật ký</span>
            <span className="block text-[11px] font-normal text-muted-foreground">
              Lịch sử thao tác admin
            </span>
          </span>
        </Link>
        <Link
          to="/admin/staff"
          className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card px-3 py-3 text-left text-sm font-medium shadow-soft"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">Staff</span>
            <span className="block text-[11px] font-normal text-muted-foreground">
              Tạo, quản lý tài khoản staff
            </span>
          </span>
        </Link>
      </div>

      <div className="relative">
        <Input
          type="search"
          name="worker-account-search"
          autoComplete="off"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Tìm tài khoản theo tên, username, số điện thoại..."
          className="rounded-full"
        />
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold">Người lao động</div>
          <StatusChip tone="neutral">{userCount} tài khoản</StatusChip>
        </div>

        {loading ? (
          <DataLoadingState variant="list" label="Đang tải danh sách tài khoản..." rows={4} />
        ) : filteredUsers.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="Chưa có tài khoản phù hợp"
            description="Thử tìm bằng username hoặc số điện thoại."
          />
        ) : (
          filteredUsers.map((item) => {
            return (
              <Card
                key={item.id}
                className="cursor-pointer space-y-3 rounded-2xl p-4 shadow-soft transition-colors hover:bg-muted/30"
                onClick={() => openDetail(item)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">
                      {item.full_name || item.username || "Chưa có tên"}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      @{item.username || "chưa có username"} ·{" "}
                      {item.phone || "chưa có số điện thoại"}
                    </div>
                    {item.bank_account_number && (
                      <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Landmark className="h-3 w-3" />
                        <span>
                          {item.bank_name || "NH"} · {item.bank_account_number}
                        </span>
                      </div>
                    )}
                  </div>
                  <StatusChip tone="neutral">Người dùng</StatusChip>
                </div>
              </Card>
            );
          })
        )}
      </div>

      <Drawer open={!!detailUser} onOpenChange={(open) => !open && setDetailUser(null)}>
        <DrawerContent className="max-h-[88dvh]">
          <DrawerHeader>
            <DrawerTitle>
              {detailUser?.full_name || detailUser?.username || "Chi tiết NLĐ"}
            </DrawerTitle>
            <DrawerDescription>
              @{detailUser?.username || "—"} · {detailUser?.phone || "Chưa có SĐT"}
            </DrawerDescription>
          </DrawerHeader>
          {detailUser && (
            <div className="space-y-4 overflow-y-auto px-4 pb-4">
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  Thông tin cá nhân
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Họ tên</Label>
                    <Input
                      value={profileForm.full_name}
                      onChange={(e) => setProfileForm((c) => ({ ...c, full_name: e.target.value }))}
                      placeholder="Nhập họ tên"
                      className="rounded-xl"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">CCCD</Label>
                    <Input
                      value={profileForm.cccd}
                      onChange={(e) =>
                        setProfileForm((c) => ({
                          ...c,
                          cccd: e.target.value.replace(/\D/g, ""),
                        }))
                      }
                      inputMode="numeric"
                      placeholder="Nhập số CCCD"
                      className="rounded-xl"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Điện thoại</Label>
                    <Input
                      value={profileForm.phone}
                      onChange={(e) =>
                        setProfileForm((c) => ({
                          ...c,
                          phone: e.target.value.replace(/\D/g, ""),
                        }))
                      }
                      inputMode="tel"
                      placeholder="Nhập số điện thoại"
                      className="rounded-xl"
                    />
                  </div>
                </div>
                <Button
                  onClick={saveProfileUpdate}
                  disabled={savingProfile}
                  className="w-full rounded-xl"
                >
                  {savingProfile ? "Đang lưu..." : "Lưu thông tin cá nhân"}
                </Button>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Landmark className="h-4 w-4 text-primary" />
                  Cập nhật STK ngân hàng
                </div>
                <div className="space-y-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Ngân hàng</Label>
                    <BankPicker
                      value={bankForm.bank_name}
                      onChange={(value) =>
                        setBankForm((current) => ({ ...current, bank_name: value }))
                      }
                      triggerClassName="rounded-xl"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Số tài khoản</Label>
                    <Input
                      value={bankForm.bank_account_number}
                      onChange={(e) =>
                        setBankForm((c) => ({
                          ...c,
                          bank_account_number: e.target.value.replace(/\D/g, ""),
                        }))
                      }
                      inputMode="numeric"
                      placeholder="Nhập số tài khoản"
                      className="rounded-xl"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Tên chủ tài khoản</Label>
                    <Input
                      value={bankForm.bank_account_name}
                      onChange={(e) =>
                        setBankForm((c) => ({ ...c, bank_account_name: e.target.value }))
                      }
                      placeholder="Nhập tên chủ tài khoản"
                      className="rounded-xl"
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label className="text-xs">Ghi chú STK</Label>
                    <Textarea
                      value={bankForm.bank_account_note}
                      onChange={(e) =>
                        setBankForm((c) => ({ ...c, bank_account_note: e.target.value }))
                      }
                      placeholder="Ghi chú thêm về tài khoản"
                      rows={2}
                      className="rounded-xl"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
          <DrawerFooter>
            <Button
              variant="destructive"
              onClick={() => {
                setDeleteTarget(detailUser);
                setDetailUser(null);
              }}
              disabled={!detailUser || saving || savingProfile}
              className="rounded-xl"
            >
              <Trash2 className="h-4 w-4" /> Xóa tài khoản NLĐ
            </Button>
            <Button variant="outline" onClick={() => setDetailUser(null)} className="rounded-xl">
              Đóng
            </Button>
            <Button onClick={saveBankUpdate} disabled={saving} className="rounded-xl">
              {saving ? "Đang lưu..." : "Lưu STK"}
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      <DeleteWorkerDialog
        worker={deleteTarget}
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        onDeleted={(workerId) => {
          setUsers((current) => current.filter((item) => item.id !== workerId));
          setDeleteTarget(null);
        }}
      />
    </PageContainer>
  );
}
