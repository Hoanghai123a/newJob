import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Building2, FileSpreadsheet, Plus, Search, ShieldCheck, Upload, Users } from "lucide-react";
import { toast } from "@/lib/toast";
import { useDebouncedSearch } from "@/hooks/use-debounced-search";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DateInput } from "@/components/ui/date-input";
import { EmptyState } from "@/components/ui/empty-state";
import { DataLoadingState } from "@/components/ui/data-loading-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatCard } from "@/components/ui/stat-card";
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
import { generateUid } from "@/lib/uid";
import { findUserByUsernameInsensitive, normalizeAccountUsername } from "@/lib/account-identity";
import { createStaffActionLog } from "@/lib/staff-log";
import {
  fetchFactories,
  fetchFactoryManagers,
  isFactoryAssignmentActive,
  type FactoryRecord,
} from "@/lib/factories";
import { exportToExcel } from "@/lib/excel";
import { normalizeDate } from "@/lib/date-utils";
import { escapePb } from "@/lib/delegations";
import { companyFilter, companyIdOf, resolveTenantAccountIdentity } from "@/lib/tenant";
import { accountLoginName } from "@/lib/login-identity";

export const Route = createFileRoute("/_authenticated/admin/staff/")({
  beforeLoad: () => {
    const currentUser = pb.authStore.record as UserRecord | null;
    if (!currentUser || currentUser.role !== "admin") throw redirect({ to: "/" });
  },
  component: AdminStaffPage,
});

const DEFAULT_PASSWORD = "nv123456";

function staffSearchFilter(search: string) {
  const q = escapePb(search.trim());
  const roleFilter = 'role="staff"';
  if (!q) return roleFilter;
  const searchFilter = `(${["full_name", "username", "phone", "address"]
    .map((field) => `${field}~"${q}"`)
    .join(" || ")})`;
  return `${roleFilter} && ${searchFilter}`;
}

function AdminStaffPage() {
  const currentUser = pb.authStore.record as UserRecord;
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedSearch(search);
  const [staffUsers, setStaffUsers] = useState<UserRecord[]>([]);
  const [factories, setFactories] = useState<FactoryRecord[]>([]);
  const [assignmentCounts, setAssignmentCounts] = useState<Record<string, number>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [importingStaff, setImportingStaff] = useState(false);
  const [importResult, setImportResult] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [userRows, factoryRows, assignmentRows] = await Promise.all([
        pb
          .collection("users")
          .getList<UserRecord>(1, 500, {
            filter: `${companyFilter(currentUser, "tenant_company")} && (${staffSearchFilter(debouncedSearch)})`,
            sort: "full_name,username",
          })
          .then((res) => res.items),
        fetchFactories(currentUser),
        fetchFactoryManagers(undefined, currentUser),
      ]);
      setStaffUsers(userRows);
      setFactories(factoryRows);
      const counts: Record<string, number> = {};
      for (const row of assignmentRows) {
        if (isFactoryAssignmentActive(row)) {
          counts[row.staff] = (counts[row.staff] || 0) + 1;
        }
      }
      setAssignmentCounts(counts);
    } catch (error: any) {
      toast.error(error?.message || "Không tải được dữ liệu staff");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const summary = useMemo(() => staffUsers.filter((u) => u.role === "staff").length, [staffUsers]);

  const downloadTemplate = () => {
    exportToExcel(
      "mau_import_staff",
      {
        "Tài khoản Staff": [
          {
            "Tên đăng nhập": "nguyenvana",
            "Họ tên": "Nguyễn Văn A",
            "Số điện thoại": "0901234567",
            "Ngày sinh": "15/05/1990",
            "Địa chỉ": "Hà Nội",
            "Mật khẩu": "",
            "Nhà máy 1": "Nhà máy A",
            "Nhà máy 2": "Nhà máy B",
            "Nhà máy 3": "",
          },
        ],
      },
      { "Tài khoản Staff": ["Ngày sinh"] },
    );
  };

  const importStaff = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setImportingStaff(true);
    setImportResult("");
    try {
      const factoryRows = await fetchFactories(currentUser);
      const factoryByName = new Map(factoryRows.map((f) => [f.name.toLowerCase(), f]));

      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

      let created = 0;
      let failed = 0;
      const failedRows: Array<Record<string, unknown>> = [];

      for (const [index, row] of rows.entries()) {
        const rowNum = index + 2;
        const username = normalizeAccountUsername(pickValue(row, ["username", "Tên đăng nhập"]));
        const fullName = pickValue(row, ["full_name", "Họ tên", "Họ và tên"]);
        const phone = pickValue(row, ["phone", "Số điện thoại", "SĐT"]);
        const dob = normalizeDate(row["date_of_birth"] ?? row["Ngày sinh"] ?? "");
        const address = pickValue(row, ["address", "Địa chỉ"]);
        const password = pickValue(row, ["password", "Mật khẩu"]) || DEFAULT_PASSWORD;

        if (!username) {
          failedRows.push({ Dòng: rowNum, "Lý do lỗi": "Thiếu username", ...row });
          failed++;
          continue;
        }
        if (!/^[a-z0-9_.]{4,30}$/.test(username)) {
          failedRows.push({
            Dòng: rowNum,
            "Lý do lỗi": "Username không hợp lệ (4-30 ký tự, chỉ chữ/số/._)",
            ...row,
          });
          failed++;
          continue;
        }
        if (!fullName) {
          failedRows.push({ Dòng: rowNum, "Lý do lỗi": "Thiếu họ tên", ...row });
          failed++;
          continue;
        }

        const existing = await findUserByUsernameInsensitive(username);
        if (existing) {
          failedRows.push({
            Dòng: rowNum,
            "Lý do lỗi": `Username "${username}" đã tồn tại`,
            ...row,
          });
          failed++;
          continue;
        }

        try {
          const identity = await resolveTenantAccountIdentity(currentUser, username);
          const uid = await generateUid();
          const newUser = await pb.collection("users").create({
            username: identity.username,
            ...(identity.hasLoginName ? { login_name: identity.loginName } : {}),
            uid,
            full_name: fullName,
            phone: phone || undefined,
            date_of_birth: dob || undefined,
            address: address || undefined,
            password,
            passwordConfirm: password,
            role: "staff",
            tenant_company: companyIdOf(currentUser),
            approvalStatus: "approved",
            approved: "true",
            status: "active",
            must_change_password: true,
            emailVisibility: false,
          });

          const factoryCols = Object.keys(row).filter(
            (k) => /^nhà máy/i.test(k) || /^Nhà máy/i.test(k) || /^factory/i.test(k),
          );
          for (const col of factoryCols) {
            const factoryName = String(row[col] || "").trim();
            if (!factoryName) continue;
            const factory = factoryByName.get(factoryName.toLowerCase());
            if (factory) {
              await pb.collection("factory_managers").create({
                staff: newUser.id,
                factory: factory.id,
                tenant_company: companyIdOf(currentUser),
                status: "active",
              });
            }
          }

          await createStaffActionLog({
            actor: currentUser,
            targetUserId: newUser.id,
            targetCollection: "users",
            targetRecord: newUser.id,
            action: "create",
            after: { username: identity.loginName, full_name: fullName, role: "staff", uid },
            note: "Admin import tạo tài khoản staff từ Excel",
          });
          created++;
        } catch (error: any) {
          failedRows.push({
            Dòng: rowNum,
            "Lý do lỗi": error?.message || "Lỗi tạo tài khoản",
            ...row,
          });
          failed++;
        }
      }

      const resultText = `Tạo staff: thành công ${created}, lỗi ${failed}`;
      setImportResult(resultText);
      toast.success(resultText);
      if (failedRows.length) {
        exportToExcel(
          `staff_import_loi_${Date.now()}`,
          { "Dòng lỗi": failedRows },
          { "Dòng lỗi": ["Ngày sinh", "date_of_birth"] },
        );
        toast.warning("Đã xuất file các dòng lỗi");
      }
      await load();
    } catch (error: any) {
      toast.error(error?.message || "Lỗi đọc file import staff");
    } finally {
      setImportingStaff(false);
    }
  };

  return (
    <PageContainer
      title="Quản lý Staff"
      subtitle="Tạo, quản lý tài khoản staff và phân quyền nhà máy"
    >
      <StatCard label="Staff" value={summary} icon={Users} tone="success" />

      <Link
        to="/admin/accounts/factories"
        className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card px-3 py-3 text-left text-sm font-medium shadow-soft"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Building2 className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">Cấp quyền QLNM</span>
          <span className="block text-[11px] font-normal text-muted-foreground">
            Gán nhà máy cho staff
          </span>
        </span>
      </Link>

      <Card className="space-y-3 rounded-2xl p-4 shadow-soft">
        <div className="text-sm font-semibold">Tạo & Import staff</div>
        <div className="flex flex-wrap gap-2">
          <Button className="rounded-full" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Tạo staff mới
          </Button>
          <Button variant="outline" className="rounded-full" onClick={downloadTemplate}>
            <FileSpreadsheet className="h-4 w-4" /> Tải file mẫu
          </Button>
          <label className="inline-flex">
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              disabled={importingStaff}
              onChange={importStaff}
            />
            <span className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border border-border px-4 text-sm font-medium">
              <Upload className="h-4 w-4" /> {importingStaff ? "Đang import..." : "Import Excel"}
            </span>
          </label>
        </div>
        {importResult && (
          <div className="rounded-xl border-primary/30 bg-primary/5 p-3 text-sm text-primary">
            {importResult}
          </div>
        )}
      </Card>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm staff theo tên, username, SĐT, địa chỉ..."
          className="rounded-full pl-9"
        />
      </div>

      {loading && staffUsers.length > 0 && (
        <DataLoadingState variant="inline" label="Đang cập nhật danh sách staff..." />
      )}
      {loading && staffUsers.length === 0 ? (
        <DataLoadingState variant="list" label="Đang tải danh sách staff..." rows={4} />
      ) : staffUsers.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Chưa có staff"
          description="Tạo staff mới hoặc import từ Excel để bắt đầu."
        />
      ) : (
        <div className="space-y-2">
          {staffUsers.map((staff) => {
            const factoryCount = assignmentCounts[staff.id] || 0;
            return (
              <Card key={staff.id} className="space-y-1 rounded-2xl p-4 shadow-soft">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">
                      {staff.full_name || staff.username || "Chưa có tên"}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      @{accountLoginName(staff) || "—"} · {staff.phone || "chưa có SĐT"}
                    </div>
                    {(staff.date_of_birth || staff.address) && (
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {staff.date_of_birth && `Sinh: ${staff.date_of_birth}`}
                        {staff.date_of_birth && staff.address && " · "}
                        {staff.address && `ĐC: ${staff.address}`}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <StatusChip tone={staff.role === "admin" ? "info" : "success"}>
                      {staff.role === "admin" ? "Admin" : "Staff"}
                    </StatusChip>
                    <StatusChip tone={factoryCount ? "info" : "neutral"}>
                      {factoryCount ? `${factoryCount} nhà máy` : "Chưa gán NM"}
                    </StatusChip>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <CreateStaffDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        actor={currentUser}
        factories={factories}
        onCreated={load}
      />
    </PageContainer>
  );
}

function CreateStaffDialog({
  open,
  onClose,
  actor,
  factories,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  actor: UserRecord;
  factories: FactoryRecord[];
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    username: "",
    full_name: "",
    phone: "",
    date_of_birth: "",
    address: "",
    password: "",
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setForm({
        username: "",
        full_name: "",
        phone: "",
        date_of_birth: "",
        address: "",
        password: "",
      });
    }
  }, [open]);

  const set = (k: keyof typeof form, v: string) => setForm((s) => ({ ...s, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const username = normalizeAccountUsername(form.username);

    if (!username) {
      toast.error("Nhập tên đăng nhập");
      return;
    }
    if (!/^[a-z0-9_.]{4,30}$/.test(username)) {
      toast.error("Tên đăng nhập 4-30 ký tự, chỉ chữ/số/._");
      return;
    }
    if (!form.full_name.trim()) {
      toast.error("Nhập họ và tên");
      return;
    }

    setSubmitting(true);
    try {
      const existing = await findUserByUsernameInsensitive(username);
      if (existing) {
        toast.error("Tên đăng nhập đã tồn tại");
        setSubmitting(false);
        return;
      }

      const identity = await resolveTenantAccountIdentity(actor, username);
      const password = form.password.trim() || DEFAULT_PASSWORD;
      const uid = await generateUid();

      const newUser = await pb.collection("users").create({
        username: identity.username,
        ...(identity.hasLoginName ? { login_name: identity.loginName } : {}),
        uid,
        full_name: form.full_name.trim(),
        phone: form.phone.trim() || undefined,
        date_of_birth: form.date_of_birth || undefined,
        address: form.address.trim() || undefined,
        password,
        passwordConfirm: password,
        role: "staff",
        tenant_company: companyIdOf(actor),
        approvalStatus: "approved",
        approved: "true",
        status: "active",
        must_change_password: true,
        emailVisibility: false,
      });

      await createStaffActionLog({
        actor,
        targetUserId: newUser.id,
        targetCollection: "users",
        targetRecord: newUser.id,
        action: "create",
        after: {
          username: identity.loginName,
          full_name: form.full_name.trim(),
          role: "staff",
          uid,
        },
        note: "Admin tạo tài khoản staff trực tiếp",
      });

      toast.success(`Đã tạo staff "${form.full_name.trim()}" (mật khẩu: ${password})`);
      onClose();
      onCreated();
    } catch (error: any) {
      toast.error(error?.message || "Lỗi tạo tài khoản staff");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>Tạo staff mới</DialogTitle>
          <DialogDescription>
            Tài khoản staff sẽ được kích hoạt ngay, mật khẩu mặc định "{DEFAULT_PASSWORD}" (yêu cầu
            đổi khi đăng nhập).
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">
              Tên đăng nhập <span className="text-destructive">*</span>
            </Label>
            <Input
              value={form.username}
              onChange={(e) => set("username", e.target.value)}
              placeholder="VD: nguyenvana"
              className="rounded-xl"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">
              Họ và tên <span className="text-destructive">*</span>
            </Label>
            <Input
              value={form.full_name}
              onChange={(e) => set("full_name", e.target.value)}
              placeholder="VD: Nguyễn Văn A"
              className="rounded-xl"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Số điện thoại</Label>
              <Input
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                placeholder="Tùy chọn"
                className="rounded-xl"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Ngày sinh</Label>
              <DateInput
                value={form.date_of_birth}
                onChange={(v) => set("date_of_birth", v)}
                className="rounded-xl"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Địa chỉ</Label>
            <Input
              value={form.address}
              onChange={(e) => set("address", e.target.value)}
              placeholder="Tùy chọn"
              className="rounded-xl"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Mật khẩu</Label>
            <Input
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
              placeholder={`Để trống = "${DEFAULT_PASSWORD}"`}
              className="rounded-xl"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} className="rounded-xl">
              Đóng
            </Button>
            <Button type="submit" disabled={submitting} className="rounded-xl">
              <Plus className="h-4 w-4" />
              {submitting ? "Đang tạo..." : "Tạo staff"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function pickValue(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}
