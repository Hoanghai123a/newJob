import { useEffect, useState } from "react";
import { Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { accountLoginName } from "@/lib/login-identity";
import { pb, type UserRecord } from "@/lib/pocketbase";
import { getUserErrorMessage, toast } from "@/lib/toast";

export function PromoteStaffDialog({
  staff,
  open,
  onClose,
  onPromoted,
}: {
  staff: UserRecord | null;
  open: boolean;
  onClose: () => void;
  onPromoted: () => void;
}) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const admin = pb.authStore.record as UserRecord | null;
  const adminIdentity = admin?.username || admin?.email || "";

  useEffect(() => {
    if (!open) {
      setPassword("");
      setShowPassword(false);
      setSubmitting(false);
      setErrorMessage("");
    }
  }, [open]);

  const submit = async () => {
    if (!staff?.id || submitting) return;
    if (!password) {
      setErrorMessage("Vui lòng nhập mật khẩu Admin.");
      return;
    }

    setSubmitting(true);
    setErrorMessage("");
    try {
      const response = await fetch(`/api/admin/staff/${encodeURIComponent(staff.id)}/promote`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${pb.authStore.token}`,
        },
        body: JSON.stringify({ password }),
      });
      const payload = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) throw new Error(payload.message || "Không thể nâng quyền tài khoản.");

      toast.success(`Đã ủy quyền "${staff.full_name || staff.username}" lên Admin`);
      onClose();
      onPromoted();
    } catch (error) {
      setErrorMessage(getUserErrorMessage(error, "Không thể nâng quyền tài khoản."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => !submitting && !next && onClose()}>
      <AlertDialogContent className="rounded-2xl">
        <AlertDialogHeader>
          <div className="flex items-start gap-3 text-left">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div className="min-w-0 space-y-1">
              <AlertDialogTitle>Ủy quyền lên Admin?</AlertDialogTitle>
              <AlertDialogDescription>
                Tài khoản Admin có quyền trên toàn bộ dữ liệu công ty. Không thể hạ quyền lại từ
                trang này.
              </AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>

        <div className="space-y-4">
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm">
            <div className="font-semibold text-foreground">
              {staff?.full_name || staff?.username || "Tài khoản này"}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              @{accountLoginName(staff) || "—"}
              {staff?.phone ? ` · ${staff.phone}` : ""}
            </div>
            <div className="mt-2 border-t border-primary/10 pt-2 text-xs font-medium text-primary">
              Staff → Admin
            </div>
          </div>

          <form
            id="promote-staff-auth-form"
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
            <Label htmlFor="promote-staff-admin-password">Mật khẩu Admin hiện tại</Label>
            <div className="relative">
              <Input
                id="promote-staff-admin-password"
                name="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setErrorMessage("");
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

          {errorMessage && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {errorMessage}
            </div>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>Hủy</AlertDialogCancel>
          <Button
            type="submit"
            form="promote-staff-auth-form"
            disabled={submitting || !password}
            className="rounded-xl"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Đang xử lý...
              </>
            ) : (
              <>
                <ShieldCheck className="h-4 w-4" /> Xác nhận ủy quyền
              </>
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
