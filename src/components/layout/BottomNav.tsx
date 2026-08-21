import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useState, type ComponentType, type ReactNode } from "react";
import {
  Building2,
  ChevronLeft,
  Download,
  Home,
  Settings,
  Upload,
  User,
  Users,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { InstallFloatingBanner } from "./InstallFloatingBanner";
import { useStaffExcelExport } from "@/components/staff/staff-excel-export-context";

export type RoleNavigationItem = {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  exact?: boolean;
  action?: "staff-export";
};

function isItemActive(item: RoleNavigationItem, pathname: string) {
  if (item.to === "/") return pathname === "/";
  if (item.exact) return pathname === item.to;
  return pathname === item.to || pathname.startsWith(item.to + "/");
}

export function BottomNav() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const { openStaffExcelExport } = useStaffExcelExport();

  const items: readonly RoleNavigationItem[] =
    user?.role === "super_admin"
      ? [
          { to: "/super-admin", label: "Công ty", icon: Building2, exact: true },
          { to: "/account", label: "Tài khoản", icon: User },
        ]
      : user?.role === "staff"
        ? [
            { to: "/staff", label: "Trang chủ", icon: Home, exact: true },
            { to: "/staff/workers", label: "Lao động", icon: Users },
            { to: "/staff/export", label: "Xuất file", icon: Download, action: "staff-export" },
            { to: "/account", label: "Tài khoản", icon: User },
          ]
        : user?.role === "admin"
          ? [
              { to: "/", label: "Trang chủ", icon: Home, exact: true },
              { to: "/admin/settings", label: "Cài đặt", icon: Settings },
              { to: "/admin/imports", label: "Nhập liệu", icon: Upload },
              { to: "/account", label: "Tài khoản", icon: User },
            ]
          : [];

  return (
    <>
      <InstallFloatingBanner />
      <nav
        aria-label="Điều hướng chính"
        className="mobile-bottom-nav fixed bottom-0 left-1/2 z-40 w-full max-w-[30rem] -translate-x-1/2 border-t border-border/70 bg-card/95 backdrop-blur-xl desktop:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul
          className={cn(
            "grid gap-1 px-2 pb-1.5 pt-1.5",
            items.length === 4 ? "grid-cols-4" : "grid-cols-3",
          )}
        >
          {items.map((item) => {
            const active = isItemActive(item, pathname);
            const Icon = item.icon;
            const className = cn(
              "relative mx-auto flex min-h-[62px] w-full min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-1 py-1.5 text-xs font-medium transition-colors",
              active ? "bg-primary/12 text-primary" : "text-muted-foreground active:bg-muted",
            );

            return (
              <li key={item.to} className="min-w-0">
                {item.action === "staff-export" ? (
                  <button type="button" onClick={openStaffExcelExport} className={className}>
                    <Icon className="h-[22px] w-[22px]" />
                    <span className="line-clamp-2 text-center text-[11px] leading-[1.1]">
                      {item.label}
                    </span>
                  </button>
                ) : (
                  <Link
                    to={item.to as never}
                    aria-current={active ? "page" : undefined}
                    className={className}
                  >
                    <Icon
                      className={cn(
                        "h-[22px] w-[22px] transition-transform",
                        active && "scale-105",
                      )}
                    />
                    <span className="line-clamp-2 text-center text-[11px] leading-[1.1]">
                      {item.label}
                    </span>
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}

export function AppHeader({
  title,
  subtitle,
  right,
  back,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  back?: boolean;
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const showBack = back ?? pathname !== "/";

  const goBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
      return;
    }
    navigate({ to: "/" });
  };

  return (
    <header
      className="mobile-app-header sticky top-0 z-30 flex min-h-14 shrink-0 items-center gap-2 border-b border-border/60 bg-card/92 px-3 backdrop-blur-xl desktop:static desktop:z-auto desktop:mx-6 desktop:mt-3 desktop:rounded-2xl desktop:border desktop:px-5 desktop:shadow-soft"
      style={{ paddingTop: "max(env(safe-area-inset-top), 0.25rem)", paddingBottom: "0.25rem" }}
    >
      {showBack && (
        <button
          type="button"
          onClick={goBack}
          className="-ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition active:scale-95 active:bg-muted"
          aria-label="Quay lại"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      )}
      <div className="min-w-0 flex-1 py-1">
        <h1 className="truncate text-lg font-semibold leading-6 tracking-tight">{title}</h1>
        {subtitle && (
          <div className="truncate text-xs leading-5 text-muted-foreground">{subtitle}</div>
        )}
      </div>
      {right && <div className="flex shrink-0 items-center gap-1">{right}</div>}
    </header>
  );
}
