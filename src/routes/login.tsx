import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Eye, EyeOff, Loader2, LogIn, ShieldCheck } from "lucide-react";
import { toast } from "@/lib/toast";
import { PASSWORD_REAUTH_NOTICE_KEY, useAuth } from "@/lib/auth";
import { normalizeAccountIdentity } from "@/lib/account-identity";
import { pb } from "@/lib/pocketbase";
import { getClientDeviceProfile } from "@/lib/device-profile";
import {
  CompanyCodeField,
  getRememberedCompanyCode,
  useCompanyCodeLookup,
} from "@/components/auth/CompanyCodeField";
import { BackButton } from "@/components/layout/BackButton";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

export const Route = createFileRoute("/login")({
  beforeLoad: () => {
    if (typeof window === "undefined" || !pb.authStore.isValid) return;
    const role = pb.authStore.record?.role;
    const isDesktop = getClientDeviceProfile() === "desktop";
    if (role === "super_admin") throw redirect({ to: "/super-admin" });
    if (role === "admin" && isDesktop) throw redirect({ to: "/admin/workforce" });
    if (role === "staff") throw redirect({ to: isDesktop ? "/staff/workers" : "/staff" });
    throw redirect({ to: "/" });
  },
  component: LoginPage,
});

function LoginPage() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [companyCode, setCompanyCode] = useState("");
  const [identity, setIdentity] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [superAdmin, setSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(false);
  const companyLookup = useCompanyCodeLookup(companyCode, !superAdmin);

  useEffect(() => {
    setCompanyCode(getRememberedCompanyCode());
    const notice = window.sessionStorage.getItem(PASSWORD_REAUTH_NOTICE_KEY);
    if (!notice) return;
    window.sessionStorage.removeItem(PASSWORD_REAUTH_NOTICE_KEY);
    toast.info(notice);
  }, []);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const loginName = normalizeAccountIdentity(identity);
    if (!loginName || !password || (!superAdmin && !companyLookup.company)) {
      toast.warning("Thiếu hoặc chưa xác thực thông tin đăng nhập", {
        description:
          !superAdmin && !companyLookup.company
            ? "Vui lòng nhập đúng mã công ty."
            : !loginName
              ? "Vui lòng nhập tên đăng nhập."
              : "Vui lòng nhập mật khẩu.",
      });
      return;
    }
    setLoading(true);
    const toastId = toast.loading("Đang đăng nhập...", {
      description: "Đang kiểm tra tài khoản với máy chủ.",
    });
    try {
      const loggedInUser = await login(
        loginName,
        password,
        superAdmin ? { superAdmin: true } : { companyCode },
      );
      const name =
        loggedInUser.full_name || loggedInUser.login_name || loggedInUser.username || "bạn";
      if (loggedInUser.must_change_password) {
        toast.info("Vui lòng đổi mật khẩu để tiếp tục", {
          id: toastId,
          description: "Tài khoản đang sử dụng mật khẩu mặc định.",
        });
        nav({ to: "/force-change-password" });
        return;
      }
      const role = loggedInUser.role;
      toast.success(`Chào mừng ${name}`, {
        id: toastId,
        description:
          role === "super_admin"
            ? "Bạn đã đăng nhập với quyền quản trị tối cao."
            : role === "admin"
              ? "Bạn đã đăng nhập với quyền quản trị viên."
              : "Bạn đã đăng nhập với quyền nhân sự.",
      });
      if (role === "super_admin") return void nav({ to: "/super-admin" });
      if (role === "admin")
        return void nav({ to: getClientDeviceProfile() === "desktop" ? "/admin/workforce" : "/" });
      if (role === "staff")
        return void nav({
          to: getClientDeviceProfile() === "desktop" ? "/staff/workers" : "/staff",
        });
      throw new Error("Tài khoản này không được phép đăng nhập hệ thống quản trị.");
    } catch (error: any) {
      const message = error?.data?.message || error?.message || "Đăng nhập thất bại";
      toast.error("Đăng nhập thất bại", {
        id: toastId,
        description: /Failed to authenticate|invalid|credentials|password/i.test(message)
          ? "Tên đăng nhập hoặc mật khẩu không đúng"
          : message,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="relative flex min-h-[100dvh] flex-col overflow-hidden bg-background desktop:fixed desktop:inset-0 desktop:z-40 desktop:grid desktop:grid-cols-[minmax(0,1.2fr)_minmax(32rem,0.8fr)]">
      {loading ? <LoginLoadingOverlay /> : null}
      <MobileBrandHeader />
      <DesktopBrandPanel />
      <section className="relative flex min-w-0 flex-1 desktop:items-center desktop:justify-center desktop:bg-muted/30 desktop:px-12">
        <LoginFormCard
          companyCode={companyCode}
          identity={identity}
          password={password}
          superAdmin={superAdmin}
          showPassword={showPassword}
          loading={loading}
          lookup={companyLookup}
          onCompanyCodeChange={setCompanyCode}
          onIdentityChange={setIdentity}
          onPasswordChange={setPassword}
          onSuperAdminChange={setSuperAdmin}
          onTogglePassword={() => setShowPassword((visible) => !visible)}
          onSubmit={onSubmit}
        />
      </section>
    </main>
  );
}

function LoginLoadingOverlay() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/70 backdrop-blur-sm"
    >
      <div className="flex size-16 items-center justify-center rounded-2xl bg-card shadow-soft">
        <Loader2 className="size-7 animate-spin text-primary" aria-hidden="true" />
      </div>
      <p className="mt-4 text-sm font-medium text-muted-foreground">Đang đăng nhập...</p>
    </div>
  );
}
function MobileBrandHeader() {
  return (
    <header className="gradient-primary relative px-6 pb-16 pt-16 text-primary-foreground desktop:hidden">
      <BackButton className="absolute left-4 top-4 text-primary-foreground active:bg-white/15" />
      <h1 className="text-3xl font-bold tracking-tight">Hoàng Long DJC</h1>
      <p className="mt-1 text-sm text-primary-foreground/80">
        Kết nối người lao động và nhà tuyển dụng
      </p>
    </header>
  );
}
function DesktopBrandPanel() {
  return (
    <section className="relative hidden min-h-[100dvh] overflow-hidden border-r border-border bg-background desktop:flex desktop:flex-col">
      <header className="relative z-10 flex items-center gap-4 px-12 py-10 xl:px-16">
        <BackButton className="border border-border bg-card shadow-soft hover:bg-muted" />
        <p className="text-xl font-bold tracking-tight text-foreground">Hoàng Long DJC</p>
      </header>
      <div className="relative z-10 flex flex-1 items-center px-16 pb-28 xl:px-24">
        <h1 className="max-w-2xl text-5xl font-bold leading-[1.16] tracking-[-0.035em] text-foreground xl:text-6xl">
          Kết nối người lao động và nhà tuyển dụng
        </h1>
      </div>
    </section>
  );
}

function LoginFormCard({
  companyCode,
  identity,
  password,
  superAdmin,
  showPassword,
  loading,
  lookup,
  onCompanyCodeChange,
  onIdentityChange,
  onPasswordChange,
  onSuperAdminChange,
  onTogglePassword,
  onSubmit,
}: any) {
  return (
    <Card className="mx-4 -mt-8 flex w-[calc(100%-2rem)] min-w-0 flex-none rounded-[1.75rem] border-border/70 bg-card/95 shadow-soft backdrop-blur desktop:mx-0 desktop:mt-0 desktop:w-full desktop:max-w-[460px] desktop:flex-none desktop:rounded-2xl">
      <form onSubmit={onSubmit} noValidate className="flex h-full w-full min-w-0 flex-col">
        <CardHeader className="hidden px-8 pb-2 pt-8 text-center desktop:flex">
          <CardTitle className="text-3xl font-bold tracking-tight">Chào mừng trở lại</CardTitle>
          <CardDescription className="text-base">
            Đăng nhập để tiếp tục công việc của bạn.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5 p-6 desktop:px-8 desktop:pb-6 desktop:pt-6">
          <Button
            type="button"
            variant={superAdmin ? "default" : "outline"}
            className="w-full"
            disabled={loading}
            onClick={() => onSuperAdminChange(!superAdmin)}
          >
            <ShieldCheck />
            {superAdmin ? "Đang đăng nhập Quản trị hệ thống" : "Quản trị hệ thống"}
          </Button>
          {!superAdmin ? (
            <CompanyCodeField
              code={companyCode}
              disabled={loading}
              checking={lookup.checking}
              company={lookup.company}
              message={lookup.message}
              onChange={onCompanyCodeChange}
            />
          ) : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="identity">Tên đăng nhập</Label>
            <Input
              id="identity"
              value={identity}
              disabled={loading}
              onChange={(event) => onIdentityChange(event.target.value)}
              autoComplete="username"
              placeholder="Nhập tên đăng nhập"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Mật khẩu</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                disabled={loading}
                onChange={(event) => onPasswordChange(event.target.value)}
                autoComplete="current-password"
                placeholder="Nhập mật khẩu"
                className="pr-12"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={loading}
                onClick={onTogglePassword}
                aria-label={showPassword ? "Ẩn mật khẩu" : "Hiển thị mật khẩu"}
                className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              </Button>
            </div>
          </div>
          <Button
            type="submit"
            className="w-full"
            disabled={loading || (!superAdmin && !lookup.company)}
          >
            {loading ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <LogIn aria-hidden="true" />
            )}
            {loading ? "Đang đăng nhập..." : "Đăng nhập"}
          </Button>
        </CardContent>
        <CardFooter className="flex flex-col px-6 pb-6 pt-0 desktop:px-8 desktop:pb-8">
          <Separator className="mb-5 hidden desktop:block" />
          <p className="text-center text-sm text-muted-foreground">
            Tài khoản quản trị do Superadmin hoặc Admin cấp.
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
