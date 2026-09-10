import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useDebouncedSearch } from "@/hooks/use-debounced-search";
import {
  ArrowLeft,
  Building2,
  CalendarRange,
  CheckCircle2,
  CircleX,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { DataLoadingState } from "@/components/ui/data-loading-state";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { FactoryPicker, UserPicker } from "@/components/workforce/UserPicker";
import { StatusChip } from "@/components/ui/status-chip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { pb, type UserRecord } from "@/lib/pocketbase";
import {
  fetchFactories,
  fetchFactoryManagers,
  isFactoryAssignmentActive,
  type FactoryManagerRecord,
  type FactoryRecord,
  type FactoryStatus,
  factoryManagerTenantPayload,
} from "@/lib/factories";
import { createStaffActionLog } from "@/lib/staff-log";
import { escapePb } from "@/lib/delegations";
import { companyFilter, companyIdOf } from "@/lib/tenant";

export const Route = createFileRoute("/_authenticated/admin/accounts/factories")({
  beforeLoad: () => {
    const currentUser = pb.authStore.record as UserRecord | null;
    if (!currentUser || currentUser.role !== "admin") {
      throw redirect({ to: "/account", search: {} as any });
    }
  },
  component: AccountStaffFactoriesPage,
});

type EditingAssignment = Partial<FactoryManagerRecord> & { staff?: string };

function staffSearchFilter(search: string) {
  const q = escapePb(search.trim());
  const searchFilter = q
    ? `(${["full_name", "username", "phone"].map((field) => `${field}~"${q}"`).join(" || ")})`
    : "";
  return ['role="staff"', searchFilter].filter(Boolean).join(" && ");
}

function formatDateRange(record: FactoryManagerRecord) {
  const from = record.active_from || "Ngay lập tức";
  const to = record.active_to || "Không giới hạn";
  return `${from} -> ${to}`;
}

function buildAssignmentErrorMessage(error: any): string {
  const data = error?.response?.data;
  const fieldDetails =
    data && typeof data === "object"
      ? Object.entries(data)
          .map(([field, value]: [string, any]) =>
            value?.message ? `${field}: ${value.message}` : "",
          )
          .filter(Boolean)
          .join("; ")
      : "";
  if (fieldDetails) return fieldDetails;

  const rawMessage = error?.response?.message || error?.message || "";
  if (/unique|Failed to create record|Failed to update record/i.test(rawMessage)) {
    return "Nhà máy này đã được gán cho staff (trùng thời điểm hiệu lực). Hãy chỉnh 'Từ ngày' hoặc gỡ phân công cũ.";
  }
  if (rawMessage && rawMessage !== "Failed to create record.") return rawMessage;
  return "Không lưu được phân công. Vui lòng kiểm tra staff, nhà máy và thời điểm hiệu lực.";
}

function AccountStaffFactoriesPage() {
  const currentUser = pb.authStore.record as UserRecord;
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedSearch(search);
  const [staffUsers, setStaffUsers] = useState<UserRecord[]>([]);
  const [factories, setFactories] = useState<FactoryRecord[]>([]);
  const [assignments, setAssignments] = useState<FactoryManagerRecord[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<EditingAssignment | null>(null);
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [userRows, factoryRows, assignmentRows] = await Promise.all([
        pb
          .collection("users")
          .getList<UserRecord>(1, 200, {
            filter: `${companyFilter(currentUser, "tenant_company")} && (${staffSearchFilter(debouncedSearch)})`,
            sort: "full_name,username",
          })
          .then((res) => res.items),
        fetchFactories(currentUser),
        fetchFactoryManagers(undefined, currentUser),
      ]);
      setStaffUsers(userRows);
      setFactories(factoryRows);
      setAssignments(assignmentRows);
    } catch (error: any) {
      toast.error(error?.message || "Không tải được dữ liệu phân công");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const assignmentsByStaff = useMemo(() => {
    const map = new Map<string, FactoryManagerRecord[]>();
    for (const assignment of assignments) {
      const bucket = map.get(assignment.staff) || [];
      bucket.push(assignment);
      map.set(assignment.staff, bucket);
    }
    return map;
  }, [assignments]);

  const filteredStaff = staffUsers;

  const totalAssignments = assignments.length;
  const activeAssignments = assignments.filter((item) => isFactoryAssignmentActive(item)).length;

  const openAddForStaff = (staffId: string) => {
    setSelectedStaffId(staffId);
    setEditingAssignment({ staff: staffId, status: "active" });
    setPickerOpen(true);
  };

  const openAddBlank = () => {
    setSelectedStaffId(null);
    setEditingAssignment({ status: "active" });
    setPickerOpen(true);
  };

  const openEditAssignment = (assignment: FactoryManagerRecord) => {
    setSelectedStaffId(assignment.staff);
    setEditingAssignment({ ...assignment });
    setPickerOpen(true);
  };

  const closePicker = () => {
    setPickerOpen(false);
    setEditingAssignment(null);
    setSelectedStaffId(null);
  };

  const saveAssignment = async () => {
    if (!editingAssignment?.staff) {
      toast.warning("Chọn staff trước khi lưu");
      return;
    }
    if (!editingAssignment?.factory) {
      toast.warning("Chọn nhà máy trước khi lưu");
      return;
    }

    const payload = {
      staff: editingAssignment.staff,
      factory: editingAssignment.factory,
      active_from: editingAssignment.active_from || "",
      active_to: editingAssignment.active_to || "",
      status: (editingAssignment.status as FactoryStatus) || "active",
      note: editingAssignment.note || "",
    };

    const duplicate = assignments.find(
      (assignment) =>
        assignment.id !== editingAssignment.id &&
        assignment.staff === payload.staff &&
        assignment.factory === payload.factory &&
        (assignment.active_from || "") === payload.active_from,
    );
    if (duplicate) {
      toast.warning("Staff này đã được gán nhà máy với cùng thời điểm hiệu lực.");
      return;
    }

    try {
      let recordId = editingAssignment.id;
      if (recordId) {
        await pb.collection("factory_managers").update(recordId, payload);
      } else {
        const created = await pb
          .collection("factory_managers")
          .create({ ...payload, ...factoryManagerTenantPayload(currentUser) });
        recordId = created.id;
      }

      toast.success(editingAssignment.id ? "Đã cập nhật phân công" : "Đã gán nhà máy cho staff");
      closePicker();
      void load();

      createStaffActionLog({
        actor: currentUser,
        targetCollection: "factory_managers",
        targetRecord: recordId,
        action: editingAssignment.id ? "update" : "create",
        after: payload,
        note: editingAssignment.id
          ? "Admin cập nhật phân công nhà máy cho staff"
          : "Admin gán nhà máy cho staff",
      }).catch((logError) => console.warn("[factory-managers] audit log failed", logError));
    } catch (error: any) {
      console.error("[factory-managers] save assignment failed", error);
      toast.error(buildAssignmentErrorMessage(error));
    }
  };

  const deleteAssignment = async (assignment: FactoryManagerRecord) => {
    if (
      !confirm(
        `Xóa quyền quản lý nhà máy "${assignment.expand?.factory?.name || assignment.factory}"?`,
      )
    ) {
      return;
    }

    try {
      await pb.collection("factory_managers").delete(assignment.id);
      await createStaffActionLog({
        actor: currentUser,
        targetCollection: "factory_managers",
        targetRecord: assignment.id,
        action: "delete",
        before: assignment,
        note: "Admin thu hồi quyền quản lý nhà máy của staff",
      });
      toast.success("Đã thu hồi phân công");
      await load();
    } catch (error: any) {
      toast.error(error?.message || "Không xóa được phân công");
    }
  };

  return (
    <PageContainer
      title="Cấp quyền quản lý nhà máy"
      subtitle="Gom danh sách nhà máy theo từng staff, một staff có thể được gán nhiều nhà máy"
      right={
        <Link
          to="/admin/accounts"
          className="flex h-9 items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 text-xs font-medium text-foreground shadow-soft"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Tài khoản
        </Link>
      }
    >
      <Card className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/60 bg-card/80 p-3 shadow-soft">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip tone="info">{totalAssignments} phân công</StatusChip>
          <StatusChip tone="success">{activeAssignments} đang áp dụng</StatusChip>
          <StatusChip tone="neutral">{staffUsers.length} staff</StatusChip>
        </div>
        <Button size="sm" className="rounded-full" onClick={openAddBlank}>
          <Plus className="h-4 w-4" /> Gán nhà máy
        </Button>
      </Card>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Tìm staff theo tên, username, số điện thoại..."
          className="rounded-full pl-9"
        />
      </div>

      {loading ? (
        <DataLoadingState variant="list" label="Đang tải phân công nhà máy..." rows={4} />
      ) : staffUsers.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Chưa có staff"
          description="Vào trang Tài khoản để nâng cấp một user thành staff trước."
          action={
            <Button asChild size="sm" className="rounded-full">
              <Link to="/admin/accounts">Mở trang Tài khoản</Link>
            </Button>
          }
        />
      ) : filteredStaff.length === 0 ? (
        <EmptyState
          icon={Search}
          title="Không tìm thấy staff phù hợp"
          description="Thử tìm bằng username hoặc số điện thoại."
        />
      ) : (
        <div className="space-y-3">
          {filteredStaff.map((staff) => {
            const staffAssignments = assignmentsByStaff.get(staff.id) || [];
            const activeCount = staffAssignments.filter((item) =>
              isFactoryAssignmentActive(item),
            ).length;

            return (
              <Card key={staff.id} className="space-y-3 rounded-2xl p-4 shadow-soft">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">
                      {staff.full_name || staff.username || "Chưa có tên"}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      @{staff.username || "chưa có username"} ·{" "}
                      {staff.phone || "chưa có số điện thoại"}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <StatusChip tone={staffAssignments.length ? "success" : "neutral"}>
                      {staffAssignments.length} nhà máy
                    </StatusChip>
                    {staffAssignments.length > 0 && (
                      <StatusChip tone={activeCount ? "info" : "neutral"}>
                        {activeCount} đang áp dụng
                      </StatusChip>
                    )}
                  </div>
                </div>

                {staffAssignments.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border/60 bg-muted/30 px-3 py-3 text-[12px] text-muted-foreground">
                    Staff này chưa được gán nhà máy nào. Bấm "Gán nhà máy" để bắt đầu.
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {staffAssignments.map((assignment) => {
                      const active = isFactoryAssignmentActive(assignment);

                      return (
                        <li
                          key={assignment.id}
                          className="flex items-start justify-between gap-3 rounded-xl border border-border/60 bg-background/60 p-3"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">
                              {assignment.expand?.factory?.name || "Nhà máy"}
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                              <span className="inline-flex items-center gap-1">
                                <CalendarRange className="h-3 w-3" />
                                {formatDateRange(assignment)}
                              </span>
                              <StatusChip tone={active ? "success" : "neutral"}>
                                {active ? (
                                  <span className="inline-flex items-center gap-1">
                                    <CheckCircle2 className="h-3 w-3" /> Đang áp dụng
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1">
                                    <CircleX className="h-3 w-3" /> Tạm dừng
                                  </span>
                                )}
                              </StatusChip>
                            </div>
                            {assignment.note && (
                              <div className="mt-1 text-[11px] text-muted-foreground">
                                Ghi chú: {assignment.note}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => openEditAssignment(assignment)}
                              className="flex h-9 w-9 items-center justify-center rounded-full border border-border/60 text-foreground"
                              aria-label="Sửa phân công"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteAssignment(assignment)}
                              className="flex h-9 w-9 items-center justify-center rounded-full border border-border/60 text-destructive"
                              aria-label="Thu hồi phân công"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}

                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-full"
                    onClick={() => openAddForStaff(staff.id)}
                  >
                    <Plus className="h-4 w-4" />
                    {staffAssignments.length ? "Gán thêm nhà máy" : "Gán nhà máy"}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog
        open={pickerOpen}
        onOpenChange={(open) => {
          if (!open) closePicker();
        }}
      >
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingAssignment?.id ? "Sửa phân công nhà máy" : "Gán nhà máy cho staff"}
            </DialogTitle>
            <DialogDescription>
              Mỗi staff có thể được gán nhiều nhà máy. Phạm vi quyền hạn chi tiết sẽ được nâng cấp
              sau.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Staff</Label>
              <UserPicker
                users={staffUsers}
                value={editingAssignment?.staff || selectedStaffId || ""}
                onChange={(value) =>
                  setEditingAssignment((current) => ({ ...(current || {}), staff: value }))
                }
                placeholder="Chọn staff"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Nhà máy</Label>
              <FactoryPicker
                factories={factories}
                value={editingAssignment?.factory || ""}
                onChange={(value) =>
                  setEditingAssignment((current) => ({ ...(current || {}), factory: value }))
                }
                triggerClassName="rounded-xl"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Từ ngày</Label>
                <DateInput
                  value={editingAssignment?.active_from || ""}
                  onChange={(v) =>
                    setEditingAssignment((current) => ({
                      ...(current || {}),
                      active_from: v,
                    }))
                  }
                  className="rounded-xl"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Đến ngày</Label>
                <DateInput
                  value={editingAssignment?.active_to || ""}
                  onChange={(v) =>
                    setEditingAssignment((current) => ({
                      ...(current || {}),
                      active_to: v,
                    }))
                  }
                  className="rounded-xl"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Trạng thái</Label>
              <Select
                value={editingAssignment?.status || "active"}
                onValueChange={(value) =>
                  setEditingAssignment((current) => ({
                    ...(current || {}),
                    status: value as FactoryStatus,
                  }))
                }
              >
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="Chọn trạng thái" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Đang áp dụng</SelectItem>
                  <SelectItem value="inactive">Tạm dừng</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Ghi chú</Label>
              <Input
                value={editingAssignment?.note || ""}
                onChange={(event) =>
                  setEditingAssignment((current) => ({
                    ...(current || {}),
                    note: event.target.value,
                  }))
                }
                className="rounded-xl"
                placeholder="Ví dụ: phụ trách ca sáng, phụ trách tạm thời..."
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closePicker} className="rounded-xl">
              Đóng
            </Button>
            <Button onClick={saveAssignment} className="rounded-xl">
              <Plus className="h-4 w-4" />
              {editingAssignment?.id ? "Lưu phân công" : "Gán nhà máy"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
