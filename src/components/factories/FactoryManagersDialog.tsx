import { useEffect, useMemo, useState } from "react";
import { Plus, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { DataLoadingState } from "@/components/ui/data-loading-state";
import { Label } from "@/components/ui/label";
import { UserPicker } from "@/components/workforce/UserPicker";
import { StatusChip } from "@/components/ui/status-chip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { pb, type UserRecord } from "@/lib/pocketbase";
import { createStaffActionLog } from "@/lib/staff-log";
import { companyFilter, companyPayload } from "@/lib/tenant";
import {
  fetchFactoryManagers,
  isFactoryAssignmentActive,
  type FactoryManagerRecord,
} from "@/lib/factories";

export function FactoryManagersDialog({
  factoryId,
  factoryName,
  open,
  onOpenChange,
}: {
  factoryId: string | null;
  factoryName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [staffUsers, setStaffUsers] = useState<UserRecord[]>([]);
  const [assignments, setAssignments] = useState<FactoryManagerRecord[]>([]);
  const [selectedStaff, setSelectedStaff] = useState("");

  const load = async () => {
    if (!factoryId) return;
    setLoading(true);
    try {
      const [staffRows, assignmentRows] = await Promise.all([
        pb
          .collection("users")
          .getList<UserRecord>(1, 200, {
            filter: `${companyFilter(pb.authStore.record as UserRecord | null)} && role = "staff"`,
            sort: "full_name,username",
          })
          .then((res) => res.items),
        fetchFactoryManagers(),
      ]);
      setStaffUsers(staffRows);
      setAssignments(assignmentRows.filter((item) => item.factory === factoryId));
    } catch (error: any) {
      toast.error(error?.message || "Không tải được danh sách phụ trách");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setSelectedStaff("");
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, factoryId]);

  const assignedStaffIds = useMemo(
    () => new Set(assignments.map((item) => item.staff)),
    [assignments],
  );
  const availableStaff = useMemo(
    () => staffUsers.filter((item) => !assignedStaffIds.has(item.id)),
    [staffUsers, assignedStaffIds],
  );

  const addManager = async () => {
    if (!factoryId || !selectedStaff) {
      toast.warning("Chọn staff cần cấp quyền");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        staff: selectedStaff,
        factory: factoryId,
        status: "active",
        note: "",
      };
      const created = await pb
        .collection("factory_managers")
        .create({ ...payload, ...companyPayload(pb.authStore.record as UserRecord | null) });
      await createStaffActionLog({
        actor: pb.authStore.record as any,
        targetUserId: selectedStaff,
        targetCollection: "factory_managers",
        targetRecord: created.id,
        action: "create",
        after: payload,
        note: "Admin cấp quyền quản lý nhà máy",
      });
      toast.success("Đã cấp quyền quản lý");
      setSelectedStaff("");
      load();
    } catch (error: any) {
      toast.error(error?.message || "Không cấp được quyền");
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (assignment: FactoryManagerRecord) => {
    const nextStatus = assignment.status === "active" ? "inactive" : "active";
    try {
      await pb.collection("factory_managers").update(assignment.id, { status: nextStatus });
      await createStaffActionLog({
        actor: pb.authStore.record as any,
        targetUserId: assignment.staff,
        targetCollection: "factory_managers",
        targetRecord: assignment.id,
        action: "update",
        before: { status: assignment.status || "active" },
        after: { status: nextStatus },
        note: "Admin đổi trạng thái quyền quản lý nhà máy",
      });
      load();
    } catch (error: any) {
      toast.error(error?.message || "Không cập nhật được trạng thái");
    }
  };

  const removeManager = async (assignment: FactoryManagerRecord) => {
    if (!confirm("Thu hồi quyền quản lý nhà máy của staff này?")) return;
    try {
      await pb.collection("factory_managers").delete(assignment.id);
      await createStaffActionLog({
        actor: pb.authStore.record as any,
        targetUserId: assignment.staff,
        targetCollection: "factory_managers",
        targetRecord: assignment.id,
        action: "delete",
        before: assignment,
        note: "Admin thu hồi quyền quản lý nhà máy",
      });
      toast.success("Đã thu hồi quyền");
      load();
    } catch (error: any) {
      toast.error(error?.message || "Không thu hồi được quyền");
    }
  };

  const staffName = (id: string) => {
    const found = staffUsers.find((item) => item.id === id);
    return found?.full_name || found?.username || id;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle>Cấp quyền quản lý nhà máy</DialogTitle>
          <DialogDescription>
            Chọn staff được phép quản lý nhân sự tại {factoryName || "nhà máy này"}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Thêm staff phụ trách</Label>
            <div className="flex gap-2">
              <UserPicker
                users={availableStaff}
                value={selectedStaff}
                onChange={setSelectedStaff}
                placeholder="Chọn staff"
              />
              <Button
                className="rounded-xl"
                onClick={addManager}
                disabled={saving || !selectedStaff}
              >
                <Plus className="h-4 w-4" /> Thêm
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold text-muted-foreground">
              Đang phụ trách ({assignments.length})
            </div>
            {loading ? (
              <DataLoadingState variant="list" label="Đang tải staff quản lý nhà máy..." rows={2} />
            ) : assignments.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-card/50 p-4 text-center text-sm text-muted-foreground">
                Chưa có staff nào quản lý nhà máy này.
              </div>
            ) : (
              assignments.map((assignment) => {
                const active = isFactoryAssignmentActive(assignment);
                return (
                  <div
                    key={assignment.id}
                    className="flex items-center gap-3 rounded-2xl border border-border/60 p-3"
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <ShieldCheck className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">
                        {staffName(assignment.staff)}
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleStatus(assignment)}
                        className="mt-0.5 text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                      >
                        {assignment.status === "active" ? "Đang áp dụng" : "Tạm dừng"} · đổi trạng
                        thái
                      </button>
                    </div>
                    <StatusChip tone={active ? "success" : "neutral"}>
                      {active ? "Hiệu lực" : "Tạm dừng"}
                    </StatusChip>
                    <button
                      type="button"
                      onClick={() => removeManager(assignment)}
                      className="flex h-9 w-9 items-center justify-center rounded-full border border-border/60 text-destructive"
                      aria-label="Thu hồi quyền"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>
            Đóng
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
