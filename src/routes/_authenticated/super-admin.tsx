import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Building2, Gauge, Pencil, Plus, RefreshCw, ShieldCheck, UserRoundCog } from "lucide-react";
import { pb, type UserRecord } from "@/lib/pocketbase";
import { type CompanyRecord, type CompanyStatus } from "@/lib/tenant";
import { toast } from "@/lib/toast";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  CompanyRestoreButton,
  CompanyTransferActions,
} from "@/components/admin/CompanyTenantTransfer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
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

export const Route = createFileRoute("/_authenticated/super-admin")({
  beforeLoad: () => {
    const user = pb.authStore.record as UserRecord | null;
    if (!user || user.role !== "super_admin") throw redirect({ to: "/" });
  },
  component: SuperAdminPage,
});

type Company = CompanyRecord & {
  usage?: { accounts: number; workers: number; factories: number; employment_histories: number };
};
type Admin = {
  id: string;
  username?: string;
  display_username?: string;
  full_name?: string;
  email?: string;
  status?: "active" | "disabled";
  must_change_password?: boolean;
};
const empty = {
  name: "",
  code: "",
  admin_name: "",
  admin_username: "",
  admin_password: "",
  email: "",
  hotline: "",
  max_accounts: "0",
  max_workers: "0",
  max_factories: "0",
  max_file_bytes: "0",
  max_employment_histories: "0",
};

function SuperAdminPage() {
  const [items, setItems] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [limitCompany, setLimitCompany] = useState<Company | null>(null);
  const [editCompany, setEditCompany] = useState<Company | null>(null);
  const [editCompanyForm, setEditCompanyForm] = useState({ name: "", code: "" });
  const [limit, setLimit] = useState("0");
  const [adminCompany, setAdminCompany] = useState<Company | null>(null);
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminForm, setAdminForm] = useState({
    full_name: "",
    username: "",
    email: "",
    password: "",
  });
  const [editing, setEditing] = useState<Admin | null>(null);
  const [systemLogoOpen, setSystemLogoOpen] = useState(false);
  const [logoCompany, setLogoCompany] = useState<Company | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoSaving, setLogoSaving] = useState(false);
  const [logoBust, setLogoBust] = useState(() => Date.now());
  const headers = { Authorization: `Bearer ${pb.authStore.token}` };

  const compressImage = async (file: File): Promise<File> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const MAX_WIDTH = 512;
          const MAX_HEIGHT = 512;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height = (height * MAX_WIDTH) / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width = (width * MAX_HEIGHT) / height;
              height = MAX_HEIGHT;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("Không tạo được canvas context"));
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);

          canvas.toBlob(
            (blob) => {
              if (!blob) {
                reject(new Error("Không nén được ảnh"));
                return;
              }
              const compressedFile = new File(
                [blob],
                file.name.replace(/\.[^.]+$/, ".jpg"),
                { type: "image/jpeg" },
              );
              console.log(
                `Compressed: ${file.size} bytes → ${compressedFile.size} bytes (${Math.round((compressedFile.size / file.size) * 100)}%)`,
              );
              resolve(compressedFile);
            },
            "image/jpeg",
            0.85,
          );
        };
        img.onerror = () => reject(new Error("Không load được ảnh"));
        img.src = e.target?.result as string;
      };
      reader.onerror = () => reject(new Error("Không đọc được file"));
      reader.readAsDataURL(file);
    });
  };
  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/super-admin/companies", { headers });
      const b = await r.json().catch(() => null);
      if (!r.ok) throw new Error(b?.message || "Không tải được danh sách công ty.");
      setItems(b.items || []);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    // Load once when the protected SuperAdmin page mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const patchCompany = async (company: Company, payload: Record<string, unknown>) => {
    const r = await fetch(`/api/super-admin/companies/${company.id}`, {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const b = await r.json();
    if (!r.ok) throw new Error(b?.message);
    setItems((old) => old.map((x) => (x.id === company.id ? { ...x, ...b } : x)));
    return b;
  };
  const create = async () => {
    setSaving(true);
    try {
      const payload = Object.fromEntries(
        Object.entries(form).map(([k, v]) => [k, k.startsWith("max_") ? Number(v || 0) : v]),
      );
      const r = await fetch("/api/super-admin/companies", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b?.message);
      toast.success("Đã mở công ty và tạo Admin đầu tiên.");
      setCreateOpen(false);
      setForm(empty);
      await load();
    } catch (e: any) {
      toast.error(e.message || "Không tạo được công ty.");
    } finally {
      setSaving(false);
    }
  };
  const saveCompanyDetails = async () => {
    if (!editCompany) return;
    try {
      await patchCompany(editCompany, editCompanyForm);
      toast.success("Đã cập nhật thông tin công ty.");
      setEditCompany(null);
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Không cập nhật được công ty.");
    }
  };
  const loadAdmins = async (company: Company) => {
    setAdminCompany(company);
    setAdminLoading(true);
    try {
      const r = await fetch(`/api/super-admin/companies/${company.id}/admins`, { headers });
      const b = await r.json();
      if (!r.ok) throw new Error(b?.message);
      setAdmins(b.items || []);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setAdminLoading(false);
    }
  };
  const saveAdmin = async () => {
    if (!adminCompany) return;
    const target = editing ? `/${editing.id}` : "";
    const payload = editing
      ? { full_name: adminForm.full_name, email: adminForm.email }
      : adminForm;
    const r = await fetch(`/api/super-admin/companies/${adminCompany.id}/admins${target}`, {
      method: editing ? "PATCH" : "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const b = await r.json();
    if (!r.ok) throw new Error(b?.message);
    toast.success(editing ? "Đã cập nhật Admin." : "Đã tạo Admin.");
    setAdminForm({ full_name: "", username: "", email: "", password: "" });
    setEditing(null);
    await loadAdmins(adminCompany);
  };
  const adminAction = async (admin: Admin, payload: Record<string, unknown>) => {
    if (!adminCompany) return;
    try {
      const r = await fetch(`/api/super-admin/companies/${adminCompany.id}/admins/${admin.id}`, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b?.message);
      toast.success("Đã cập nhật Admin.");
      await loadAdmins(adminCompany);
    } catch (e: any) {
      toast.error(e.message);
    }
  };
  const uploadSystemLogo = async () => {
    if (!logoFile) return;
    setLogoSaving(true);
    try {
      const compressed = await compressImage(logoFile);
      const formData = new FormData();
      formData.append("logo", compressed);
      console.log("Uploading system logo:", compressed.name, compressed.type, compressed.size);
      const r = await fetch("/api/super-admin/system-logo", {
        method: "POST",
        headers,
        body: formData,
      });
      const b = await r.json();
      console.log("Upload response:", r.status, b);
      if (!r.ok) throw new Error(b?.message || "Không upload được logo hệ thống.");
      toast.success("Đã cập nhật logo hệ thống.");
      setSystemLogoOpen(false);
      setLogoFile(null);
      setLogoBust(Date.now());
    } catch (e: any) {
      console.error("Upload error:", e);
      toast.error(e.message);
    } finally {
      setLogoSaving(false);
    }
  };
  const deleteSystemLogo = async () => {
    setLogoSaving(true);
    try {
      const r = await fetch("/api/super-admin/system-logo", {
        method: "DELETE",
        headers,
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b?.message || "Không xóa được logo hệ thống.");
      toast.success("Đã xóa logo hệ thống.");
      setSystemLogoOpen(false);
      setLogoBust(Date.now());
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLogoSaving(false);
    }
  };
  const uploadCompanyLogo = async () => {
    if (!logoCompany || !logoFile) return;
    setLogoSaving(true);
    try {
      const compressed = await compressImage(logoFile);
      const formData = new FormData();
      formData.append("logo", compressed);
      const r = await fetch(`/api/super-admin/companies/${logoCompany.id}/logo`, {
        method: "POST",
        headers,
        body: formData,
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b?.message || "Không upload được logo công ty.");
      toast.success("Đã cập nhật logo công ty.");
      setLogoCompany(null);
      setLogoFile(null);
      setLogoBust(Date.now());
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLogoSaving(false);
    }
  };
  const deleteCompanyLogo = async (company: Company) => {
    try {
      const r = await fetch(`/api/super-admin/companies/${company.id}/logo`, {
        method: "DELETE",
        headers,
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b?.message || "Không xóa được logo công ty.");
      toast.success("Đã xóa logo công ty.");
      setLogoBust(Date.now());
    } catch (e: any) {
      toast.error(e.message);
    }
  };
  return (
    <PageContainer
      title="Quản trị tối cao"
      subtitle="Quản lý công ty, hạn mức và Admin"
      back={false}
      desktopWidth="wide"
      right={
        <div className="flex gap-2">
          <CompanyRestoreButton onChanged={load} />
          <Button variant="outline" size="sm" onClick={() => setSystemLogoOpen(true)}>
            <ShieldCheck className="h-4 w-4" />
            Logo hệ thống
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            Mở công ty
          </Button>
        </div>
      }
    >
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold">Danh sách công ty</h2>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          Làm mới
        </Button>
      </div>
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Array.isArray(items) && items.map((company) => {
          const used = company.usage?.employment_histories || 0;
          const max = company.max_employment_histories || 0;
          return (
            <Card key={company.id} className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-bold">{company.name}</p>
                  <p className="text-xs text-muted-foreground">{company.code}</p>
                </div>
                <Select
                  value={company.status}
                  onValueChange={(v) =>
                    void patchCompany(company, { status: v as CompanyStatus }).then(() =>
                      toast.success("Đã cập nhật trạng thái công ty."),
                    )
                  }
                >
                  <SelectTrigger
                    className={`h-auto w-auto shrink-0 gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold shadow-none [&>svg]:h-3 [&>svg]:w-3 ${
                      company.status === "active"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                        : company.status === "suspended"
                          ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                          : "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                    }`}
                    aria-label={`Trạng thái công ty ${company.name}`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Hoạt động</SelectItem>
                    <SelectItem value="suspended">Tạm khóa</SelectItem>
                    <SelectItem value="closed">Đã đóng</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div>
                  <b>{company.usage?.accounts || 0}</b>
                  <p>Tài khoản</p>
                </div>
                <div>
                  <b>{company.usage?.workers || 0}</b>
                  <p>Lao động</p>
                </div>
                <div>
                  <b>{company.usage?.factories || 0}</b>
                  <p>Nhà máy</p>
                </div>
              </div>
              <div className="rounded-xl bg-muted/60 p-2 text-xs">
                <b>
                  Lịch sử lao động: {used}/{max || "Không giới hạn"}
                </b>
                <p className="mt-1 text-muted-foreground">
                  {max === 0 ? "Không giới hạn" : used >= max ? "Đã đạt giới hạn" : "Còn chỗ"}
                </p>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                <Button
                  className="min-w-0 gap-1 px-1.5 text-[10px] sm:px-2 sm:text-xs"
                  variant="outline"
                  onClick={() => {
                    setEditCompany(company);
                    setEditCompanyForm({ name: company.name, code: company.code });
                  }}
                >
                  <Pencil className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">Sửa</span>
                </Button>
                <Button
                  className="min-w-0 gap-1 px-1.5 text-[10px] sm:px-2 sm:text-xs"
                  variant="outline"
                  onClick={() => {
                    setLimitCompany(company);
                    setLimit(String(max));
                  }}
                >
                  <Gauge className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">Hạn mức</span>
                </Button>
                <Button
                  className="min-w-0 gap-1 px-1.5 text-[10px] sm:px-2 sm:text-xs"
                  variant="outline"
                  onClick={() => {
                    setLogoCompany(company);
                    setLogoFile(null);
                  }}
                >
                  <Building2 className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">Logo</span>
                </Button>
                <Button
                  className="min-w-0 gap-1 px-1.5 text-[10px] sm:px-2 sm:text-xs"
                  onClick={() => void loadAdmins(company)}
                >
                  <UserRoundCog className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">Admin</span>
                </Button>
              </div>
              <CompanyTransferActions company={company} onChanged={load} />
            </Card>
          );
        })}
        {loading && (
          <Card className="col-span-full p-8 text-center text-sm text-muted-foreground">
            Đang tải...
          </Card>
        )}
        {!loading && (!items || items.length === 0) && (
          <Card className="col-span-full p-8 text-center text-sm text-muted-foreground">
            Chưa có công ty nào.
          </Card>
        )}
      </section>
      <Dialog open={!!editCompany} onOpenChange={(open) => !open && setEditCompany(null)}>
        <DialogContent className="max-w-md" bodyClassName="space-y-4 px-5 py-4">
          <DialogHeader>
            <DialogTitle>Sửa thông tin công ty</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="edit-company-name">Tên công ty</Label>
            <Input
              id="edit-company-name"
              value={editCompanyForm.name}
              onChange={(event) =>
                setEditCompanyForm((value) => ({ ...value, name: event.target.value }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-company-code">Mã công ty</Label>
            <Input
              id="edit-company-code"
              value={editCompanyForm.code}
              onChange={(event) =>
                setEditCompanyForm((value) => ({ ...value, code: event.target.value }))
              }
            />
            <p className="text-xs text-muted-foreground">
              Khi đổi mã, tên đăng nhập kỹ thuật của toàn bộ tài khoản thuộc công ty cũng được cập
              nhật.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditCompany(null)}>
              Hủy
            </Button>
            <Button onClick={() => void saveCompanyDetails()}>Lưu thay đổi</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-xl" bodyClassName="max-h-[75dvh] overflow-y-auto px-5 py-4">
          <DialogHeader>
            <DialogTitle>Mở công ty mới</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {Object.entries(empty).map(([key]) => (
              <div key={key} className="space-y-1">
                <Label>
                  {
                    (
                      {
                        name: "Tên công ty",
                        code: "Mã công ty",
                        admin_name: "Họ tên Admin",
                        admin_username: "Tên đăng nhập Admin",
                        admin_password: "Mật khẩu ban đầu",
                        email: "Email",
                        hotline: "Hotline",
                        max_accounts: "Giới hạn tài khoản",
                        max_workers: "Giới hạn lao động",
                        max_factories: "Giới hạn nhà máy",
                        max_file_bytes: "Dung lượng tệp",
                        max_employment_histories: "Giới hạn lịch sử lao động",
                      } as Record<string, string>
                    )[key]
                  }
                </Label>
                <Input
                  type={
                    key === "admin_password"
                      ? "password"
                      : key.startsWith("max_")
                        ? "number"
                        : "text"
                  }
                  min={key.startsWith("max_") ? 0 : undefined}
                  value={form[key as keyof typeof empty]}
                  onChange={(e) => setForm((x) => ({ ...x, [key]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Hủy
            </Button>
            <Button onClick={() => void create()} disabled={saving}>
              {saving ? "Đang tạo..." : "Mở công ty"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!limitCompany} onOpenChange={(o) => !o && setLimitCompany(null)}>
        <DialogContent className="max-w-md" bodyClassName="max-h-[75dvh] overflow-y-auto px-5 py-4">
          <DialogHeader>
            <DialogTitle>Hạn mức lịch sử lao động</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Hiện có {limitCompany?.usage?.employment_histories || 0} bản ghi. Nhập 0 để không giới
            hạn.
          </p>
          <Input type="number" min="0" value={limit} onChange={(e) => setLimit(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setLimitCompany(null)}>
              Hủy
            </Button>
            <Button
              onClick={() =>
                limitCompany &&
                void patchCompany(limitCompany, { max_employment_histories: Number(limit || 0) })
                  .then(() => {
                    toast.success("Đã lưu hạn mức.");
                    setLimitCompany(null);
                  })
                  .catch((e: any) => toast.error(e.message))
              }
            >
              Lưu hạn mức
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!adminCompany} onOpenChange={(o) => !o && setAdminCompany(null)}>
        <DialogContent className="max-w-xl" bodyClassName="max-h-[75dvh] overflow-y-auto px-5 py-4">
          <DialogHeader>
            <DialogTitle>Quản trị Admin - {adminCompany?.name}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              placeholder="Họ tên"
              value={adminForm.full_name}
              onChange={(e) => setAdminForm((x) => ({ ...x, full_name: e.target.value }))}
            />
            <Input
              placeholder="Email"
              value={adminForm.email}
              onChange={(e) => setAdminForm((x) => ({ ...x, email: e.target.value }))}
            />
            {!editing && (
              <>
                <Input
                  placeholder="Tên đăng nhập"
                  value={adminForm.username}
                  onChange={(e) => setAdminForm((x) => ({ ...x, username: e.target.value }))}
                />
                <Input
                  type="password"
                  placeholder="Mật khẩu tối thiểu 8 ký tự"
                  value={adminForm.password}
                  onChange={(e) => setAdminForm((x) => ({ ...x, password: e.target.value }))}
                />
              </>
            )}
            <Button
              className="sm:col-span-2"
              onClick={() => void saveAdmin().catch((e: any) => toast.error(e.message))}
            >
              {editing ? "Lưu thông tin" : "Tạo Admin"}
            </Button>
          </div>
          <div className="space-y-2">
            {adminLoading ? (
              <p className="text-sm">Đang tải...</p>
            ) : (
              admins.map((admin) => (
                <div className="rounded-xl border p-3" key={admin.id}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <b>{admin.full_name || admin.username}</b>
                      <p className="text-xs text-muted-foreground">
                        @{admin.display_username || admin.username} ·{" "}
                        {admin.email || "Chưa có email"}
                      </p>
                    </div>
                    <span className="text-xs">
                      {admin.status === "disabled" ? "Đã khóa" : "Hoạt động"}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditing(admin);
                        setAdminForm({
                          full_name: admin.full_name || "",
                          username: "",
                          email: admin.email || "",
                          password: "",
                        });
                      }}
                    >
                      Sửa
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void adminAction(admin, {
                          status: admin.status === "disabled" ? "active" : "disabled",
                        })
                      }
                    >
                      {admin.status === "disabled" ? "Mở khóa" : "Khóa"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const password = prompt("Nhập mật khẩu mới (tối thiểu 8 ký tự):");
                        if (password)
                          void adminAction(admin, { action: "reset_password", password });
                      }}
                    >
                      Đặt lại mật khẩu
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdminCompany(null)}>
              Đóng
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={systemLogoOpen} onOpenChange={(o) => !o && setSystemLogoOpen(false)}>
        <DialogContent className="max-w-md" bodyClassName="space-y-4 px-5 py-4">
          <DialogHeader>
            <DialogTitle>Logo hệ thống</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Logo mặc định dùng cho favicon, biểu tượng cài đặt (PWA) và các công ty chưa có logo
            riêng.
          </p>
          <div className="flex justify-center">
            <img
              src={`/api/public/app-icon?t=${logoBust}`}
              alt="Logo hệ thống hiện tại"
              className="h-20 w-20 rounded-xl border object-contain"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="system-logo-file">Chọn ảnh logo mới</Label>
            <Input
              id="system-logo-file"
              type="file"
              accept="image/*"
              onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => void deleteSystemLogo()}
              disabled={logoSaving}
            >
              Về mặc định
            </Button>
            <Button onClick={() => void uploadSystemLogo()} disabled={logoSaving || !logoFile}>
              {logoSaving ? "Đang lưu..." : "Lưu logo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!logoCompany} onOpenChange={(o) => !o && setLogoCompany(null)}>
        <DialogContent className="max-w-md" bodyClassName="space-y-4 px-5 py-4">
          <DialogHeader>
            <DialogTitle>Logo công ty - {logoCompany?.name}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Logo riêng của công ty này. Nếu không đặt, công ty sẽ dùng logo hệ thống.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="company-logo-file">Chọn ảnh logo</Label>
            <Input
              id="company-logo-file"
              type="file"
              accept="image/*"
              onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => logoCompany && void deleteCompanyLogo(logoCompany)}
              disabled={logoSaving}
            >
              Xóa logo
            </Button>
            <Button onClick={() => void uploadCompanyLogo()} disabled={logoSaving || !logoFile}>
              {logoSaving ? "Đang lưu..." : "Lưu logo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
