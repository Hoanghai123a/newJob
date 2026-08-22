import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { pb, type UserRecord } from "@/lib/pocketbase";
import { isUserApproved } from "@/lib/user-approval";
import { createStaffActionLog } from "@/lib/staff-log";
import { assignUidIfMissing } from "@/lib/uid";
import { PageContainer } from "@/components/layout/PageContainer";
import { StatCard } from "@/components/ui/stat-card";
import { StatusChip, toneBorder } from "@/components/ui/status-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { DataLoadingState } from "@/components/ui/data-loading-state";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { exportToExcel, formatDateOnly } from "@/lib/excel";
import { toast } from "@/lib/toast";
import { companyFilter } from "@/lib/tenant";
import { Check, FileDown, X, Users, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/approvals")({
  beforeLoad: () => {
    const u = pb.authStore.record as any;
    if (!u || u.role !== "admin") throw redirect({ to: "/news" });
  },
  component: ApprovalsPage,
});

function ApprovalsPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = async () => {
    setLoading(true);
    try {
      const currentUser = pb.authStore.record as UserRecord | null;
      const res = await pb.collection("users").getList(1, 300, {
        filter: `${companyFilter(currentUser, "tenant_company")} && (approvalStatus = "pending" || approved = "false")`,
        sort: "-created",
      });
      setUsers(res.items);
    } catch (e: any) {
      toast.error(e?.message || "Lỗi tải");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const toggle = (id: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const approveSelected = async (approve: boolean) => {
    if (!selected.size) return;
    const actor = pb.authStore.record as UserRecord | null;
    for (const id of selected) {
      const before = users.find((u) => u.id === id);
      if (approve) {
        const after = { approvalStatus: "approved", approved: "true", status: "active" };
        await pb.collection("users").update(id, after);
        try {
          const uid = await assignUidIfMissing(id);
          await createStaffActionLog({
            actor,
            targetUserId: id,
            targetCollection: "users",
            targetRecord: id,
            action: "update",
            before: before
              ? {
                  approvalStatus: before.approvalStatus,
                  approved: before.approved,
                  status: before.status,
                  uid: before.uid,
                }
              : undefined,
            after: { ...after, uid },
            note: "Admin duyệt đăng ký tài khoản và cấp UID",
          });
        } catch {
          await createStaffActionLog({
            actor,
            targetUserId: id,
            targetCollection: "users",
            targetRecord: id,
            action: "update",
            before: before
              ? {
                  approvalStatus: before.approvalStatus,
                  approved: before.approved,
                  status: before.status,
                }
              : undefined,
            after,
            note: "Admin duyệt đăng ký tài khoản (chưa cấp được UID)",
          });
        }
      } else {
        await pb.collection("users").delete(id);
        await createStaffActionLog({
          actor,
          targetUserId: id,
          targetCollection: "users",
          targetRecord: id,
          action: "delete",
          before,
          note: "Admin từ chối/xoá đăng ký tài khoản",
        });
      }
    }
    toast.success(approve ? "Đã duyệt" : "Đã từ chối");
    setSelected(new Set());
    load();
  };

  const exportUsers = async () => {
    const currentUser = pb.authStore.record as UserRecord | null;
    const all = await pb.collection("users").getFullList({
      filter: companyFilter(currentUser, "tenant_company"),
      sort: "-created",
    });
    const rows = all.map((u: any) => ({
      "Họ tên": u.full_name,
      "Mã tài khoản (UID)": u.uid || "",
      "Số điện thoại": u.phone,
      "Địa chỉ email": u.email,
      "Vai trò": u.role,
      "Đã duyệt": isUserApproved(u) ? "Có" : "Không",
      "Ngân hàng": u.bank_name,
      "Số tài khoản": u.bank_account_number,
      "Tên chủ tài khoản": u.bank_account_name,
      "Ghi chú STK": u.bank_account_note,
      "Tạo lúc": formatDateOnly(u.created),
    }));
    exportToExcel(
      `danh_sach_user_${Date.now()}`,
      { "Tài khoản chờ duyệt": rows },
      { "Tài khoản chờ duyệt": ["Tạo lúc"] },
    );
  };

  return (
    <PageContainer
      title="Quản lý duyệt"
      subtitle={loading && users.length === 0 ? "Đang tải dữ liệu..." : `${users.length} chờ duyệt`}
      right={
        <button
          onClick={exportUsers}
          disabled={loading}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-muted-foreground border border-border hover:bg-muted"
          aria-label="Xuất Excel"
        >
          <FileDown className="h-4 w-4" />
        </button>
      }
    >
      <div className="grid grid-cols-2 gap-2.5">
        <StatCard label="Chờ duyệt" value={users.length} icon={Clock} tone="warning" />
        <StatCard label="Đã chọn" value={selected.size} icon={Check} tone="primary" />
      </div>

      {selected.size > 0 && (
        <div className="sticky top-[var(--header-h,3.25rem)] z-20 -mx-4 flex items-center justify-between gap-2 bg-primary/10 px-4 py-2 backdrop-blur">
          <span className="text-xs font-medium text-primary">{selected.size} đã chọn</span>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => approveSelected(true)}>
              <Check className="h-3.5 w-3.5" /> Duyệt
            </Button>
            <Button size="sm" variant="destructive" onClick={() => approveSelected(false)}>
              <X className="h-3.5 w-3.5" /> Từ chối
            </Button>
          </div>
        </div>
      )}

      {users.length > 0 && (
        <label className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
          <Checkbox
            checked={selected.size === users.length && users.length > 0}
            onCheckedChange={(c) => setSelected(c ? new Set(users.map((u) => u.id)) : new Set())}
          />
          Chọn tất cả ({users.length})
        </label>
      )}

      {loading && users.length > 0 && (
        <DataLoadingState variant="inline" label="Đang cập nhật tài khoản chờ duyệt..." />
      )}
      {loading && users.length === 0 ? (
        <DataLoadingState variant="list" label="Đang tải tài khoản chờ duyệt..." rows={3} />
      ) : users.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Không có yêu cầu"
          description="Tất cả đăng ký đã được xử lý."
        />
      ) : (
        users.map((u) => (
          <label
            key={u.id}
            className={cn(
              "list-card cursor-pointer",
              toneBorder["warning"],
              "flex items-start gap-3",
            )}
          >
            <Checkbox
              checked={selected.has(u.id)}
              onCheckedChange={() => toggle(u.id)}
              className="mt-1"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{u.full_name || u.phone}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                SĐT: {u.phone || "—"} · STK: {u.bank_account_number || "—"}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                <StatusChip tone="warning">Chờ duyệt</StatusChip>
                <StatusChip tone="neutral">
                  {new Date(u.created).toLocaleDateString("vi-VN")}
                </StatusChip>
              </div>
            </div>
          </label>
        ))
      )}
    </PageContainer>
  );
}
