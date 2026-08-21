import { createFileRoute, Outlet, redirect, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { pb } from "@/lib/pocketbase";
import { useAuth } from "@/lib/auth";
import { BottomNav } from "@/components/layout/BottomNav";
import { StaffRealtimeSyncGate } from "@/components/staff/StaffRealtimeSyncGate";
import { DesktopAppShell } from "@/components/layout/DesktopAppShell";
import { DataLoadingState } from "@/components/ui/data-loading-state";
import { StaffExcelExportProvider } from "@/components/staff/StaffExcelExportProvider";

const LOGIN_ROLES = new Set(["super_admin", "admin", "staff"]);

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: ({ location }) => {
    // Auth lives in localStorage — only enforce on the client to avoid SSR redirect loops.
    if (typeof window === "undefined") return;
    if (!pb.authStore.isValid) {
      throw redirect({ to: "/login", search: { redirect: location.href } as any });
    }
    const u = pb.authStore.record as any;
    if (u?.status === "disabled" || !LOGIN_ROLES.has(String(u?.role || ""))) {
      pb.authStore.clear();
      throw redirect({ to: "/login" });
    }
    if (u?.role === "super_admin" && !location.pathname.startsWith("/super-admin")) {
      throw redirect({ to: "/super-admin" });
    }
    if (u?.must_change_password && !location.pathname.includes("force-change-password")) {
      throw redirect({ to: "/force-change-password" });
    }
  },
  component: AuthLayout,
});

function AuthLayout() {
  const { loading, user } = useAuth();
  const nav = useNavigate();

  useEffect(() => {
    if (!loading && !user) {
      nav({ to: "/login", search: { redirect: window.location.pathname } as any });
    }
  }, [loading, nav, user]);

  if (loading || !user) {
    return <DataLoadingState variant="page" label="Đang xác thực tài khoản..." rows={4} />;
  }

  return (
    <StaffExcelExportProvider>
      <div className="pb-nav">
        {!user.must_change_password && <StaffRealtimeSyncGate />}
        <DesktopAppShell>
          <Outlet />
        </DesktopAppShell>
        <BottomNav />
      </div>
    </StaffExcelExportProvider>
  );
}


