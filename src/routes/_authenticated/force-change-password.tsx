import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { pb } from "@/lib/pocketbase";
import { getClientDeviceProfile } from "@/lib/device-profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { KeyRound, Loader2, LogOut } from "lucide-react";
import { toast } from "@/lib/toast";

export const Route = createFileRoute("/_authenticated/force-change-password")({
  component: ForceChangePasswordPage,
});

function ForceChangePasswordPage() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!user) return;
    if (!currentPwd || !newPwd || !confirmPwd) {
      toast.error("Vui lòng nhập đầy đủ thông tin");
      return;
    }
    if (newPwd.length < 8) {
      toast.error("Mật khẩu mới tối thiểu 8 ký tự");
      return;
    }
    if (newPwd === currentPwd) {
      toast.error("Mật khẩu mới không được trùng mật khẩu hiện tại");
      return;
    }
    if (newPwd !== confirmPwd) {
      toast.error("Mật khẩu xác nhận không khớp");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/public/force-change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${pb.authStore.token}`,
        },
        body: JSON.stringify({
          currentPassword: currentPwd,
          password: newPwd,
          passwordConfirm: confirmPwd,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.message || "Lỗi đổi mật khẩu");
      pb.authStore.save(payload.token, payload.record);
      toast.success("Đổi mật khẩu thành công");
      const role = user.role;
      if (role === "admin")
        nav({ to: getClientDeviceProfile() === "desktop" ? "/admin/workforce" : "/" });
      else if (role === "staff") nav({ to: "/staff" });
      else nav({ to: "/" });
    } catch (e: any) {
      toast.error(e?.response?.message || e?.message || "Lỗi đổi mật khẩu");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-background px-4 desktop:bg-transparent">
      <Card className="w-full max-w-sm space-y-5 p-6 desktop:max-w-xl desktop:p-8 desktop:shadow-card">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <KeyRound className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-lg font-bold">Đổi mật khẩu</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tài khoản đang sử dụng mật khẩu mặc định. Vui lòng đổi mật khẩu để tiếp tục.
          </p>
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Mật khẩu hiện tại</Label>
            <Input
              type="password"
              value={currentPwd}
              onChange={(e) => setCurrentPwd(e.target.value)}
              autoFocus
              autoComplete="current-password"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Mật khẩu mới (≥ 8 ký tự)</Label>
            <Input
              type="password"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Xác nhận mật khẩu mới</Label>
            <Input
              type="password"
              value={confirmPwd}
              onChange={(e) => setConfirmPwd(e.target.value)}
              autoComplete="new-password"
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
          </div>
        </div>

        <Button onClick={submit} disabled={saving} className="w-full">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
          {saving ? "Đang xử lý..." : "Đổi mật khẩu"}
        </Button>
        <Button
          variant="outline"
          disabled={saving}
          className="w-full"
          onClick={() => {
            logout();
            nav({ to: "/login", replace: true });
          }}
        >
          <LogOut className="h-4 w-4" /> Đăng xuất
        </Button>
      </Card>
    </div>
  );
}
