import {
  type ComponentType,
  type CSSProperties,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  Banknote,
  BadgeDollarSign,
  BarChart3,
  BookOpen,
  Building2,
  CalendarClock,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ClipboardCheck,
  ClipboardList,
  Download,
  FileInput,
  Landmark,
  LogOut,
  QrCode,
  Settings,
  ScrollText,
  User,
  Users,
} from "lucide-react";

import { ReloadButton } from "@/components/layout/ReloadButton";
import { getPendingApprovalCount } from "@/lib/approval-requests";
import { useAuth } from "@/lib/auth";
import { useAppSettings } from "@/lib/app-settings";
import { cn } from "@/lib/utils";
import { useStaffExcelExport } from "@/components/staff/staff-excel-export-context";

type NavigationItem = {
  to?: string;
  hash?: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  action?: "staff-export";
};

type NavigationSection = {
  label: string;
  items: readonly NavigationItem[];
  hideHeader?: boolean;
};

const staffNavigation: readonly NavigationSection[] = [
  {
    label: "Lao động",
    items: [
      { to: "/staff/workers", label: "Danh sách lao động", icon: Users },
      { to: "/staff/workforce", label: "Dashboard", icon: BarChart3 },
      { to: "/staff/recruited", label: "Người tôi tuyển", icon: ClipboardList },
    ],
  },
  {
    label: "Gửi phê duyệt",
    items: [
      { to: "/staff/advances", label: "Ứng lương", icon: Banknote },
      { to: "/staff/salary-holds", label: "Giữ lương", icon: Landmark },
      { to: "/staff/approvals", label: "Phê duyệt", icon: ClipboardCheck },
    ],
  },
  {
    label: "Tiện ích mở rộng",
    items: [
      { to: "/user-guide", label: "Hướng dẫn sử dụng", icon: BookOpen },
      { to: "/notebook", label: "Sổ tay", icon: ClipboardList },
      { to: "/staff/tools/qr", label: "Tạo mã QR", icon: QrCode },
      { to: "/staff/money-to-text", label: "Đọc số tiền", icon: BadgeDollarSign },
      { to: "/last-working-day", label: "Ngày Công Cuối", icon: CalendarClock },
    ],
  },
  {
    label: "Khác",
    items: [{ to: "/staff/export", label: "Xuất dữ liệu", icon: Download, action: "staff-export" }],
  },
];

const adminNavigation: readonly NavigationSection[] = [
  {
    label: "Dashboard",
    items: [
      { to: "/", hash: "nhan-luc", label: "Nhân lực", icon: BarChart3 },
      { to: "/", hash: "tai-chinh", label: "Tài chính", icon: Banknote },
      { to: "/", hash: "khac", label: "Khác", icon: Settings },
    ],
  },
  {
    label: "Quản trị",
    items: [
      { to: "/admin/workforce", label: "Danh sách lao động", icon: Users },
      { to: "/advances", label: "Ứng lương", icon: Banknote },
      { to: "/staff/approvals", label: "Phê duyệt", icon: ClipboardCheck },
      { to: "/staff/salary-holds", label: "Giữ lương", icon: Landmark },
      { to: "/admin/imports", label: "Nhập dữ liệu", icon: FileInput },
      { to: "/admin/logs", label: "Nhật ký thao tác", icon: ScrollText },
    ],
  },
  {
    label: "Tiện ích mở rộng",
    items: [
      { to: "/user-guide", label: "Hướng dẫn sử dụng", icon: BookOpen },
      { to: "/notebook", label: "Sổ tay", icon: ClipboardList },
      { to: "/staff/tools/qr", label: "Tạo mã QR", icon: QrCode },
      { to: "/staff/money-to-text", label: "Đọc số tiền", icon: BadgeDollarSign },
      { to: "/last-working-day", label: "Ngày Công Cuối", icon: CalendarClock },
    ],
  },
];

function navigationForRole(role?: string): readonly NavigationSection[] {
  if (role === "staff") return staffNavigation;
  if (role === "admin") return adminNavigation;
  return [];
}

function roleLabel(role?: string) {
  if (role === "staff") return "Nhân sự";
  if (role === "admin") return "Quản trị viên";
  return "Quản trị";
}

function isNavigationItemActive(pathname: string, hash: string, item: NavigationItem) {
  if (!item.to) return false;
  if (item.hash) {
    const normalizedHash = hash.startsWith("#") ? hash.slice(1) : hash;
    return (
      pathname === item.to &&
      (normalizedHash === item.hash || (!normalizedHash && item.hash === "nhan-luc"))
    );
  }
  return item.to === "/"
    ? pathname === "/" && !hash
    : pathname === item.to || pathname.startsWith(`${item.to}/`);
}

function sectionContainsActive(pathname: string, hash: string, section: NavigationSection) {
  return section.items.some((item) => isNavigationItemActive(pathname, hash, item));
}

let desktopSidebarCollapsed = false;

export function DesktopAppShell({ children }: { children: ReactNode }) {
  const { pathname, hash } = useLocation();
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const { data: settings, logoUrl } = useAppSettings();
  const [collapsed, setCollapsed] = useState(() => desktopSidebarCollapsed);
  const [logoFailed, setLogoFailed] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
  const { openStaffExcelExport } = useStaffExcelExport();
  const immersive = pathname === "/force-change-password";
  const sections = navigationForRole(user?.role);
  const userName = user?.full_name || user?.username || user?.phone || "Tài khoản";
  const shellStyle = {
    "--desktop-sidebar-width": collapsed ? "5.5rem" : "17.5rem",
  } as CSSProperties;

  useEffect(() => {
    setLogoFailed(false);
  }, [logoUrl]);

  useEffect(() => {
    if (!user?.id) {
      setPendingApprovalCount(0);
      return;
    }
    let alive = true;
    getPendingApprovalCount(user.id)
      .then((count) => {
        if (alive) setPendingApprovalCount(count);
      })
      .catch(() => {
        if (alive) setPendingApprovalCount(0);
      });
    return () => {
      alive = false;
    };
  }, [user?.id]);

  useEffect(() => {
    if (immersive || typeof window === "undefined") return;

    const compactDesktop = window.matchMedia("(max-width: 960px)");
    const syncWorkspaceLeft = () => {
      document.documentElement.style.setProperty(
        "--desktop-workspace-left",
        compactDesktop.matches || collapsed ? "5.5rem" : "17.5rem",
      );
    };

    syncWorkspaceLeft();
    compactDesktop.addEventListener("change", syncWorkspaceLeft);

    return () => {
      compactDesktop.removeEventListener("change", syncWorkspaceLeft);
      document.documentElement.style.removeProperty("--desktop-workspace-left");
    };
  }, [collapsed, immersive]);

  const activeSection = useMemo(
    () => sections.find((section) => sectionContainsActive(pathname, hash, section))?.label,
    [hash, pathname, sections],
  );

  useEffect(() => {
    if (!activeSection) return;
    setOpenSections((current) => ({ ...current, [activeSection]: true }));
  }, [activeSection]);

  const signOut = () => {
    logout();
    navigate({ to: "/login" });
  };

  const toggleSection = (label: string) => {
    setOpenSections((current) => ({
      ...current,
      [label]: !(current[label] ?? true),
    }));
  };

  const accountActive = pathname === "/account" || pathname.startsWith("/account/");
  const settingsActive = pathname === "/admin/settings" || pathname.startsWith("/admin/settings/");
  const approvalBadge =
    pendingApprovalCount > 0
      ? pendingApprovalCount > 9
        ? "9+"
        : String(pendingApprovalCount)
      : undefined;

  return (
    <div
      className={cn("desktop-shell", immersive && "desktop-shell--immersive")}
      data-desktop-role={user?.role ?? "unknown"}
      style={shellStyle}
    >
      {!immersive && (
        <>
          <aside className="desktop-sidebar fixed inset-y-0 left-0 z-50 hidden w-[var(--desktop-sidebar-width)] border-r border-border/70 bg-card/95 shadow-soft backdrop-blur desktop:flex desktop:flex-col">
            <div className="flex h-20 shrink-0 items-center gap-3 border-b border-border/60 px-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-primary text-primary-foreground">
                {logoUrl && !logoFailed ? (
                  <img
                    src={logoUrl}
                    alt={`Logo ${settings.company_name}`}
                    className="logo-fit bg-white p-1"
                    onError={() => setLogoFailed(true)}
                  />
                ) : (
                  <Building2 className="h-5 w-5" aria-hidden="true" />
                )}
              </div>
              {!collapsed && (
                <div className="desktop-sidebar-label min-w-0">
                  <p className="truncate text-sm font-bold">{settings.company_name}</p>
                </div>
              )}
            </div>

            <nav
              className="scrollbar-none min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-4"
              aria-label="Điều hướng chính"
            >
              {sections.map((section) => {
                const isOpen = openSections[section.label] ?? true;
                const contentId = `desktop-section-${section.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

                return (
                  <section key={section.label}>
                    {!section.hideHeader && (
                      <button
                        type="button"
                        onClick={() => toggleSection(section.label)}
                        aria-expanded={isOpen}
                        aria-controls={contentId}
                        className={cn(
                          "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground transition hover:bg-muted hover:text-foreground",
                          collapsed && "justify-center px-0",
                        )}
                        title={collapsed ? section.label : undefined}
                      >
                        {!collapsed && (
                          <span className="desktop-sidebar-label truncate">{section.label}</span>
                        )}
                        {isOpen ? (
                          <ChevronUp className="h-4 w-4 shrink-0" />
                        ) : (
                          <ChevronDown className="h-4 w-4 shrink-0" />
                        )}
                      </button>
                    )}

                    {(section.hideHeader || isOpen) && (
                      <ul id={contentId} className={cn("space-y-1", !section.hideHeader && "mt-1")}>
                        {section.items.map((item) => {
                          const Icon = item.icon;
                          const isActive = isNavigationItemActive(pathname, hash, item);
                          const itemBadge =
                            item.to === "/staff/approvals" ? approvalBadge : undefined;
                          const itemClassName = cn(
                            "desktop-sidebar-link flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors",
                            collapsed && "justify-center px-0",
                            isActive
                              ? "bg-primary text-primary-foreground shadow-soft"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground",
                          );

                          return (
                            <li key={`${item.label}-${item.to || item.action || "item"}`}>
                              {item.action === "staff-export" ? (
                                <button
                                  type="button"
                                  onClick={() => openStaffExcelExport()}
                                  title={collapsed ? item.label : undefined}
                                  aria-label={item.label}
                                  className={itemClassName + " w-full"}
                                >
                                  <Icon className="h-5 w-5 shrink-0" />
                                  {!collapsed && (
                                    <span className="desktop-sidebar-label truncate">
                                      {item.label}
                                    </span>
                                  )}
                                </button>
                              ) : (
                                <Link
                                  to={item.to as never}
                                  hash={item.hash as never}
                                  title={collapsed ? item.label : undefined}
                                  aria-label={item.label}
                                  className={cn(itemClassName, "relative")}
                                >
                                  <Icon className="h-5 w-5 shrink-0" />
                                  {!collapsed && (
                                    <span className="desktop-sidebar-label truncate">
                                      {item.label}
                                    </span>
                                  )}
                                  {!collapsed && itemBadge && (
                                    <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 py-0.5 text-[11px] font-semibold leading-4 text-white">
                                      {itemBadge}
                                    </span>
                                  )}
                                  {collapsed && itemBadge && (
                                    <span className="absolute right-2 top-1.5 h-2 w-2 rounded-full bg-red-600" />
                                  )}
                                </Link>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </section>
                );
              })}
            </nav>

            <div className="shrink-0 border-t border-border/60 p-3">
              <div className="relative flex items-center gap-2">
                <Link
                  to="/account"
                  search={{ incomplete: undefined }}
                  title={collapsed ? "Tài khoản" : undefined}
                  aria-label="Tài khoản"
                  className={cn(
                    "desktop-sidebar-link flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors",
                    collapsed && "justify-center px-0",
                    accountActive
                      ? "bg-primary text-primary-foreground shadow-soft"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <User className="h-5 w-5 shrink-0" />
                  {!collapsed && <span className="desktop-sidebar-label truncate">Tài khoản</span>}
                </Link>
                {user?.role === "admin" && (
                  <Link
                    to="/admin/settings"
                    title="Cài đặt quản trị"
                    aria-label="Cài đặt quản trị"
                    className={cn(
                      "desktop-sidebar-link flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                      collapsed && "absolute right-0 top-0 z-10 h-5 w-5 rounded-full bg-card",
                      settingsActive &&
                        "border-primary bg-primary text-primary-foreground shadow-soft",
                    )}
                  >
                    <Settings className={cn("h-5 w-5", collapsed && "h-3 w-3")} />
                  </Link>
                )}
              </div>
              <div
                className={cn(
                  "desktop-sidebar-user mt-2 flex items-center gap-3 rounded-xl bg-muted/55 p-2",
                  collapsed && "justify-center",
                )}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary">
                  {userName.slice(0, 1).toLocaleUpperCase("vi-VN")}
                </div>
                {!collapsed && (
                  <div className="desktop-sidebar-label min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold">{userName}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {roleLabel(user?.role)}
                    </p>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={signOut}
                title={collapsed ? "Đăng xuất" : undefined}
                className={cn(
                  "desktop-sidebar-link mt-2 flex min-h-10 w-full items-center gap-3 rounded-xl px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive",
                  collapsed && "justify-center px-0",
                )}
              >
                <LogOut className="h-4 w-4" />
                {!collapsed && <span className="desktop-sidebar-label">Đăng xuất</span>}
              </button>
            </div>
          </aside>

          <button
            type="button"
            onClick={() =>
              setCollapsed((value) => {
                desktopSidebarCollapsed = !value;
                return desktopSidebarCollapsed;
              })
            }
            aria-label={collapsed ? "Mở rộng thanh điều hướng" : "Thu gọn thanh điều hướng"}
            aria-expanded={!collapsed}
            className="fixed left-[var(--desktop-sidebar-width)] top-1/2 z-50 hidden h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-soft transition-all hover:bg-muted hover:text-foreground desktop:flex"
          >
            {collapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
          </button>

          <header className="fixed left-[var(--desktop-sidebar-width)] right-0 top-0 z-40 hidden h-20 items-center justify-between border-b border-border/70 bg-background/92 px-6 backdrop-blur desktop:flex">
            <div>
              <p className="text-sm font-bold">Không gian làm việc</p>
              <p className="text-xs text-muted-foreground">{roleLabel(user?.role)}</p>
            </div>
            <div className="flex items-center gap-3">
              <ReloadButton showLabel />
              <div className="text-right">
                <p className="max-w-56 truncate text-sm font-semibold">{userName}</p>
                <p className="text-xs text-muted-foreground">{roleLabel(user?.role)}</p>
              </div>
              <button
                type="button"
                onClick={signOut}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-medium text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
              >
                <LogOut className="h-4 w-4" />
                Đăng xuất
              </button>
            </div>
          </header>
        </>
      )}

      <div
        data-desktop-content-pane
        className={cn(
          "min-w-0",
          !immersive &&
            "desktop:min-h-[calc(100dvh-5rem)] desktop:overflow-x-hidden desktop:pl-[var(--desktop-sidebar-width)] desktop:pt-20",
        )}
      >
        {children}
      </div>
    </div>
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
  right?: React.ReactNode;
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
      className="sticky top-0 z-30 flex items-center gap-2 border-b border-border/60 bg-card/90 px-3 backdrop-blur-xl desktop:top-20 desktop:mx-6 desktop:mt-5 desktop:rounded-2xl desktop:border desktop:px-5 desktop:shadow-soft"
      style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.5rem)", paddingBottom: "0.5rem" }}
    >
      {showBack && (
        <button
          onClick={goBack}
          className="-ml-1 flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition active:scale-95 active:bg-muted"
          aria-label="Quay lại"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-semibold leading-tight tracking-tight">{title}</h1>
        {subtitle && (
          <div className="truncate text-[11px] leading-tight text-muted-foreground">{subtitle}</div>
        )}
      </div>
      {right}
    </header>
  );
}
