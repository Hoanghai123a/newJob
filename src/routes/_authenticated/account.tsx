import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useDebouncedSearch } from "@/hooks/use-debounced-search";
import { pb, type Role, type UserRecord, dataUrlToFile, fileUrl } from "@/lib/pocketbase";
import { generateUid } from "@/lib/uid";
import {
  accountIdentityKey,
  buildUserIdentityMaps,
  findUserByUidInsensitive,
  findUserByUsernameInsensitive,
  normalizeAccountUsername,
} from "@/lib/account-identity";
import { AppHeader } from "@/components/layout/BottomNav";
import { PushNotificationSettingsCard } from "@/components/layout/PushNotificationSettingsCard";
import { DeleteWorkerDialog } from "@/components/admin/DeleteWorkerDialog";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { DataLoadingState } from "@/components/ui/data-loading-state";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { resolveBankName } from "@/lib/vn-banks";
import { BankPicker } from "@/components/staff/BankNameInput";
import { FactoryPicker, UserPicker } from "@/components/workforce/UserPicker";
import { exportToExcel, formatDateOnly } from "@/lib/excel";
import { normalizeDate } from "@/lib/date-utils";
import { escapePb } from "@/lib/delegations";
import { StatusChip } from "@/components/ui/status-chip";
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
import {
  companyFilter,
  companyIdOf,
  companyPayload,
  resolveTenantAccountIdentity,
} from "@/lib/tenant";
import { accountLoginName } from "@/lib/login-identity";
import * as XLSX from "xlsx";
import { toast } from "@/lib/toast";
import {
  ClipboardList,
  ShieldCheck,
  LogOut,
  Save,
  User2,
  Search,
  FileDown,
  KeyRound,
  Trash2,
  UserCog,
  UserPlus,
  Upload,
  FileSpreadsheet,
  Building2,
  Plus,
  Users,
  CalendarRange,
  Pencil,
  LockKeyhole,
  CircleX,
  ImagePlus,
  MoreHorizontal,
  Download,
  Info,
  ChevronRight,
  Trash,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/account")({
  validateSearch: (s: Record<string, unknown>) => ({
    incomplete: s.incomplete ? 1 : undefined,
  }),
  component: AccountPage,
});

const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Quản trị tối cao",
  admin: "Quản trị viên",
  staff: "Staff",
  user: "Người dùng",
};

const USER_FIELD_LABELS: Record<string, string> = {
  username: "Tên đăng nhập",
  uid: "Mã tài khoản",
  phone: "Số điện thoại",
  password: "Mật khẩu",
  passwordConfirm: "Xác nhận mật khẩu",
  tenant_company: "Công ty",
  role: "Vai trò",
};

function getPocketBaseUserCreateError(error: unknown, fallback = "Không tạo được tài khoản") {
  const response = (error as any)?.response;
  const validation = response?.data;
  if (validation && typeof validation === "object") {
    const details = Object.entries(validation)
      .map(([field, value]) => {
        const message = (value as any)?.message;
        if (typeof message !== "string" || !message.trim()) return "";
        const label = USER_FIELD_LABELS[field] || field;
        if (/unique|already exists|must be unique/i.test(message)) return `${label} đã tồn tại`;
        if (/required|missing/i.test(message)) return `Thiếu ${label.toLowerCase()}`;
        if (/invalid/i.test(message)) return `${label} không hợp lệ`;
        return `${label}: ${message}`;
      })
      .filter(Boolean);
    if (details.length) return details.join("; ");
  }
  return response?.message && response.message !== "Failed to create record."
    ? response.message
    : fallback;
}

function requireTenantCompany(user?: UserRecord | null) {
  const tenantCompany = companyIdOf(user);
  if (!tenantCompany) {
    toast.error(
      "Tài khoản Admin chưa được gán công ty. Vui lòng gán công ty trong PocketBase trước.",
    );
    return "";
  }
  return tenantCompany;
}

function isManageableAccount(user?: Pick<UserRecord, "role"> | null) {
  return user?.role === "staff";
}

function requireManageableAccount(user?: Pick<UserRecord, "role"> | null) {
  if (isManageableAccount(user)) return true;
  toast.error("Admin không được phép quản trị tài khoản Admin hoặc Quản trị tối cao.");
  return false;
}

function buildUserSearchFilter(search: string, extraFilter = "") {
  const q = escapePb(search.trim());
  const roleFilter = 'role="staff"';
  const searchFilter = q
    ? `(${["full_name", "username", "phone", "role"]
        .map((field) => `${field}~"${q}"`)
        .join(" || ")})`
    : "";
  return [extraFilter, roleFilter, searchFilter].filter(Boolean).join(" && ");
}

function AccountPage() {
  const { user, logout, isAdmin } = useAuth();
  const nav = useNavigate();

  return (
    <div>
      <AppHeader
        title="Tài khoản"
        right={
          <Button
            size="icon"
            variant="ghost"
            aria-label="Đăng xuất"
            title="Đăng xuất"
            onClick={() => {
              logout();
              nav({ to: "/login" });
            }}
          >
            <LogOut className="h-5 w-5" />
          </Button>
        }
      />

      <div className="space-y-4 p-4">
        <Card className="overflow-hidden desktop:hidden">
          <div className="gradient-primary p-5 text-primary-foreground">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-white/20 p-3">
                {isAdmin ? <ShieldCheck className="h-6 w-6" /> : <User2 className="h-6 w-6" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-lg font-semibold">
                  {user?.full_name || "Người dùng"}
                </div>
                <div className="text-sm opacity-80">@{user?.username}</div>
              </div>
              <Badge variant="secondary" className="bg-white/20 text-primary-foreground">
                {isAdmin ? "Admin" : "Staff"}
              </Badge>
            </div>
          </div>
        </Card>

        <div className="desktop:hidden">
          <PushNotificationSettingsCard />
        </div>

        {isAdmin ? (
          <Tabs defaultValue="staff" className="space-y-3">
            <TabsList className="grid h-10 w-full grid-cols-3 rounded-2xl">
              <TabsTrigger value="staff" className="rounded-xl text-xs">
                Staff
              </TabsTrigger>
              <TabsTrigger value="factories" className="rounded-xl text-xs">
                QLNM
              </TabsTrigger>
              <TabsTrigger value="profile" className="rounded-xl text-xs">
                Thông tin
              </TabsTrigger>
            </TabsList>
            <TabsContent value="staff" className="mt-0">
              <StaffPanel />
            </TabsContent>
            <TabsContent value="factories" className="mt-0">
              <FactoryAssignmentsPanel />
            </TabsContent>
            <TabsContent value="profile" className="mt-0 space-y-3">
              <UserProfileForm />
              <AccountAppLinks />
            </TabsContent>
          </Tabs>
        ) : (
          <div className="space-y-4">
            <UserProfileForm />
            <AccountAppLinks />
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────── USER PROFILE (non-admin) ───────── */

function AccountAppLinks() {
  return (
    <Section title="Ứng dụng và hỗ trợ">
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event("jobconnect:open-install"))}
        className="flex min-h-14 w-full items-center gap-3 rounded-2xl bg-muted/55 px-3 text-left transition active:scale-[0.99]"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Download className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Cài ứng dụng</span>
          <span className="block text-xs leading-5 text-muted-foreground">
            Mở hướng dẫn cài app trên thiết bị này
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
      <Link
        to="/about"
        className="flex min-h-14 w-full items-center gap-3 rounded-2xl bg-muted/55 px-3 text-left transition active:scale-[0.99]"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Info className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Thông tin ứng dụng</span>
          <span className="block text-xs leading-5 text-muted-foreground">
            Giới thiệu, liên hệ và thông tin công ty
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </Link>
    </Section>
  );
}

function UserProfileForm() {
  const { user, refresh, isAdmin } = useAuth();
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string>("");
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const search = Route.useSearch();
  const showIncomplete = !!search.incomplete;

  useEffect(() => {
    if (showIncomplete && !isAdmin) {
      toast.info("Bổ sung đầy đủ thông tin để trải nghiệm tốt nhất");
    }
  }, [isAdmin, showIncomplete]);

  useEffect(() => {
    setForm({
      full_name: user?.full_name || "",
      phone: user?.phone || "",
      cccd: user?.cccd || "",
      bank_name: user?.bank_name || "",
      bank_account_number: user?.bank_account_number || "",
      bank_account_name: user?.bank_account_name || "",
      bank_account_note: user?.bank_account_note || "",
    });
    setAvatarFile(null);
    setAvatarPreview(user?.avatar ? fileUrl(user, user.avatar) : "");
    setRemoveAvatar(false);
  }, [user?.id, user?.avatar]);

  const save = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const payload: Record<string, any> = isAdmin
        ? {
            full_name: form.full_name || "",
            phone: form.phone || "",
            bank_name: form.bank_name || "",
            bank_account_number: form.bank_account_number || "",
            bank_account_name: form.bank_account_name || "",
            bank_account_note: form.bank_account_note || "",
          }
        : {
            full_name: form.full_name || "",
            phone: form.phone || "",
            cccd: form.cccd || "",
            bank_name: form.bank_name || "",
            bank_account_number: form.bank_account_number || "",
            bank_account_name: form.bank_account_name || "",
            bank_account_note: form.bank_account_note || "",
          };

      if (avatarFile || removeAvatar) {
        const fd = new FormData();
        for (const [k, v] of Object.entries(payload)) {
          fd.append(k, (v as any) ?? "");
        }
        if (avatarFile) fd.append("avatar", avatarFile);
        else if (removeAvatar) fd.append("avatar", "");
        await pb.collection("users").update(user.id, fd);
      } else {
        await pb.collection("users").update(user.id, payload);
      }
      setAvatarFile(null);
      setRemoveAvatar(false);
      await refresh();
      toast.success("Đã lưu");
    } catch (e: any) {
      toast.error(e?.message || "Lỗi lưu");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {showIncomplete && !isAdmin && (
        <Card className="border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Bổ sung đầy đủ thông tin để trải nghiệm tốt nhất.
        </Card>
      )}
      <Section title={isAdmin ? "Thông tin admin" : "Thông tin chung"}>
        <div className="hidden justify-end desktop:flex">
          <PushNotificationSettingsCard buttonOnly />
        </div>
        <div className="flex flex-col items-center gap-2">
          <div className="relative h-20 w-20">
            {avatarPreview ? (
              <>
                <img
                  src={avatarPreview}
                  alt="Ảnh đại diện"
                  className="h-20 w-20 rounded-full object-cover border border-border"
                />
                <button
                  type="button"
                  onClick={() => {
                    setAvatarFile(null);
                    setAvatarPreview("");
                    setRemoveAvatar(true);
                  }}
                  className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-white"
                >
                  <Trash className="h-3 w-3" />
                </button>
              </>
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted border border-dashed border-border">
                <User2 className="h-8 w-8 text-muted-foreground" />
              </div>
            )}
          </div>
          <label className="cursor-pointer text-xs font-medium text-primary">
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (!file.type.startsWith("image/")) {
                  toast.error("Vui lòng chọn ảnh");
                  return;
                }
                const reader = new FileReader();
                reader.onload = () => {
                  const url = reader.result as string;
                  setAvatarPreview(url);
                  setAvatarFile(dataUrlToFile(url, file.name || "avatar.jpg"));
                  setRemoveAvatar(false);
                };
                reader.readAsDataURL(file);
                e.target.value = "";
              }}
            />
            <span className="flex items-center gap-1">
              <ImagePlus className="h-3 w-3" /> Đổi ảnh đại diện
            </span>
          </label>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Tên đăng nhập</Label>
          <div className="rounded-md bg-muted px-3 py-2 text-sm">@{user?.username}</div>
        </div>
        <TextField
          label="Họ và tên"
          value={form.full_name}
          onChange={(v) => setForm({ ...form, full_name: v })}
        />
        <TextField
          label="Số điện thoại"
          value={form.phone}
          onChange={(v) => setForm({ ...form, phone: v })}
        />
        {!isAdmin && (
          <TextField
            label="CCCD"
            value={form.cccd || ""}
            onChange={(v) => setForm({ ...form, cccd: v.replace(/\D/g, "") })}
          />
        )}
      </Section>

      <Section title="Số tài khoản (STK)">
        <div className="space-y-1">
          <Label className="text-xs">Ngân hàng</Label>
          <BankPicker
            value={form.bank_name || ""}
            onChange={(value) => setForm({ ...form, bank_name: value })}
          />
        </div>
        <TextField
          label="Số TK"
          value={form.bank_account_number}
          onChange={(v) => setForm({ ...form, bank_account_number: v.replace(/\D/g, "") })}
        />
        <TextField
          label="Tên TK"
          value={form.bank_account_name}
          onChange={(v) => setForm({ ...form, bank_account_name: v })}
        />
        <TextField
          label="Ghi chú STK"
          value={form.bank_account_note}
          onChange={(v) => setForm({ ...form, bank_account_note: v })}
          placeholder="Ghi chú thêm về tài khoản"
        />
      </Section>

      <Button onClick={save} disabled={saving} className="w-full">
        <Save className="h-4 w-4" /> Lưu thay đổi
      </Button>

      <ChangePasswordSection />
    </>
  );
}

function ChangePasswordSection() {
  const { user } = useAuth();
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [changing, setChanging] = useState(false);

  const changePassword = async () => {
    if (!user) return;
    if (!oldPwd || !newPwd || !confirmPwd) {
      toast.error("Vui lòng nhập đầy đủ thông tin");
      return;
    }
    if (newPwd.length < 8) {
      toast.error("Mật khẩu mới tối thiểu 8 ký tự");
      return;
    }
    if (newPwd !== confirmPwd) {
      toast.error("Mật khẩu mới không khớp");
      return;
    }
    setChanging(true);
    try {
      await pb.collection("users").update(user.id, {
        oldPassword: oldPwd,
        password: newPwd,
        passwordConfirm: confirmPwd,
        must_change_password: false,
      });
      toast.success("Đổi mật khẩu thành công");
      setOldPwd("");
      setNewPwd("");
      setConfirmPwd("");
    } catch (e: any) {
      toast.error(e?.response?.message || e?.message || "Mật khẩu cũ không đúng");
    } finally {
      setChanging(false);
    }
  };

  return (
    <Section title="Đổi mật khẩu">
      <TextField label="Mật khẩu hiện tại" type="password" value={oldPwd} onChange={setOldPwd} />
      <TextField
        label="Mật khẩu mới (≥ 8 ký tự)"
        type="password"
        value={newPwd}
        onChange={setNewPwd}
      />
      <TextField
        label="Xác nhận mật khẩu mới"
        type="password"
        value={confirmPwd}
        onChange={setConfirmPwd}
      />
      <Button onClick={changePassword} disabled={changing} className="w-full" variant="outline">
        <KeyRound className="h-4 w-4" /> Đổi mật khẩu
      </Button>
    </Section>
  );
}

/* ───────── ADMIN: USERS MANAGEMENT ───────── */

function AdminUsersPanel() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedSearch(search);
  const [resetTarget, setResetTarget] = useState<any>(null);
  const [newPwd, setNewPwd] = useState("");
  const [roleTarget, setRoleTarget] = useState<any>(null);
  const [roleValue, setRoleValue] = useState<Role>("staff");
  const [createOpen, setCreateOpen] = useState(false);
  const [actionSheetOpen, setActionSheetOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [detailUser, setDetailUser] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserRecord | null>(null);
  const [detailBankEditing, setDetailBankEditing] = useState(false);
  const [detailBankForm, setDetailBankForm] = useState({
    bank_name: "",
    bank_account_number: "",
    bank_account_name: "",
    bank_account_note: "",
  });
  const [detailBankSaving, setDetailBankSaving] = useState(false);
  const [detailProfileEditing, setDetailProfileEditing] = useState(false);
  const [detailProfileForm, setDetailProfileForm] = useState({
    full_name: "",
    phone: "",
    gender: "",
    cccd: "",
    date_of_birth: "",
    address: "",
  });
  const [detailProfileSaving, setDetailProfileSaving] = useState(false);
  const [bulkStaffProcessing, setBulkStaffProcessing] = useState(false);
  const emptyNew = {
    full_name: "",
    phone: "",
    username: "",
    password: "",
    uid: "",
  };
  const [newUser, setNewUser] = useState<any>(emptyNew);

  const load = async () => {
    setLoading(true);
    try {
      const res = await pb.collection("users").getList(1, 500, {
        filter: `${companyFilter(me, "tenant_company")} && (${buildUserSearchFilter(debouncedSearch, me?.id ? `id!="${escapePb(me.id)}"` : "")})`,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, me?.id]);

  const filtered = users;

  const formatUserRow = (u: any, i: number) => ({
    STT: i + 1,
    "Họ tên": u.full_name || "",
    "Tên đăng nhập": accountLoginName(u),
    "Số điện thoại": u.phone || "",
    "Giới tính": u.gender || "",
    CCCD: u.cccd || "",
    "Ngày sinh": formatDateOnly(u.date_of_birth),
    "Địa chỉ": u.address || "",
    "Mã tài khoản (UID)": u.uid || "",
    "Ngân hàng": u.bank_name || "",
    "Số tài khoản": u.bank_account_number || "",
    "Tên tài khoản": u.bank_account_name || "",
    "Ghi chú STK": u.bank_account_note || "",
    "Vai trò": ROLE_LABELS[(u.role || "user") as Role],
    "Ngày tạo": formatDateOnly(u.created),
    "Trạng thái": u.status === "disabled" ? "Đã khóa" : "Hoạt động",
  });

  const exportExcel = () => {
    const rows = filtered.map(formatUserRow);
    exportToExcel(
      "danh_sach_tai_khoan_" + Date.now(),
      { "Tài khoản": rows },
      { "Tài khoản": ["Ngày sinh", "Ngày tạo"] },
    );
  };

  const exportAll = async () => {
    try {
      const all = await pb.collection("users").getFullList({
        filter: `${companyFilter(me, "tenant_company")} && (${buildUserSearchFilter("")})`,
        sort: "-created",
      });
      const rows = all.map(formatUserRow);
      exportToExcel(
        "tat_ca_tai_khoan_" + Date.now(),
        { "Tài khoản": rows },
        { "Tài khoản": ["Ngày sinh", "Ngày tạo"] },
      );
    } catch (e: any) {
      toast.error(e?.message || "Lỗi xuất dữ liệu");
    }
  };

  const downloadStaffTemplate = () => {
    const sample = [
      { "Tên đăng nhập hoặc mã tài khoản (UID)": "nguyenvana", "Nhà máy": "Nhà máy A" },
      { "Tên đăng nhập hoặc mã tài khoản (UID)": "HL000002", "Nhà máy": "" },
    ];
    exportToExcel("mau_chuyen_staff", { "Chuyển Staff": sample });
  };

  const onImportStaff = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f || !me) return;
    setBulkStaffProcessing(true);
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<any>(ws, { defval: "" });

      const factories = await pb.collection("factories").getFullList({ sort: "name" });
      const factoryMap = new Map(factories.map((f: any) => [f.name.toLowerCase(), f.id]));
      const allUsers = await pb.collection("users").getFullList<UserRecord>({
        fields: "id,username,uid,role",
        filter: `${companyFilter(me, "tenant_company")} && role="staff"`,
      });
      const { userByUid, userByUsername } = buildUserIdentityMaps(allUsers);

      let ok = 0;
      let fail = 0;
      let assigned = 0;
      const failedRows: Array<Record<string, unknown>> = [];

      const addFailedStaffRow = (r: Record<string, unknown>, rowNumber: number, reason: string) => {
        fail++;
        failedRows.push({
          Dòng: rowNumber,
          "Lý do lỗi": reason,
          "Tên đăng nhập hoặc mã tài khoản (UID)":
            r["Tên đăng nhập hoặc mã tài khoản (UID)"] ||
            r["Tên đăng nhập"] ||
            r["username"] ||
            r["Mã tài khoản"] ||
            r["uid"] ||
            "",
          "Nhà máy": r["Nhà máy"] || r["factory"] || "",
        });
      };

      for (const [index, r] of rows.entries()) {
        const rowNumber = index + 2;
        const username = String(
          r["Tên đăng nhập hoặc mã tài khoản (UID)"] ||
            r["Tên đăng nhập"] ||
            r["username"] ||
            r["Mã tài khoản"] ||
            r["uid"] ||
            "",
        ).trim();
        const identityKey = accountIdentityKey(username);
        const factoryName = String(r["Nhà máy"] || r["factory"] || "").trim();

        if (!identityKey) {
          addFailedStaffRow(r, rowNumber, "Thiếu tên đăng nhập hoặc mã tài khoản");
          continue;
        }

        const factoryId = factoryName ? factoryMap.get(factoryName.toLowerCase()) : null;
        if (factoryName && !factoryId) {
          addFailedStaffRow(r, rowNumber, 'Không tìm thấy nhà máy "' + factoryName + '"');
          continue;
        }

        try {
          const user = userByUsername.get(identityKey) || userByUid.get(identityKey);
          if (!user) {
            addFailedStaffRow(r, rowNumber, "Không tìm thấy tài khoản");
            continue;
          }
          if (!requireManageableAccount(user)) {
            addFailedStaffRow(r, rowNumber, "Không được phép quản trị tài khoản này");
            continue;
          }
          await pb.collection("users").update(user.id, { role: "staff" });
          if (factoryId) {
            await pb.collection("factory_managers").create({
              ...factoryManagerTenantPayload(me as UserRecord),
              staff: user.id,
              factory: factoryId,
              status: "active",
              active_from: null,
              active_to: null,
              note: "Gán từ Excel bởi admin",
            });
            assigned++;
          }
          await createStaffActionLog({
            actor: me as UserRecord,
            targetUserId: user.id,
            targetCollection: "users",
            targetRecord: user.id,
            action: "update",
            after: { role: "staff", ...(factoryId ? { factory: factoryId } : {}) },
            note: factoryId
              ? "Admin chuyển sang staff và gán nhà máy (import Excel)"
              : "Admin chuyển sang staff không gán nhà máy (import Excel)",
          });
          ok++;
        } catch (err: any) {
          addFailedStaffRow(r, rowNumber, err?.message || "Lỗi chuyển Staff");
        }
      }

      toast.success(
        "Đã chuyển " +
          ok +
          " tài khoản sang Staff" +
          (assigned ? ", gán " + assigned + " nhà máy" : "") +
          (fail ? ", " + fail + " lỗi" : ""),
      );
      if (failedRows.length) {
        exportToExcel(`chuyen_staff_loi_${Date.now()}`, {
          "Dòng lỗi": failedRows,
        });
        toast.warning("Đã xuất file các dòng chuyển Staff bị lỗi");
      }
      load();
    } catch (err: any) {
      toast.error(err?.message || "File không hợp lệ");
    } finally {
      setBulkStaffProcessing(false);
    }
  };

  const openDetailUser = (user: UserRecord) => {
    if (!requireManageableAccount(user)) return;
    setDetailUser(user);
    setDetailBankEditing(false);
    setDetailProfileEditing(false);
    setDetailBankForm({
      bank_name: user.bank_name || "",
      bank_account_number: user.bank_account_number || "",
      bank_account_name: user.bank_account_name || "",
      bank_account_note: user.bank_account_note || "",
    });
    setDetailProfileForm({
      full_name: user.full_name || "",
      phone: user.phone || "",
      gender: user.gender || "",
      cccd: user.cccd || "",
      date_of_birth: user.date_of_birth ? user.date_of_birth.slice(0, 10) : "",
      address: user.address || "",
    });
  };

  const closeDetailUser = () => {
    if (detailBankSaving || detailProfileSaving) return;
    setDetailBankEditing(false);
    setDetailProfileEditing(false);
    setDetailUser(null);
  };

  const openDetailProfileEditor = () => {
    if (!detailUser) return;
    setDetailProfileForm({
      full_name: detailUser.full_name || "",
      phone: detailUser.phone || "",
      gender: detailUser.gender || "",
      cccd: detailUser.cccd || "",
      date_of_birth: detailUser.date_of_birth ? detailUser.date_of_birth.slice(0, 10) : "",
      address: detailUser.address || "",
    });
    setDetailProfileEditing(true);
  };

  const openDetailBankEditor = () => {
    if (!detailUser) return;
    setDetailBankForm({
      bank_name: detailUser.bank_name || "",
      bank_account_number: detailUser.bank_account_number || "",
      bank_account_name: detailUser.bank_account_name || "",
      bank_account_note: detailUser.bank_account_note || "",
    });
    setDetailBankEditing(true);
  };

  const saveDetailBank = async () => {
    if (!detailUser || !me) return;
    if (!requireManageableAccount(detailUser)) return;
    setDetailBankSaving(true);
    try {
      await pb.collection("users").update(detailUser.id, detailBankForm);
      await createStaffActionLog({
        actor: me as UserRecord,
        targetUserId: detailUser.id,
        targetCollection: "users",
        targetRecord: detailUser.id,
        action: "update_bank",
        before: {
          bank_name: detailUser.bank_name || "",
          bank_account_number: detailUser.bank_account_number || "",
          bank_account_name: detailUser.bank_account_name || "",
          bank_account_note: detailUser.bank_account_note || "",
        },
        after: detailBankForm,
        note: "Admin cập nhật STK ngân hàng cho NLĐ",
      });
      setDetailUser((prev: any) => (prev ? { ...prev, ...detailBankForm } : prev));
      setUsers((prev) =>
        prev.map((u) => (u.id === detailUser.id ? { ...u, ...detailBankForm } : u)),
      );
      setDetailBankEditing(false);
      toast.success("Đã cập nhật STK ngân hàng");
    } catch (e: any) {
      toast.error(e?.message || "Không cập nhật được STK");
    } finally {
      setDetailBankSaving(false);
    }
  };

  const saveDetailProfile = async () => {
    if (!detailUser || !me) return;
    if (!requireManageableAccount(detailUser)) return;
    const payload = {
      full_name: detailProfileForm.full_name.trim(),
      phone: detailProfileForm.phone.trim(),
      gender: detailProfileForm.gender.trim(),
      cccd: detailProfileForm.cccd.trim(),
      date_of_birth: detailProfileForm.date_of_birth,
      address: detailProfileForm.address.trim(),
    };
    if (!payload.full_name) {
      toast.warning("Vui lòng nhập họ tên");
      return;
    }
    setDetailProfileSaving(true);
    try {
      await pb.collection("users").update(detailUser.id, payload);
      await createStaffActionLog({
        actor: me as UserRecord,
        targetUserId: detailUser.id,
        targetCollection: "users",
        targetRecord: detailUser.id,
        action: "update",
        before: {
          full_name: detailUser.full_name || "",
          phone: detailUser.phone || "",
          gender: detailUser.gender || "",
          cccd: detailUser.cccd || "",
          date_of_birth: detailUser.date_of_birth || "",
          address: detailUser.address || "",
        },
        after: payload,
        note: "Admin cập nhật thông tin cá nhân cho NLĐ",
      });
      setDetailUser((prev: any) => (prev ? { ...prev, ...payload } : prev));
      setUsers((prev) => prev.map((u) => (u.id === detailUser.id ? { ...u, ...payload } : u)));
      setDetailProfileEditing(false);
      toast.success("Đã cập nhật thông tin cá nhân");
    } catch (e: any) {
      toast.error(e?.message || "Không cập nhật được thông tin");
    } finally {
      setDetailProfileSaving(false);
    }
  };

  const doResetPassword = async () => {
    if (!resetTarget) return;
    if (!requireManageableAccount(resetTarget)) return;
    if (newPwd.length < 8) {
      toast.error("Mật khẩu tối thiểu 8 ký tự");
      return;
    }
    try {
      await pb.collection("users").update(resetTarget.id, {
        password: newPwd,
        passwordConfirm: newPwd,
      });
      toast.success("Đã đặt lại mật khẩu");
      setResetTarget(null);
      setNewPwd("");
    } catch (e: any) {
      toast.error(e?.message || "Lỗi");
    }
  };

  const openRoleDialog = (u: any) => {
    if (!requireManageableAccount(u)) return;
    setRoleTarget(u);
    setRoleValue((u.role || "user") as Role);
  };

  const updateRole = async () => {
    if (!roleTarget || !me) return;
    if (!requireManageableAccount(roleTarget)) return;
    if (roleValue !== "user" && roleValue !== "staff") {
      toast.error("Admin chỉ được phân quyền Người dùng hoặc Staff.");
      return;
    }
    try {
      await pb.collection("users").update(roleTarget.id, { role: roleValue });
      await createStaffActionLog({
        actor: me as UserRecord,
        targetUserId: roleTarget.id,
        targetCollection: "users",
        targetRecord: roleTarget.id,
        action: "update",
        before: { role: roleTarget.role || "user" },
        after: { role: roleValue },
        note: "Admin cập nhật vai trò tài khoản",
      });
      toast.success("Đã cập nhật vai trò");
      setRoleTarget(null);
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Không cập nhật được vai trò");
    }
  };

  const createOne = async () => {
    const full_name = (newUser.full_name || "").trim();
    const phone = (newUser.phone || "").trim();
    const username = normalizeAccountUsername(newUser.username);
    const password = newUser.password || "";
    const manualUid = (newUser.uid || "").trim();
    if (!full_name || !phone || !username || !password) {
      toast.error("Vui lòng nhập đủ Họ tên, SĐT, Tên đăng nhập, Mật khẩu");
      return;
    }
    if (password.length < 8) {
      toast.error("Mật khẩu tối thiểu 8 ký tự");
      return;
    }
    const tenantCompany = requireTenantCompany(me);
    if (!tenantCompany) return;

    try {
      const existingUser = await findUserByUsernameInsensitive(username);
      if (existingUser) {
        toast.error("Tên đăng nhập đã tồn tại");
        return;
      }
      if (manualUid && (await findUserByUidInsensitive(manualUid))) {
        toast.error("Mã tài khoản đã tồn tại");
        return;
      }
      const identity = await resolveTenantAccountIdentity(me, username);
      const uid = await generateUid(manualUid || undefined);
      await pb.collection("users").create({
        full_name,
        phone,
        username: identity.username,
        ...(identity.hasLoginName ? { login_name: identity.loginName } : {}),
        uid,
        password,
        passwordConfirm: password,
        role: "staff",
        tenant_company: tenantCompany,
        status: "active",
        must_change_password: password === "12345678",
      });
      toast.success("Đã tạo tài khoản Staff");
      setCreateOpen(false);
      setNewUser(emptyNew);
      load();
    } catch (e: any) {
      toast.error(getPocketBaseUserCreateError(e, "Không tạo được tài khoản"));
    }
  };

  const downloadTemplate = () => {
    const sample = [
      {
        "Họ tên": "Nguyễn Văn A",
        "Số điện thoại": "0900000001",
        "Tên đăng nhập": "nguyenvana",
        "Mật khẩu": "12345678",
        "Mã tài khoản (UID)": "",
        "Giới tính": "Nam",
        CCCD: "001099012345",
        "Ngày sinh": "15/01/1990",
        "Địa chỉ": "123 Đường ABC, Quận 1, TP.HCM",
        "Ngân hàng": "VCB",
        "Số tài khoản": "1234567890",
        "Tên tài khoản": "NGUYEN VAN A",
        "Ghi chú STK": "Tài khoản nhận lương",
      },
      {
        "Họ tên": "Trần Thị B",
        "Số điện thoại": "0900000002",
        "Tên đăng nhập": "tranthib",
        "Mật khẩu": "12345678",
        "Mã tài khoản (UID)": "",
        "Giới tính": "Nữ",
        CCCD: "001099067890",
        "Ngày sinh": "20/03/1995",
        "Địa chỉ": "456 Đường XYZ, Quận 7, TP.HCM",
        "Ngân hàng": "TCB",
        "Số tài khoản": "0987654321",
        "Tên tài khoản": "TRAN THI B",
        "Ghi chú STK": "",
      },
    ];
    exportToExcel("mau_nhap_tai_khoan", { "Tài khoản": sample }, { "Tài khoản": ["Ngày sinh"] });
  };

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setImporting(true);
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<any>(ws, { defval: "" });
      let ok = 0;
      let fail = 0;
      const failedRows: Array<Record<string, unknown>> = [];
      const tenantCompany = requireTenantCompany(me);
      if (!tenantCompany) return;

      const existingUsers = await pb.collection("users").getFullList<UserRecord>({
        fields: "id,username,uid",
        filter: companyFilter(me, "tenant_company"),
      });
      const existingUsernameKeys = new Set(
        existingUsers.map((user) => accountIdentityKey(accountLoginName(user))).filter(Boolean),
      );
      const existingUidKeys = new Set(
        existingUsers.map((user) => accountIdentityKey(user.uid)).filter(Boolean),
      );
      for (const [index, r] of rows.entries()) {
        const rowNum = index + 2;
        const full_name = String(r["Họ tên"] || r["full_name"] || "").trim();
        const phone = String(r["Số điện thoại"] || r["phone"] || "").trim();
        const username = String(r["Tên đăng nhập"] || r["username"] || "").trim();
        const normalizedUsername = normalizeAccountUsername(username);
        const password = String(r["Mật khẩu"] || r["password"] || "").trim();
        const manualUid = String(
          r["Mã tài khoản (UID)"] || r["Mã tài khoản"] || r["Mã TK"] || r["uid"] || "",
        ).trim();
        const gender = String(r["Giới tính"] || r["gender"] || "").trim();
        const cccd = String(r["CCCD"] || r["cccd"] || "").trim();
        const date_of_birth = normalizeDate(r["Ngày sinh"] ?? r["date_of_birth"] ?? "");
        const address = String(r["Địa chỉ"] || r["address"] || "").trim();
        const bank_name = resolveBankName(String(r["Ngân hàng"] || r["bank_name"] || "").trim());
        const bank_account_number = String(
          r["Số tài khoản"] || r["Số TK"] || r["bank_account_number"] || "",
        ).trim();
        const bank_account_name = String(
          r["Tên tài khoản"] || r["Tên TK"] || r["bank_account_name"] || "",
        ).trim();
        const bank_account_note = String(
          r["Ghi chú STK"] || r["Ghi chú tài khoản"] || r["bank_account_note"] || "",
        ).trim();
        if (!full_name || !phone || !normalizedUsername || !password) {
          fail++;
          failedRows.push({
            Dòng: rowNum,
            "Lý do lỗi": "Thiếu thông tin bắt buộc (họ tên/SĐT/username/mật khẩu)",
            ...r,
          });
          continue;
        }
        if (existingUsernameKeys.has(normalizedUsername)) {
          fail++;
          failedRows.push({ Dòng: rowNum, "Lý do lỗi": "Tên đăng nhập đã tồn tại", ...r });
          continue;
        }
        const manualUidKey = accountIdentityKey(manualUid);
        if (manualUidKey && existingUidKeys.has(manualUidKey)) {
          fail++;
          failedRows.push({ Dòng: rowNum, "Lý do lỗi": "Mã tài khoản đã tồn tại", ...r });
          continue;
        }
        if (password.length < 8) {
          fail++;
          failedRows.push({ Dòng: rowNum, "Lý do lỗi": "Mật khẩu < 8 ký tự", ...r });
          continue;
        }
        try {
          const identity = await resolveTenantAccountIdentity(me, normalizedUsername);
          const uid = await generateUid(manualUid || undefined);
          await pb.collection("users").create({
            full_name,
            phone,
            username: identity.username,
            ...(identity.hasLoginName ? { login_name: identity.loginName } : {}),
            tenant_company: tenantCompany,
            uid,
            password,
            passwordConfirm: password,
            gender,
            cccd,
            date_of_birth,
            address,
            bank_name,
            bank_account_number,
            bank_account_name,
            bank_account_note,
            role: "staff",
            status: "active",
            must_change_password: password === "12345678",
          });
          existingUsernameKeys.add(accountIdentityKey(identity.loginName));
          existingUidKeys.add(accountIdentityKey(uid));
          ok++;
        } catch (err: any) {
          fail++;
          failedRows.push({
            Dòng: rowNum,
            "Lý do lỗi": getPocketBaseUserCreateError(err, "Lỗi tạo tài khoản"),
            ...r,
          });
        }
      }
      toast.success("Đã nhập " + ok + " tài khoản" + (fail ? ", " + fail + " lỗi" : ""));
      if (failedRows.length) {
        exportToExcel(
          `import_tai_khoan_loi_${Date.now()}`,
          { "Dòng lỗi": failedRows },
          { "Dòng lỗi": ["Ngày sinh", "date_of_birth"] },
        );
        toast.warning("Đã xuất file các dòng lỗi");
      }
      await createStaffActionLog({
        actor: me as UserRecord,
        targetCollection: "users",
        action: "import",
        after: {
          created: ok,
          updated: 0,
          failed: fail,
          file: f.name,
          exported_errors: failedRows.length,
        },
        note: "Admin import tài khoản NLĐ từ Excel",
      });
      load();
    } catch (err: any) {
      toast.error(err?.message || "File không hợp lệ");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Card className="space-y-3 p-4">
      <div className="hidden justify-end desktop:flex">
        <PushNotificationSettingsCard buttonOnly />
      </div>

      <Link
        to="/admin/logs"
        className="flex items-center gap-3 rounded-2xl border border-border/60 bg-muted/30 p-3 transition hover:bg-muted/50 desktop:hidden"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
          <ClipboardList className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Nhật ký thao tác</span>
          <span className="block text-[11px] text-muted-foreground">
            Xem lịch sử tác động của staff và admin lên tài khoản
          </span>
        </span>
      </Link>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Quản lý tài khoản ({users.length})
          </h2>
          <p className="text-xs text-muted-foreground">
            Tạo nhanh bên ngoài, các thao tác nhập/xuất/Staff nằm trong bảng thao tác.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
          <Button size="sm" onClick={() => setCreateOpen(true)} className="rounded-full">
            <UserPlus className="h-3.5 w-3.5" /> Tạo
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setActionSheetOpen(true)}
            className="rounded-full"
          >
            <MoreHorizontal className="h-3.5 w-3.5" /> Thao tác
          </Button>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="rounded-full pl-9"
          placeholder="Tìm theo họ tên / SĐT"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Sheet open={actionSheetOpen} onOpenChange={setActionSheetOpen}>
        <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto rounded-t-3xl p-4">
          <SheetHeader className="pr-8 text-left">
            <SheetTitle>Thao tác quản trị</SheetTitle>
            <SheetDescription>
              Gom các thao tác tạo, nhập, xuất, staff và xử lý hàng loạt cho gọn trên mobile.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 space-y-5">
            <section className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Tạo
              </div>
              <Button
                onClick={() => {
                  setActionSheetOpen(false);
                  setCreateOpen(true);
                }}
                className="w-full justify-start rounded-2xl"
              >
                <UserPlus className="h-4 w-4" /> Tạo tài khoản Staff
              </Button>
            </section>

            <Separator />

            <section className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Nhập
              </div>
              <Link
                to="/admin/imports"
                onClick={() => setActionSheetOpen(false)}
                className="hidden h-11 items-center gap-2 rounded-2xl border border-input bg-background px-4 text-sm font-medium shadow-sm hover:bg-accent desktop:flex"
              >
                <FileSpreadsheet className="h-4 w-4" /> Mở Trung tâm dữ liệu
              </Link>
              <div className="space-y-2 desktop:hidden">
                <label
                  className={
                    "flex h-11 cursor-pointer items-center gap-2 rounded-2xl border border-input bg-background px-4 text-sm font-medium shadow-sm hover:bg-accent " +
                    (importing ? "pointer-events-none opacity-50" : "")
                  }
                >
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={(e) => {
                      setActionSheetOpen(false);
                      onImportFile(e);
                    }}
                    disabled={importing}
                  />
                  <Upload className="h-4 w-4" />{" "}
                  {importing ? "Đang nhập..." : "Nhập Excel tài khoản"}
                </label>
                <Button
                  variant="outline"
                  onClick={() => {
                    setActionSheetOpen(false);
                    downloadTemplate();
                  }}
                  className="w-full justify-start rounded-2xl"
                >
                  <FileSpreadsheet className="h-4 w-4" /> Tải mẫu nhập tài khoản
                </Button>
              </div>
            </section>

            <Separator />

            <section className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Xuất
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  setActionSheetOpen(false);
                  exportExcel();
                }}
                className="w-full justify-start rounded-2xl"
              >
                <FileDown className="h-4 w-4" /> Xuất danh sách đang lọc
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setActionSheetOpen(false);
                  exportAll();
                }}
                className="w-full justify-start rounded-2xl"
              >
                <FileDown className="h-4 w-4" /> Xuất tất cả tài khoản
              </Button>
            </section>

            <Separator />

            <section className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Staff
              </div>
              <label
                className={
                  "flex h-11 cursor-pointer items-center gap-2 rounded-2xl border border-input bg-background px-4 text-sm font-medium shadow-sm hover:bg-accent " +
                  (bulkStaffProcessing ? "pointer-events-none opacity-50" : "")
                }
              >
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={(e) => {
                    setActionSheetOpen(false);
                    onImportStaff(e);
                  }}
                  disabled={bulkStaffProcessing}
                />
                <Building2 className="h-4 w-4" />{" "}
                {bulkStaffProcessing ? "Đang xử lý..." : "Nhập danh sách Staff"}
              </label>
              <Button
                variant="outline"
                onClick={() => {
                  setActionSheetOpen(false);
                  downloadStaffTemplate();
                }}
                className="w-full justify-start rounded-2xl"
              >
                <FileSpreadsheet className="h-4 w-4" /> Tải mẫu chuyển Staff
              </Button>
            </section>
          </div>
        </SheetContent>
      </Sheet>

      {loading && users.length > 0 && (
        <DataLoadingState variant="inline" label="Đang cập nhật danh sách tài khoản..." />
      )}
      {loading && users.length === 0 ? (
        <DataLoadingState variant="list" label="Đang tải danh sách tài khoản..." rows={4} />
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 py-10 text-center text-sm text-muted-foreground">
          Không có tài khoản.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((u) => {
            const isActive = u.status !== "disabled";
            const tone = isActive
              ? "border-l-[color:var(--status-success)]"
              : "border-l-[color:var(--status-danger)]";
            const displayName = u.full_name || u.username || "—";
            const username = u.username || "—";
            const phone = u.phone || "—";
            const company = u.company || "—";
            const employeeCode = u.employee_code || "—";
            const createdAt = formatDateOnly(u.created) || "—";

            return (
              <div
                key={u.id}
                onClick={() => openDetailUser(u)}
                className={
                  "list-card cursor-pointer flex items-start gap-3 " +
                  tone +
                  " desktop:grid desktop:grid-cols-[auto_minmax(12rem,1.35fr)_minmax(8rem,.95fr)_minmax(10rem,1.15fr)_minmax(6rem,.7fr)_minmax(9rem,1fr)_minmax(6.5rem,.75fr)_auto] desktop:items-center desktop:gap-3 desktop:px-3 desktop:py-2"
                }
              >
                <div className="min-w-0 flex-1 desktop:flex-none">
                  <div title={displayName} className="truncate text-sm font-semibold">
                    {displayName}
                  </div>
                  <div
                    title={`@${username}`}
                    className="mt-0.5 truncate text-[11px] text-muted-foreground"
                  >
                    @{username}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground desktop:hidden">
                    {"SĐT " + phone}
                  </div>
                  <div className="text-[11px] text-muted-foreground desktop:hidden">
                    {"Mã NV " + employeeCode + " · " + company}
                  </div>
                  <div className="text-[11px] text-muted-foreground desktop:hidden">
                    {"Ngày tạo " + createdAt}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1 desktop:hidden">
                    <span className={"chip " + (isActive ? "chip-success" : "chip-danger")}>
                      {isActive ? "Hoạt động" : "Đã khóa"}
                    </span>
                    <span className="chip chip-info">
                      {ROLE_LABELS[(u.role || "user") as Role]}
                    </span>
                  </div>
                </div>

                <AccountListCell label="SĐT" value={phone} />
                <AccountListCell label="Nhà máy" value={company} />
                <AccountListCell label="Mã NV" value={employeeCode} />

                <div className="hidden min-w-0 desktop:block">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Trạng thái
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <span className={"chip " + (isActive ? "chip-success" : "chip-danger")}>
                      {isActive ? "Hoạt động" : "Đã khóa"}
                    </span>
                    <span className="chip chip-info">
                      {ROLE_LABELS[(u.role || "user") as Role]}
                    </span>
                  </div>
                </div>

                <div className="hidden min-w-0 desktop:block">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Ngày tạo
                  </div>
                  <div title={createdAt} className="mt-1 truncate text-xs text-muted-foreground">
                    {createdAt}
                  </div>
                </div>

                <div className="flex flex-col gap-1 desktop:flex-row desktop:gap-0.5 desktop:justify-self-end">
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!requireManageableAccount(u)) return;
                      setResetTarget(u);
                      setNewPwd("");
                    }}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-primary hover:bg-primary/10"
                    title="Đặt lại mật khẩu"
                  >
                    <KeyRound className="h-4 w-4" />
                  </button>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      openRoleDialog(u);
                    }}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-primary hover:bg-primary/10"
                    title="Chuyển quyền"
                  >
                    <UserCog className="h-4 w-4" />
                  </button>
                  {u.role === "staff" && (
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        setDeleteTarget(u as UserRecord);
                      }}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-destructive hover:bg-destructive/10"
                      title="Xóa tài khoản NLĐ"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Reset password dialog */}
      <Dialog open={!!resetTarget} onOpenChange={(o) => !o && setResetTarget(null)}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>Đặt lại mật khẩu</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              {(resetTarget?.full_name || resetTarget?.username) + " · " + resetTarget?.phone}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Mật khẩu mới (tối thiểu 8 ký tự)</Label>
              <Input
                type="text"
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                placeholder="••••••••"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetTarget(null)}>
              Hủy
            </Button>
            <Button onClick={doResetPassword}>
              <Save className="h-4 w-4" /> Cập nhật
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!roleTarget} onOpenChange={(open) => !open && setRoleTarget(null)}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>Chuyển quyền tài khoản</DialogTitle>
            <DialogDescription>
              Chọn vai trò mới cho{" "}
              {roleTarget?.full_name || roleTarget?.username || "tài khoản này"}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs">Vai trò</Label>
            <Select value={roleValue} onValueChange={(value) => setRoleValue(value as Role)}>
              <SelectTrigger className="rounded-xl">
                <SelectValue placeholder="Chọn vai trò" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">Người dùng</SelectItem>
                <SelectItem value="staff">Staff</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRoleTarget(null)}>
              Hủy
            </Button>
            <Button onClick={updateRole}>
              <UserCog className="h-4 w-4" /> Cập nhật
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create staff dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>Tạo tài khoản Staff</DialogTitle>
            <DialogDescription>
              Tài khoản được kích hoạt quyền Staff và đăng nhập bằng mã công ty hiện tại.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <TextField
              label="Họ tên *"
              value={newUser.full_name}
              onChange={(v) => setNewUser({ ...newUser, full_name: v })}
            />
            <TextField
              label="Số điện thoại *"
              value={newUser.phone}
              onChange={(v) => setNewUser({ ...newUser, phone: v })}
            />
            <TextField
              label="Tên đăng nhập *"
              value={newUser.username}
              onChange={(v) => setNewUser({ ...newUser, username: v })}
            />
            <TextField
              label="Mật khẩu * (≥ 8 ký tự)"
              value={newUser.password}
              onChange={(v) => setNewUser({ ...newUser, password: v })}
            />
            <TextField
              label="Mã tài khoản"
              value={newUser.uid}
              onChange={(v) => setNewUser({ ...newUser, uid: v })}
              placeholder="Để trống để tự sinh"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Hủy
            </Button>
            <Button onClick={createOne}>
              <UserPlus className="h-4 w-4" /> Tạo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* User detail dialog */}
      <Dialog open={!!detailUser} onOpenChange={(open) => !open && closeDetailUser()}>
        <DialogContent
          layout="raw"
          className="max-h-[90dvh] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border-border/70 bg-card p-0 shadow-xl desktop:max-w-5xl"
        >
          {detailUser && (
            <>
              <DialogHeader className="border-b border-border/70 bg-card px-5 pb-4 pt-5 text-left sm:px-6">
                <DialogTitle className="pr-12 text-xl text-foreground">
                  {detailUser.full_name || detailUser.username || "Tài khoản"}
                </DialogTitle>
                <DialogDescription>Thông tin chi tiết tài khoản</DialogDescription>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="rounded-lg border border-border/70 bg-muted/35 px-2.5 py-1 text-xs font-medium text-foreground">
                    @{detailUser.username || "—"}
                  </span>
                  <Badge
                    variant="secondary"
                    className="border border-primary/20 bg-primary/10 text-primary"
                  >
                    {ROLE_LABELS[(detailUser.role || "user") as Role]}
                  </Badge>
                  <Badge
                    variant="secondary"
                    className={
                      detailUser.status !== "disabled"
                        ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border border-rose-200 bg-rose-50 text-rose-700"
                    }
                  >
                    {detailUser.status !== "disabled" ? "Hoạt động" : "Đã khóa"}
                  </Badge>
                </div>
              </DialogHeader>

              <div className="max-h-[calc(90dvh-13rem)] overflow-y-auto p-4 sm:p-5 desktop:p-6">
                <div className="grid gap-4 desktop:grid-cols-[minmax(0,1.15fr)_minmax(17rem,0.85fr)] desktop:items-start">
                  <DetailSection
                    title="Thông tin cá nhân"
                    action={
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9 rounded-xl border-border/80 bg-card px-3 text-xs hover:bg-muted/40"
                        onClick={openDetailProfileEditor}
                      >
                        <Pencil className="h-3.5 w-3.5" /> Sửa thông tin
                      </Button>
                    }
                  >
                    <div className="grid gap-2 sm:grid-cols-2">
                      <DetailField label="Tên đăng nhập" value={`@${detailUser.username || "—"}`} />
                      <DetailField label="Họ và tên" value={detailUser.full_name} />
                      <DetailField label="Số điện thoại" value={detailUser.phone} />
                      <DetailField label="Giới tính" value={detailUser.gender} />
                      <DetailField label="CCCD" value={detailUser.cccd} />
                      <DetailField
                        label="Ngày sinh"
                        value={
                          detailUser.date_of_birth
                            ? detailUser.date_of_birth.slice(0, 10).split("-").reverse().join("/")
                            : ""
                        }
                      />
                      <DetailField
                        label="Địa chỉ"
                        value={detailUser.address}
                        className="sm:col-span-2"
                      />
                    </div>
                  </DetailSection>

                  <div className="space-y-4">
                    <DetailSection
                      title="Tài khoản ngân hàng"
                      action={
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-9 rounded-xl border-border/80 bg-card px-3 text-xs hover:bg-muted/40"
                          onClick={openDetailBankEditor}
                        >
                          <Pencil className="h-3.5 w-3.5" /> Sửa STK
                        </Button>
                      }
                    >
                      <div className="grid gap-2">
                        <DetailField label="Ngân hàng" value={detailUser.bank_name} />
                        <DetailField label="Số tài khoản" value={detailUser.bank_account_number} />
                        <DetailField label="Tên tài khoản" value={detailUser.bank_account_name} />
                        <DetailField
                          label="Ghi chú STK"
                          value={detailUser.bank_account_note || "—"}
                        />
                      </div>
                    </DetailSection>

                    <DetailSection title="Thông tin hệ thống">
                      <div className="grid gap-2 sm:grid-cols-2 desktop:grid-cols-1">
                        <DetailField label="Mã tài khoản (UID)" value={detailUser.uid} />
                        <DetailField
                          label="Vai trò"
                          value={ROLE_LABELS[(detailUser.role || "user") as Role]}
                        />
                        <DetailField
                          label="Trạng thái"
                          value={detailUser.status !== "disabled" ? "Hoạt động" : "Đã khóa"}
                        />
                        <DetailField
                          label="Ngày tạo"
                          value={
                            detailUser.created
                              ? new Date(detailUser.created).toLocaleDateString("vi-VN")
                              : ""
                          }
                        />
                      </div>
                    </DetailSection>
                  </div>
                </div>
              </div>
            </>
          )}
          <DialogFooter className="border-t border-border/70 bg-card px-4 py-3 sm:px-5">
            {detailUser?.role === "staff" && (
              <Button
                variant="destructive"
                className="rounded-xl sm:mr-auto"
                onClick={() => {
                  setDeleteTarget(detailUser as UserRecord);
                  closeDetailUser();
                }}
              >
                <Trash2 className="h-4 w-4" /> Xóa tài khoản NLĐ
              </Button>
            )}
            <Button variant="outline" className="rounded-xl" onClick={closeDetailUser}>
              Đóng
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit profile dialog */}
      <Dialog
        open={detailProfileEditing}
        onOpenChange={(open) => !detailProfileSaving && setDetailProfileEditing(open)}
      >
        <DialogContent className="max-h-[90dvh] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl border-border/70 bg-card p-0 shadow-xl desktop:max-w-3xl">
          <DialogHeader className="border-b border-border/70 bg-card px-5 pb-4 pt-5 text-left sm:px-6">
            <DialogTitle>Sửa thông tin cá nhân</DialogTitle>
            <DialogDescription>
              Cập nhật thông tin của {detailUser?.full_name || detailUser?.username || "tài khoản"}.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 px-5 py-4 sm:px-6 desktop:grid-cols-2">
            <DetailEditorField label="Họ và tên">
              <Input
                value={detailProfileForm.full_name}
                onChange={(e) =>
                  setDetailProfileForm((current) => ({ ...current, full_name: e.target.value }))
                }
                placeholder="Nhập họ và tên"
                className={DETAIL_EDITOR_CONTROL_CLASS}
              />
            </DetailEditorField>
            <DetailEditorField label="Số điện thoại">
              <Input
                value={detailProfileForm.phone}
                onChange={(e) =>
                  setDetailProfileForm((current) => ({
                    ...current,
                    phone: e.target.value.replace(/\D/g, ""),
                  }))
                }
                inputMode="tel"
                placeholder="Nhập số điện thoại"
                className={DETAIL_EDITOR_CONTROL_CLASS}
              />
            </DetailEditorField>
            <DetailEditorField label="Giới tính">
              <Select
                value={detailProfileForm.gender}
                onValueChange={(value) =>
                  setDetailProfileForm((current) => ({ ...current, gender: value }))
                }
              >
                <SelectTrigger className={DETAIL_EDITOR_CONTROL_CLASS}>
                  <SelectValue placeholder="Chọn giới tính" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Nam">Nam</SelectItem>
                  <SelectItem value="Nữ">Nữ</SelectItem>
                  <SelectItem value="Khác">Khác</SelectItem>
                </SelectContent>
              </Select>
            </DetailEditorField>
            <DetailEditorField label="CCCD">
              <Input
                value={detailProfileForm.cccd}
                onChange={(e) =>
                  setDetailProfileForm((current) => ({
                    ...current,
                    cccd: e.target.value.replace(/\D/g, ""),
                  }))
                }
                inputMode="numeric"
                placeholder="Nhập số CCCD"
                className={DETAIL_EDITOR_CONTROL_CLASS}
              />
            </DetailEditorField>
            <DetailEditorField label="Ngày sinh">
              <DateInput
                value={detailProfileForm.date_of_birth}
                onChange={(value) =>
                  setDetailProfileForm((current) => ({ ...current, date_of_birth: value }))
                }
                className={DETAIL_EDITOR_CONTROL_CLASS}
              />
            </DetailEditorField>
            <DetailEditorField label="Địa chỉ" className="desktop:col-span-2">
              <Input
                value={detailProfileForm.address}
                onChange={(e) =>
                  setDetailProfileForm((current) => ({ ...current, address: e.target.value }))
                }
                placeholder="Nhập địa chỉ"
                className={DETAIL_EDITOR_CONTROL_CLASS}
              />
            </DetailEditorField>
          </div>
          <DialogFooter className="sticky bottom-0 border-t border-border/70 bg-card px-5 py-3 sm:px-6">
            <Button
              variant="outline"
              className="rounded-xl"
              disabled={detailProfileSaving}
              onClick={() => setDetailProfileEditing(false)}
            >
              Hủy
            </Button>
            <Button
              className="rounded-xl"
              disabled={detailProfileSaving}
              onClick={saveDetailProfile}
            >
              {detailProfileSaving ? "Đang lưu..." : "Lưu thông tin"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit bank dialog */}
      <Dialog
        open={detailBankEditing}
        onOpenChange={(open) => !detailBankSaving && setDetailBankEditing(open)}
      >
        <DialogContent className="max-h-[90dvh] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl border-border/70 bg-card p-0 shadow-xl desktop:max-w-xl">
          <DialogHeader className="border-b border-border/70 bg-card px-5 pb-4 pt-5 text-left sm:px-6">
            <DialogTitle>Sửa tài khoản ngân hàng</DialogTitle>
            <DialogDescription>
              Cập nhật thông tin nhận lương của{" "}
              {detailUser?.full_name || detailUser?.username || "tài khoản"}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-5 py-4 sm:px-6">
            <DetailEditorField label="Ngân hàng">
              <BankPicker
                value={detailBankForm.bank_name}
                onChange={(value) =>
                  setDetailBankForm((current) => ({ ...current, bank_name: value }))
                }
                triggerClassName={DETAIL_EDITOR_CONTROL_CLASS}
              />
            </DetailEditorField>
            <DetailEditorField label="Số tài khoản">
              <Input
                value={detailBankForm.bank_account_number}
                onChange={(e) =>
                  setDetailBankForm((current) => ({
                    ...current,
                    bank_account_number: e.target.value.replace(/\D/g, ""),
                  }))
                }
                inputMode="numeric"
                placeholder="Nhập số tài khoản"
                className={DETAIL_EDITOR_CONTROL_CLASS}
              />
            </DetailEditorField>
            <DetailEditorField label="Tên chủ tài khoản">
              <Input
                value={detailBankForm.bank_account_name}
                onChange={(e) =>
                  setDetailBankForm((current) => ({
                    ...current,
                    bank_account_name: e.target.value,
                  }))
                }
                placeholder="Nhập tên chủ tài khoản"
                className={DETAIL_EDITOR_CONTROL_CLASS}
              />
            </DetailEditorField>
            <DetailEditorField label="Ghi chú STK">
              <Textarea
                value={detailBankForm.bank_account_note}
                onChange={(e) =>
                  setDetailBankForm((current) => ({
                    ...current,
                    bank_account_note: e.target.value,
                  }))
                }
                placeholder="Ghi chú thêm về tài khoản"
                rows={2}
                className={DETAIL_EDITOR_CONTROL_CLASS}
              />
            </DetailEditorField>
          </div>
          <DialogFooter className="sticky bottom-0 border-t border-border/70 bg-card px-5 py-3 sm:px-6">
            <Button
              variant="outline"
              className="rounded-xl"
              disabled={detailBankSaving}
              onClick={() => setDetailBankEditing(false)}
            >
              Hủy
            </Button>
            <Button className="rounded-xl" disabled={detailBankSaving} onClick={saveDetailBank}>
              {detailBankSaving ? "Đang lưu..." : "Lưu STK"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteWorkerDialog
        worker={deleteTarget}
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        onDeleted={(workerId) => {
          setUsers((current) => current.filter((item) => item.id !== workerId));
          setSelected((current) => {
            const next = new Set(current);
            next.delete(workerId);
            return next;
          });
          if (detailUser?.id === workerId) closeDetailUser();
          setDeleteTarget(null);
        }}
      />
    </Card>
  );
}

const DETAIL_EDITOR_CONTROL_CLASS =
  "h-11 rounded-xl border-border/80 bg-card shadow-none hover:border-primary/40 focus-visible:border-primary/70 focus-visible:ring-primary/25";

function DetailSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border/70 bg-card p-3.5 shadow-sm sm:p-4">
      <div className="mb-3 flex min-h-9 items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function DetailField({
  label,
  value,
  className = "",
}: {
  label: string;
  value?: string;
  className?: string;
}) {
  return (
    <div
      className={`min-w-0 rounded-xl border border-border/65 bg-muted/20 px-3 py-2.5 ${className}`}
    >
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 break-words text-sm font-medium text-foreground">{value || "?"}</div>
    </div>
  );
}

function DetailEditorField({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <Label className="text-xs font-medium text-foreground">{label}</Label>
      {children}
    </div>
  );
}

type EditingAssignment = Partial<FactoryManagerRecord> & { staff?: string };

function formatDateRange(record: FactoryManagerRecord) {
  const from = record.active_from || "Ngay lập tức";
  const to = record.active_to || "Không giới hạn";
  return `${from} -> ${to}`;
}

const STAFF_DEFAULT_PASSWORD = "nv123456";

function staffSearchFilter(search: string) {
  const q = escapePb(search.trim());
  const roleFilter = 'role="staff"';
  if (!q) return roleFilter;
  const searchFilter = `(${["full_name", "username", "phone", "address"]
    .map((field) => `${field}~"${q}"`)
    .join(" || ")})`;
  return `${roleFilter} && ${searchFilter}`;
}

function StaffPanel() {
  const { user: currentUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedSearch(search);
  const [staffUsers, setStaffUsers] = useState<UserRecord[]>([]);
  const [factories, setFactories] = useState<FactoryRecord[]>([]);
  const [assignmentCounts, setAssignmentCounts] = useState<Record<string, number>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [importingStaff, setImportingStaff] = useState(false);
  const [importResult, setImportResult] = useState("");
  const [editingStaff, setEditingStaff] = useState<UserRecord | null>(null);
  const [resettingStaff, setResettingStaff] = useState<UserRecord | null>(null);

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
        fetchFactories(),
        fetchFactoryManagers(),
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

    const tenantCompany = requireTenantCompany(currentUser);
    if (!tenantCompany) return;

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

      const pickVal = (row: Record<string, unknown>, keys: string[]) => {
        for (const key of keys) {
          const value = row[key];
          if (value === undefined || value === null) continue;
          const text = String(value).trim();
          if (text) return text;
        }
        return "";
      };

      for (const [index, row] of rows.entries()) {
        const rowNum = index + 2;
        const username = normalizeAccountUsername(pickVal(row, ["username", "Tên đăng nhập"]));
        const fullName = pickVal(row, ["full_name", "Họ tên", "Họ và tên"]);
        const phone = pickVal(row, ["phone", "Số điện thoại", "SĐT"]);
        const dob = normalizeDate(row["date_of_birth"] ?? row["Ngày sinh"] ?? "");
        const address = pickVal(row, ["address", "Địa chỉ"]);
        const password = pickVal(row, ["password", "Mật khẩu"]) || STAFF_DEFAULT_PASSWORD;

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
            tenant_company: tenantCompany,
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
                ...factoryManagerTenantPayload(currentUser),
                staff: newUser.id,
                factory: factory.id,
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
            "Lý do lỗi": getPocketBaseUserCreateError(error, "Lỗi tạo tài khoản"),
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

  const submitCreateStaff = async (form: {
    username: string;
    full_name: string;
    phone: string;
    date_of_birth: string;
    address: string;
    password: string;
  }) => {
    const username = normalizeAccountUsername(form.username);
    if (!username) {
      toast.error("Nhập tên đăng nhập");
      return false;
    }
    if (!/^[a-z0-9_.]{4,30}$/.test(username)) {
      toast.error("Tên đăng nhập 4-30 ký tự, chỉ chữ/số/._");
      return false;
    }
    if (!form.full_name.trim()) {
      toast.error("Nhập họ và tên");
      return false;
    }

    const existing = await findUserByUsernameInsensitive(username);
    if (existing) {
      toast.error("Tên đăng nhập đã tồn tại");
      return false;
    }

    const tenantCompany = requireTenantCompany(currentUser);
    if (!tenantCompany) return false;

    const identity = await resolveTenantAccountIdentity(currentUser, username);
    const password = form.password.trim() || STAFF_DEFAULT_PASSWORD;
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
      tenant_company: tenantCompany,
      status: "active",
      must_change_password: true,
      emailVisibility: false,
    });

    await createStaffActionLog({
      actor: currentUser,
      targetUserId: newUser.id,
      targetCollection: "users",
      targetRecord: newUser.id,
      action: "create",
      after: { username: identity.loginName, full_name: form.full_name.trim(), role: "staff", uid },
      note: "Admin tạo tài khoản staff trực tiếp",
    });

    toast.success(`Đã tạo staff "${form.full_name.trim()}" (mật khẩu: ${password})`);
    await load();
    return true;
  };

  const updateStaff = async (staff: UserRecord, form: StaffEditForm) => {
    if (!isManageableAccount(staff) || !requireTenantCompany(currentUser)) return;
    const before = {
      full_name: staff.full_name,
      phone: staff.phone,
      date_of_birth: staff.date_of_birth,
      address: staff.address,
    };
    const after = {
      full_name: form.full_name.trim(),
      phone: form.phone.trim(),
      date_of_birth: form.date_of_birth || "",
      address: form.address.trim(),
    };
    if (!after.full_name) throw new Error("Nhập họ và tên");
    const updated = await pb.collection("users").update<UserRecord>(staff.id, after);
    await createStaffActionLog({
      actor: currentUser,
      targetUserId: staff.id,
      targetCollection: "users",
      targetRecord: staff.id,
      action: "update",
      before,
      after,
      note: "Admin chỉnh sửa thông tin tài khoản staff",
    });
    setStaffUsers((items) => items.map((item) => (item.id === staff.id ? updated : item)));
    setEditingStaff(null);
    toast.success("Đã cập nhật thông tin staff");
  };

  const resetStaffPassword = async (staff: UserRecord) => {
    if (!isManageableAccount(staff) || !requireTenantCompany(currentUser)) return;
    await pb.collection("users").update(staff.id, {
      password: STAFF_DEFAULT_PASSWORD,
      passwordConfirm: STAFF_DEFAULT_PASSWORD,
      must_change_password: true,
    });
    await createStaffActionLog({
      actor: currentUser,
      targetUserId: staff.id,
      targetCollection: "users",
      targetRecord: staff.id,
      action: "update",
      after: { must_change_password: true },
      note: "Admin đặt lại mật khẩu tài khoản staff",
    });
    setResettingStaff(null);
    toast.success(`Đã đặt lại mật khẩu staff về "${STAFF_DEFAULT_PASSWORD}"`);
  };

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <StatusChip tone="success">{summary} staff</StatusChip>
        </div>
        <Button size="sm" className="rounded-full" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> Tạo staff
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" className="rounded-full" onClick={downloadTemplate}>
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
          <span className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border border-border px-3 text-xs font-medium">
            <Upload className="h-3.5 w-3.5" /> {importingStaff ? "Đang import..." : "Import Excel"}
          </span>
        </label>
      </div>

      {importResult && (
        <div className="rounded-xl bg-primary/5 p-3 text-sm text-primary">{importResult}</div>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm staff theo tên, username, SĐT..."
          className="rounded-full pl-9"
        />
      </div>

      {loading && staffUsers.length > 0 && (
        <DataLoadingState variant="inline" label="Đang cập nhật danh sách staff..." />
      )}
      {loading && staffUsers.length === 0 ? (
        <DataLoadingState variant="list" label="Đang tải danh sách staff..." rows={3} />
      ) : staffUsers.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          <Users className="mx-auto mb-2 h-8 w-8 opacity-40" />
          Chưa có staff. Tạo mới hoặc import từ Excel.
        </div>
      ) : (
        <div className="space-y-2">
          {staffUsers.map((staff) => {
            const factoryCount = assignmentCounts[staff.id] || 0;
            return (
              <div
                key={staff.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-border/60 bg-muted/30 p-3"
              >
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
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <div className="flex items-center gap-1">
                    <StatusChip tone={staff.role === "admin" ? "info" : "success"}>
                      {staff.role === "admin" ? "Admin" : "Staff"}
                    </StatusChip>
                    <button
                      type="button"
                      onClick={() => setEditingStaff(staff)}
                      className="flex h-7 w-7 items-center justify-center rounded-full text-primary transition hover:bg-primary/10"
                      aria-label={`Chỉnh sửa thông tin ${staff.full_name || "staff"}`}
                      title="Chỉnh sửa thông tin"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="flex items-center gap-1">
                    <StatusChip tone={factoryCount ? "info" : "neutral"}>
                      {factoryCount ? `${factoryCount} NM` : "Chưa gán"}
                    </StatusChip>
                    <button
                      type="button"
                      onClick={() => setResettingStaff(staff)}
                      className="flex h-7 w-7 items-center justify-center rounded-full text-amber-600 transition hover:bg-amber-50"
                      aria-label={`Đặt lại mật khẩu ${staff.full_name || "staff"} về mật khẩu mặc định`}
                      title={`Đặt lại về ${STAFF_DEFAULT_PASSWORD}`}
                    >
                      <LockKeyhole className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <CreateStaffDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={submitCreateStaff}
      />
      <EditStaffDialog
        staff={editingStaff}
        onClose={() => setEditingStaff(null)}
        onSubmit={updateStaff}
      />
      <ResetStaffPasswordDialog
        staff={resettingStaff}
        onClose={() => setResettingStaff(null)}
        onSubmit={resetStaffPassword}
      />
    </Card>
  );
}

type StaffEditForm = { full_name: string; phone: string; date_of_birth: string; address: string };

function EditStaffDialog({
  staff,
  onClose,
  onSubmit,
}: {
  staff: UserRecord | null;
  onClose: () => void;
  onSubmit: (staff: UserRecord, form: StaffEditForm) => Promise<void>;
}) {
  const [form, setForm] = useState<StaffEditForm>({
    full_name: "",
    phone: "",
    date_of_birth: "",
    address: "",
  });
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    if (staff)
      setForm({
        full_name: staff.full_name || "",
        phone: staff.phone || "",
        date_of_birth: staff.date_of_birth || "",
        address: staff.address || "",
      });
  }, [staff]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!staff) return;
    setSubmitting(true);
    try {
      await onSubmit(staff, form);
    } catch (error: any) {
      toast.error(error?.message || "Không thể cập nhật thông tin staff");
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <Dialog open={!!staff} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle>Chỉnh sửa thông tin Staff</DialogTitle>
          <DialogDescription>
            Tài khoản: @{staff ? accountLoginName(staff) : "—"}. Tên đăng nhập và UID không thay
            đổi.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label>Họ và tên</Label>
            <Input
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              className="rounded-xl"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 desktop:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Số điện thoại</Label>
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="rounded-xl"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Ngày sinh</Label>
              <DateInput
                value={form.date_of_birth}
                onChange={(value) => setForm({ ...form, date_of_birth: value })}
                className="rounded-xl"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Địa chỉ</Label>
            <Input
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              className="rounded-xl"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} className="rounded-xl">
              Đóng
            </Button>
            <Button type="submit" disabled={submitting} className="rounded-xl">
              <Save className="h-4 w-4" />
              {submitting ? "Đang lưu..." : "Lưu thay đổi"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetStaffPasswordDialog({
  staff,
  onClose,
  onSubmit,
}: {
  staff: UserRecord | null;
  onClose: () => void;
  onSubmit: (staff: UserRecord) => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!staff) return;
    setSubmitting(true);
    try {
      await onSubmit(staff);
    } catch (error: any) {
      toast.error(error?.message || "Không thể đặt lại mật khẩu staff");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={!!staff} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>Đặt lại mật khẩu Staff</DialogTitle>
          <DialogDescription>
            Mật khẩu của @{staff ? accountLoginName(staff) : "—"} sẽ được đặt lại về
            <strong> {STAFF_DEFAULT_PASSWORD}</strong> và staff phải đổi mật khẩu khi đăng nhập.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Chỉ tiếp tục khi bạn muốn đặt lại mật khẩu mặc định cho staff này.
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} className="rounded-xl">
              Hủy
            </Button>
            <Button type="submit" disabled={submitting} className="rounded-xl">
              <LockKeyhole className="h-4 w-4" />
              {submitting ? "Đang đặt lại..." : "Xác nhận đặt lại"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreateStaffDialog({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (form: {
    username: string;
    full_name: string;
    phone: string;
    date_of_birth: string;
    address: string;
    password: string;
  }) => Promise<boolean>;
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
    if (!open)
      setForm({
        username: "",
        full_name: "",
        phone: "",
        date_of_birth: "",
        address: "",
        password: "",
      });
  }, [open]);

  const set = (k: keyof typeof form, v: string) => setForm((s) => ({ ...s, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const ok = await onSubmit(form);
      if (ok) onClose();
    } catch (error: any) {
      toast.error(getPocketBaseUserCreateError(error, "Lỗi tạo tài khoản staff"));
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
            Mật khẩu mặc định &quot;{STAFF_DEFAULT_PASSWORD}&quot; (yêu cầu đổi khi đăng nhập).
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
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
              placeholder={`Để trống = "${STAFF_DEFAULT_PASSWORD}"`}
              className="rounded-xl"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} className="rounded-xl">
              Đóng
            </Button>
            <Button type="submit" disabled={submitting} className="rounded-xl">
              <Plus className="h-4 w-4" /> {submitting ? "Đang tạo..." : "Tạo staff"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AccountListCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="hidden min-w-0 desktop:block">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div title={value} className="mt-1 truncate text-sm text-foreground">
        {value}
      </div>
    </div>
  );
}

function FactoryAssignmentsPanel() {
  const { user: currentUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedSearch(search);
  const [staffUsers, setStaffUsers] = useState<UserRecord[]>([]);
  const [factories, setFactories] = useState<FactoryRecord[]>([]);
  const [assignments, setAssignments] = useState<FactoryManagerRecord[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<EditingAssignment | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<UserRecord | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [userRows, factoryRows, assignmentRows] = await Promise.all([
        pb
          .collection("users")
          .getList<UserRecord>(1, 200, {
            filter: buildUserSearchFilter(debouncedSearch, `role="staff"`),
            sort: "full_name,username",
          })
          .then((res) => res.items),
        fetchFactories(),
        fetchFactoryManagers(),
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

  const openAdd = (staffId?: string) => {
    setEditingAssignment({ staff: staffId, status: "active" });
    setPickerOpen(true);
  };

  const openEdit = (assignment: FactoryManagerRecord) => {
    setEditingAssignment({ ...assignment });
    setPickerOpen(true);
  };

  const closePicker = () => {
    setPickerOpen(false);
    setEditingAssignment(null);
  };

  const saveAssignment = async () => {
    if (!currentUser) return;
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
      active_from: editingAssignment.active_from || null,
      active_to: editingAssignment.active_to || null,
      status: (editingAssignment.status as FactoryStatus) || "active",
      note: editingAssignment.note || "",
    };

    try {
      if (editingAssignment.id) {
        await pb.collection("factory_managers").update(editingAssignment.id, payload);
        await createStaffActionLog({
          actor: currentUser as UserRecord,
          targetUserId: payload.staff,
          targetCollection: "factory_managers",
          targetRecord: editingAssignment.id,
          action: "update",
          after: payload,
          note: "Admin cập nhật phân công nhà máy cho staff",
        });
      } else {
        const created = await pb
          .collection("factory_managers")
          .create({ ...payload, ...factoryManagerTenantPayload(currentUser as UserRecord) });
        await createStaffActionLog({
          actor: currentUser as UserRecord,
          targetUserId: payload.staff,
          targetCollection: "factory_managers",
          targetRecord: created.id,
          action: "create",
          after: payload,
          note: "Admin gán nhà máy cho staff",
        });
      }

      toast.success(editingAssignment.id ? "Đã cập nhật phân công" : "Đã gán nhà máy cho staff");
      closePicker();
      await load();
    } catch (error: any) {
      toast.error(error?.message || "Không lưu được phân công");
    }
  };

  const deleteAssignment = async (assignment: FactoryManagerRecord) => {
    if (!currentUser) return;
    if (
      !confirm(
        `Xóa quyền quản lý nhà máy "${assignment.expand?.factory?.name || assignment.factory}"?`,
      )
    )
      return;

    try {
      await pb.collection("factory_managers").delete(assignment.id);
      await createStaffActionLog({
        actor: currentUser as UserRecord,
        targetUserId: assignment.staff,
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

  const totalAssignments = assignments.length;
  const activeAssignments = assignments.filter((item) => isFactoryAssignmentActive(item)).length;
  const selectedStaffAssignments = selectedStaff
    ? assignmentsByStaff.get(selectedStaff.id) || []
    : [];
  const selectedStaffActiveCount = selectedStaffAssignments.filter((item) =>
    isFactoryAssignmentActive(item),
  ).length;

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Cấp quyền QLNM
          </h2>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <StatusChip tone="info">{totalAssignments} phân công</StatusChip>
            <StatusChip tone="success">{activeAssignments} đang áp dụng</StatusChip>
            <StatusChip tone="neutral">{staffUsers.length} staff</StatusChip>
          </div>
        </div>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Tìm staff theo tên, username, SĐT..."
          className="rounded-full pl-9"
        />
      </div>

      {loading && staffUsers.length > 0 && (
        <DataLoadingState variant="inline" label="Đang cập nhật phân công nhà máy..." />
      )}
      {loading && staffUsers.length === 0 ? (
        <DataLoadingState variant="list" label="Đang tải phân công nhà máy..." rows={3} />
      ) : staffUsers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 p-4 text-center text-sm text-muted-foreground">
          Chưa có staff. Hãy chuyển quyền một tài khoản sang Staff trước.
        </div>
      ) : filteredStaff.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 p-4 text-center text-sm text-muted-foreground">
          Không tìm thấy staff phù hợp.
        </div>
      ) : (
        <div className="space-y-2">
          {filteredStaff.map((staff) => {
            const staffAssignments = assignmentsByStaff.get(staff.id) || [];
            const activeCount = staffAssignments.filter((item) =>
              isFactoryAssignmentActive(item),
            ).length;

            return (
              <button
                key={staff.id}
                type="button"
                onClick={() => setSelectedStaff(staff)}
                className="w-full rounded-2xl border border-border/60 bg-card p-3 text-left shadow-soft transition active:scale-[0.99]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">
                      {staff.full_name || staff.username || "Chưa có tên"}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      @{accountLoginName(staff) || "chưa có username"} ·{" "}
                      {staff.phone || "chưa có SĐT"}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <StatusChip tone={staffAssignments.length ? "success" : "neutral"}>
                      {staffAssignments.length} nhà máy
                    </StatusChip>
                    <StatusChip tone={activeCount ? "info" : "neutral"}>
                      {activeCount} hiệu lực
                    </StatusChip>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <Dialog open={!!selectedStaff} onOpenChange={(open) => !open && setSelectedStaff(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle>
              {selectedStaff?.full_name || selectedStaff?.username || "Staff"}
            </DialogTitle>
            <DialogDescription>Quản lý các nhà máy được gán cho staff này.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              <StatusChip tone="success">{selectedStaffAssignments.length} nhà máy</StatusChip>
              <StatusChip tone={selectedStaffActiveCount ? "info" : "neutral"}>
                {selectedStaffActiveCount} hiệu lực
              </StatusChip>
            </div>

            {selectedStaffAssignments.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-card/50 p-4 text-center text-sm text-muted-foreground">
                Staff này chưa được gán nhà máy nào.
              </div>
            ) : (
              <div className="space-y-2">
                {selectedStaffAssignments.map((assignment) => {
                  const active = isFactoryAssignmentActive(assignment);
                  return (
                    <div
                      key={assignment.id}
                      className="flex items-start justify-between gap-2 rounded-xl border border-border/60 bg-background/60 p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {assignment.expand?.factory?.name || "Nhà máy"}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                          <CalendarRange className="h-3 w-3" />
                          <span>{formatDateRange(assignment)}</span>
                          <StatusChip tone={active ? "success" : "neutral"}>
                            {active ? "Đang áp dụng" : "Tạm dừng"}
                          </StatusChip>
                        </div>
                        {assignment.note && (
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            Ghi chú: {assignment.note}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(assignment)}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-primary hover:bg-primary/10"
                          aria-label="Sửa phân công"
                          title="Sửa phân công"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteAssignment(assignment)}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-destructive hover:bg-destructive/10"
                          aria-label="Thu hồi phân công"
                          title="Thu hồi phân công"
                        >
                          <CircleX className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedStaff(null)} className="rounded-xl">
              Đóng
            </Button>
            <Button
              onClick={() => selectedStaff && openAdd(selectedStaff.id)}
              className="rounded-xl"
            >
              <Plus className="h-4 w-4" />
              Gán nhà máy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pickerOpen} onOpenChange={(open) => !open && closePicker()}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingAssignment?.id ? "Sửa phân công nhà máy" : "Gán nhà máy cho staff"}
            </DialogTitle>
            <DialogDescription>
              Chọn staff và nhà máy để cấp quyền quản lý nhà máy.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Staff</Label>
              <UserPicker
                users={staffUsers}
                value={editingAssignment?.staff || ""}
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
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="space-y-3 p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {children}
    </Card>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type={type}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}
