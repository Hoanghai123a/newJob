import { useEffect, useState } from "react";
import { AlertTriangle, Eye, EyeOff, Loader2, Trash2 } from "lucide-react";
import { toast } from "@/lib/toast";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { pb, type UserRecord } from "@/lib/pocketbase";
import type { WorkerRecord } from "@/lib/workers";
import { getUserErrorMessage } from "@/lib/toast";

type DeleteDependency = {
  collection: string;
  label: string;
  count: number;
};

type DeletePreview = {
  workerId: string;
  dependencies: DeleteDependency[];
  employmentHistoryCount: number;
};

type DeleteErrorPayload = {
  code?: string;
  message?: string;
  dependencies?: DeleteDependency[];
  deletedEmploymentHistoryCount?: number;
  preview?: DeletePreview;
};

type DeleteWorkerDialogProps = {
  worker: WorkerRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: (workerId: string) => void | Promise<void>;
};

function formatDateTime(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("vi-VN");
}

export function DeleteWorkerDialog({
  worker,
  open,
  onOpenChange,
  onDeleted,
}: DeleteWorkerDialogProps) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [preview, setPreview] = useState<DeletePreview | null>(null);
  const [dependencies, setDependencies] = useState<DeleteDependency[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const admin = pb.authStore.record as UserRecord | null;
  const adminIdentity = admin?.username || admin?.email || "";

  useEffect(() => {
    if (!open) {
      setPassword("");
      setShowPassword(false);
      setConfirmed(false);
      setPreviewLoading(false);
      setSubmitting(false);
      setPreview(null);
      setDependencies([]);
      setErrorMessage("");
      return;
    }

    if (!worker?.id) return;

    let active = true;
    setPassword("");
    setShowPassword(false);
    setConfirmed(false);
    setPreview(null);
    setDependencies([]);
    setErrorMessage("");
    setPreviewLoading(true);

    fetch(`/api/admin/workers/${encodeURIComponent(worker.id)}/delete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${pb.authStore.token}`,
      },
      body: JSON.stringify({ action: "preview" }),
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as DeleteErrorPayload;
        if (!response.ok) {
          throw new Error(payload.message || "Không thể tải thông tin trước khi xóa.");
        }
        if (active) {
          setPreview(payload.preview || null);
          setDependencies(payload.preview?.dependencies || []);
        }
      })
      .catch((error) => {
        if (active) {
          setErrorMessage(getUserErrorMessage(error, "Không thể tải thông tin trước khi xóa."));
        }
      })
      .finally(() => {
        if (active) setPreviewLoading(false);
      });

    return () => {
      active = false;
    };
  }, [open, worker?.id]);

  const submit = async () => {
    if (!worker?.id || submitting || previewLoading) return;
    if (!preview) {
      setErrorMessage("Chưa tải được thông tin cần xác nhận.");
      return;
    }
    if (!confirmed) {
      setErrorMessage("Vui lòng tick xác nhận đã đọc và nắm rõ thông tin.");
      return;
    }
    if (!password) {
      setErrorMessage("Vui lòng nhập mật khẩu Admin.");
      return;
    }

    setSubmitting(true);
    setDependencies([]);
    setErrorMessage("");
    try {
      const response = await fetch(`/api/admin/workers/${encodeURIComponent(worker.id)}/delete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${pb.authStore.token}`,
        },
        body: JSON.stringify({ action: "delete", password, confirmed: true }),
      });
      const payload = (await response.json().catch(() => ({}))) as DeleteErrorPayload & {
        workerId?: string;
      };

      if (!response.ok) {
        if (payload.code === "WORKER_HAS_DEPENDENCIES") {
          setDependencies(Array.isArray(payload.dependencies) ? payload.dependencies : []);
        }
        throw new Error(payload.message || "Không thể xóa hồ sơ NLĐ.");
      }

      await onDeleted(payload.workerId || worker.id);
      const historyCount = Number(payload.deletedEmploymentHistoryCount || 0);
      toast.success(
        historyCount > 0
          ? `Đã xóa hồ sơ, ${historyCount} lịch sử đi làm và lưu nhật ký`
          : "Đã xóa hồ sơ NLĐ và lưu nhật ký",
      );
      onOpenChange(false);
    } catch (error) {
      setErrorMessage(getUserErrorMessage(error, "Không thể xóa hồ sơ NLĐ."));
    } finally {
      setSubmitting(false);
    }
  };

  const name = worker?.full_name || worker?.uid || worker?.phone || "NLĐ này";
  const canContinue = Boolean(preview && confirmed && password);

  return (
    <AlertDialog open={open} onOpenChange={(nextOpen) => !submitting && onOpenChange(nextOpen)}>
      <AlertDialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl">
        <AlertDialogHeader>
          <div className="flex items-start gap-3 text-left">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <div className="min-w-0 space-y-1">
              <AlertDialogTitle>Xóa hồ sơ NLĐ?</AlertDialogTitle>
              <AlertDialogDescription>
                Hồ sơ và lịch sử liên quan sẽ bị xóa vĩnh viễn. Hãy đọc kỹ dữ liệu bị ảnh hưởng
                trước khi xác nhận.
              </AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>

        <div className="space-y-4 px-6 py-4">
          <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm">
            <div className="font-semibold text-foreground">{name}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {worker?.uid ? `UID ${worker.uid}` : "Chưa có UID"}
              {worker?.phone ? ` · ${worker.phone}` : ""}
            </div>
          </div>

          {previewLoading && (
            <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Đang kiểm tra dữ liệu liên quan...
            </div>
          )}

          {preview && (
            <>
              <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                <div className="font-semibold">Dữ liệu sẽ bị ảnh hưởng</div>
                {dependencies.length > 0 ? (
                  <ul className="space-y-1 text-xs">
                    {dependencies.map((item) => (
                      <li key={item.collection} className="flex items-center justify-between gap-3">
                        <span>{item.label}</span>
                        <span className="font-semibold">{item.count} bản ghi</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs">Không phát hiện nghiệp vụ tiền đang chặn xóa.</p>
                )}
                <div className="flex items-center justify-between gap-3 border-t border-amber-200 pt-2 text-xs">
                  <span>Lịch sử đi làm</span>
                  <span className="font-semibold">{preview.employmentHistoryCount} bản ghi</span>
                </div>
                <p className="text-xs">
                  Hành động không thể hoàn tác. Các nghiệp vụ tiền đang tồn tại sẽ chặn thao tác
                  xóa.
                </p>
              </div>

              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-card p-3 text-sm leading-relaxed">
                <Checkbox
                  checked={confirmed}
                  onCheckedChange={(checked) => {
                    setConfirmed(checked === true);
                    setErrorMessage("");
                  }}
                  disabled={submitting}
                  className="mt-0.5"
                />
                <span>
                  Tôi đã đọc, hiểu và chấp nhận việc hồ sơ cùng dữ liệu liên quan có thể bị xóa
                  không thể khôi phục.
                </span>
              </label>

              {confirmed && (
                <form
                  id="delete-worker-auth-form"
                  className="space-y-1.5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submit();
                  }}
                >
                  <input
                    type="text"
                    name="username"
                    autoComplete="username"
                    value={adminIdentity}
                    readOnly
                    tabIndex={-1}
                    aria-hidden="true"
                    className="sr-only"
                  />
                  <Label htmlFor="delete-worker-admin-password">Mật khẩu Admin hiện tại</Label>
                  <div className="relative">
                    <Input
                      id="delete-worker-admin-password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(event) => {
                        setPassword(event.target.value);
                        setErrorMessage("");
                        setDependencies([]);
                      }}
                      autoComplete="current-password"
                      autoFocus
                      disabled={submitting}
                      placeholder="Nhập mật khẩu để xác nhận"
                      className="pr-12"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((visible) => !visible)}
                      disabled={submitting}
                      className="absolute right-1 top-1 flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
                      aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </form>
              )}
            </>
          )}

          {errorMessage && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {errorMessage}
            </div>
          )}

          {dependencies.length > 0 && preview && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
              Hãy xử lý các nghiệp vụ tiền trước hoặc chuyển hồ sơ sang ngừng hoạt động rồi thử lại.
            </div>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>Hủy</AlertDialogCancel>
          {preview && (
            <Button
              type="submit"
              form="delete-worker-auth-form"
              variant="destructive"
              disabled={submitting || previewLoading || !canContinue}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Đang kiểm tra...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" /> Xác nhận xóa
                </>
              )}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
