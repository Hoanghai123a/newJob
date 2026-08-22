import { useState } from "react";
import { AlertTriangle, Download, Trash2, Upload } from "lucide-react";
import { pb } from "@/lib/pocketbase";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type TransferCompany = {
  id: string;
  name: string;
  code: string;
};

type PurgePreview = {
  company: TransferCompany;
  counts: Record<string, number>;
  warnings?: string[];
};
type RestorePreview = {
  manifest: {
    exportedAt: string;
    company: TransferCompany;
    counts: Record<string, number>;
    fileCount: number;
    fileBytes: number;
  };
  checksum: string;
};

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function CompanyTransferActions({
  company,
  onChanged,
}: {
  company: TransferCompany;
  onChanged: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<PurgePreview | null>(null);
  const [backupChecksum, setBackupChecksum] = useState("");
  const [form, setForm] = useState({
    password: "",
    companyCode: "",
    confirmationText: "",
    skipBackupText: "",
  });
  const headers = { Authorization: `Bearer ${pb.authStore.token}` };

  const downloadBackup = async () => {
    setBusy(true);
    try {
      const response = await fetch(`/api/super-admin/companies/${company.id}/export`, {
        method: "POST",
        headers,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message || "Không tạo được bản sao lưu.");
      }
      const disposition = response.headers.get("content-disposition") || "";
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1] || `${company.code}-backup.zip`;
      setBackupChecksum(response.headers.get("x-backup-sha256") || "");
      downloadBlob(await response.blob(), filename);
      toast.success("Đã tải bản sao lưu công ty.");
    } catch (error: any) {
      toast.error(error?.message || "Không tải được bản sao lưu.");
    } finally {
      setBusy(false);
    }
  };

  const showPurge = async () => {
    setOpen(true);
    setPreview(null);
    setBackupChecksum("");
    setForm({ password: "", companyCode: "", confirmationText: "", skipBackupText: "" });
    setBusy(true);
    try {
      const response = await fetch(`/api/super-admin/companies/${company.id}/purge`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview" }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.message);
      setPreview(body);
    } catch (error: any) {
      toast.error(error?.message || "Không kiểm tra được dữ liệu công ty.");
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const purge = async () => {
    setBusy(true);
    try {
      const response = await fetch(`/api/super-admin/companies/${company.id}/purge`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", ...form, backupChecksum }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.message);
      toast.success("Đã xóa vĩnh viễn công ty và toàn bộ dữ liệu liên quan.");
      setOpen(false);
      await onChanged();
    } catch (error: any) {
      toast.error(error?.message || "Không xóa được công ty.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-1.5 border-t border-border/60 pt-3">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void downloadBackup()}>
          <Download className="h-3.5 w-3.5" /> Sao lưu
        </Button>
        <Button size="sm" variant="destructive" disabled={busy} onClick={() => void showPurge()}>
          <Trash2 className="h-3.5 w-3.5" /> Xóa vĩnh viễn
        </Button>
      </div>
      <Dialog open={open} onOpenChange={(value) => !busy && setOpen(value)}>
        <DialogContent className="max-w-xl" bodyClassName="space-y-4 px-5 py-4">
          <DialogHeader>
            <DialogTitle>Xóa vĩnh viễn công ty</DialogTitle>
          </DialogHeader>
          <div className="flex gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
            <div>
              <b>Không thể hoàn tác.</b>
              <p className="text-xs text-muted-foreground">
                Toàn bộ tài khoản, nhà máy, lịch sử, tài chính và tệp của {company.name} sẽ bị xóa.
              </p>
            </div>
          </div>
          {preview && (
            <div className="max-h-40 overflow-y-auto rounded-xl bg-muted/40 p-3 text-xs">
              {Object.entries(preview.counts).map(([name, count]) => (
                <div key={name} className="flex justify-between gap-3">
                  <span>{name}</span>
                  <b>{count}</b>
                </div>
              ))}
            </div>
          )}
          <Button variant="outline" onClick={() => void downloadBackup()} disabled={busy}>
            <Download className="h-4 w-4" />{" "}
            {backupChecksum ? "Đã tải bản sao lưu" : "Tải bản sao lưu trước khi xóa"}
          </Button>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Mật khẩu Super Admin</Label>
              <Input
                type="password"
                value={form.password}
                onChange={(e) => setForm((x) => ({ ...x, password: e.target.value }))}
              />
            </div>
            <div>
              <Label>Nhập mã công ty</Label>
              <Input
                value={form.companyCode}
                onChange={(e) => setForm((x) => ({ ...x, companyCode: e.target.value }))}
              />
            </div>
            <div className="sm:col-span-2">
              <Label>Nhập “XÓA VĨNH VIỄN”</Label>
              <Input
                value={form.confirmationText}
                onChange={(e) => setForm((x) => ({ ...x, confirmationText: e.target.value }))}
              />
            </div>
            {!backupChecksum && (
              <div className="sm:col-span-2">
                <Label>Xóa không sao lưu: nhập “TÔI CHẤP NHẬN XÓA KHÔNG CÓ BẢN SAO LƯU”</Label>
                <Input
                  value={form.skipBackupText}
                  onChange={(e) => setForm((x) => ({ ...x, skipBackupText: e.target.value }))}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Hủy
            </Button>
            <Button variant="destructive" onClick={() => void purge()} disabled={busy || !preview}>
              {busy ? "Đang xử lý..." : "Xóa vĩnh viễn"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function CompanyRestoreButton({ onChanged }: { onChanged: () => void | Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const headers = { Authorization: `Bearer ${pb.authStore.token}` };

  const inspect = async (selected: File) => {
    setFile(selected);
    setPreview(null);
    setBusy(true);
    try {
      const data = new FormData();
      data.append("file", selected);
      const response = await fetch("/api/super-admin/companies/import/preview", {
        method: "POST",
        headers,
        body: data,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.message);
      setPreview(body);
    } catch (error: any) {
      toast.error(error?.message || "File sao lưu không hợp lệ.");
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (!file || !preview) return;
    setBusy(true);
    try {
      const data = new FormData();
      data.append("file", file);
      const response = await fetch("/api/super-admin/companies/import", {
        method: "POST",
        headers,
        body: data,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.message);
      const credentials = Array.isArray(body.credentials) ? body.credentials : [];
      const csv = [
        "username,password,role",
        ...credentials.map((item: any) =>
          [item.username, item.password, item.role]
            .map((value) => `"${String(value).replace(/"/g, '""')}"`)
            .join(","),
        ),
      ].join("\r\n");
      downloadBlob(
        new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }),
        `${preview.manifest.company.code}-tai-khoan-tam.csv`,
      );
      toast.success("Đã khôi phục công ty và tải danh sách mật khẩu tạm.");
      setOpen(false);
      setFile(null);
      setPreview(null);
      await onChanged();
    } catch (error: any) {
      toast.error(error?.message || "Không khôi phục được công ty.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Upload className="h-4 w-4" /> Khôi phục
      </Button>
      <Dialog open={open} onOpenChange={(value) => !busy && setOpen(value)}>
        <DialogContent className="max-w-xl" bodyClassName="space-y-4 px-5 py-4">
          <DialogHeader>
            <DialogTitle>Khôi phục công ty từ bản sao lưu</DialogTitle>
          </DialogHeader>
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center">
            <Upload className="h-7 w-7 text-primary" />
            <span className="text-sm font-semibold">Chọn file ZIP sao lưu</span>
            <span className="text-xs text-muted-foreground">
              Hệ thống kiểm tra manifest và checksum trước khi import.
            </span>
            <input
              type="file"
              accept=".zip,application/zip"
              hidden
              disabled={busy}
              onChange={(event) => {
                const selected = event.target.files?.[0];
                if (selected) void inspect(selected);
              }}
            />
          </label>
          {preview && (
            <div className="space-y-2 rounded-2xl border bg-muted/30 p-3 text-sm">
              <b>{preview.manifest.company.name}</b>
              <p>Mã công ty: {preview.manifest.company.code}</p>
              <p>
                {Object.values(preview.manifest.counts).reduce((sum, value) => sum + value, 0)} bản
                ghi · {preview.manifest.fileCount} tệp
              </p>
              <p className="break-all text-xs text-muted-foreground">SHA-256: {preview.checksum}</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Hủy
            </Button>
            <Button onClick={() => void restore()} disabled={!preview || busy}>
              {busy ? "Đang xử lý..." : "Khôi phục công ty"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
