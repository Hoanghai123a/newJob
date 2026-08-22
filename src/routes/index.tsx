import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { pb, type UserRecord } from "@/lib/pocketbase";
import { useAuth } from "@/lib/auth";
import { useAppSettings } from "@/lib/app-settings";
import { getSeen } from "@/lib/seen";
import { MobileSection } from "@/components/layout/MobileSection";
import { BottomNav } from "@/components/layout/BottomNav";
import { FeatureTile } from "@/components/dashboard/FeatureTile";
import { LoginRequiredDialog } from "@/components/auth/LoginRequiredDialog";
import { DesktopAppShell } from "@/components/layout/DesktopAppShell";
import { WorkforceDashboard } from "@/components/workforce/WorkforceDashboard";
import { FinanceDashboard } from "@/components/dashboard/FinanceDashboard";
import { OtherDashboard } from "@/components/dashboard/OtherDashboard";
import { ApprovalDashboard } from "@/components/dashboard/ApprovalDashboard";
import { WorkProgressBoard } from "@/components/dashboard/WorkProgressBoard";
import { HourStatsDashboard } from "@/components/dashboard/HourStatsDashboard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  createEmptyApprovalDashboardStats,
  isApprovalDashboardStatus,
  type ApprovalDashboardStats,
} from "@/lib/approval-dashboard";
import { fetchFactories, type FactoryRecord } from "@/lib/factories";
import { findActiveEmploymentByUser, type EmploymentHistoryRecord } from "@/lib/employment";
import { fetchFreshStaffWorkspace } from "@/lib/staff-permissions";
import { escapePb } from "@/lib/delegations";
import { joinTenantFilters } from "@/lib/tenant";
import { fetchCccdVersionsByIds, type CccdVersionRecord } from "@/lib/cccd-versions";
import { getRecentDateKeys } from "@/lib/workforce-other-stats";
import {
  Newspaper,
  BarChart3,
  BriefcaseBusiness,
  Clock,
  Settings,
  Building2,
  CalendarCheck,
  CalendarClock,
  Wallet,
  BadgeDollarSign,
  MessagesSquare,
  Bell,
  ShieldCheck,
  History,
  User,
  Users,
  LayoutGrid,
  ListOrdered,
  ChevronRight,
  RefreshCw,
  NotebookPen,
  ClipboardCheck,
  LogIn,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    if (typeof window === "undefined") return;
    if (!pb.authStore.isValid) throw redirect({ to: "/login" });
    const user = pb.authStore.record as UserRecord | null;
    if (user?.role === "staff") throw redirect({ to: "/staff" });
  },
  component: DashboardPage,
});

type UtilKey = "utilities" | null;

const APPROVAL_STATUSES = ["pending", "approved", "completed", "rejected"] as const;

type ApprovalStatusKey = (typeof APPROVAL_STATUSES)[number];

type ApprovalRequestSummary = {
  status?: string;
  amount?: number | string;
};

function DashboardPage() {
  const { loading, user, isAdmin } = useAuth();
  const { data: settings, logoUrl } = useAppSettings();
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
  const [unread, setUnread] = useState({ news: 0, chat: 0, check: 0, advances: 0 });
  const [openUtil, setOpenUtil] = useState<UtilKey>(null);
  const [adminActionsOpen, setAdminActionsOpen] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [workforceHistories, setWorkforceHistories] = useState<EmploymentHistoryRecord[]>([]);
  const [workforceUsers, setWorkforceUsers] = useState<UserRecord[]>([]);
  const [workforceFactories, setWorkforceFactories] = useState<FactoryRecord[]>([]);
  const [workforceCccdVersions, setWorkforceCccdVersions] = useState<CccdVersionRecord[]>([]);
  const [workforceLoading, setWorkforceLoading] = useState(true);
  const [workforceError, setWorkforceError] = useState("");
  const [workforceReloadToken, setWorkforceReloadToken] = useState(0);
  const [approvalStats, setApprovalStats] = useState<ApprovalDashboardStats>(
    createEmptyApprovalDashboardStats,
  );
  const [currentEmployment, setCurrentEmployment] = useState<EmploymentHistoryRecord | null>(null);
  const nav = useNavigate();
  const { hash, search } = useLocation();
  const guestSearch = (search || {}) as { login?: string; redirect?: string };
  const [guestLoginOpen, setGuestLoginOpen] = useState(guestSearch.login === "1");
  const normalizedHash = hash.startsWith("#") ? hash.slice(1) : hash;
  const desktopSection: DesktopDashboardSection =
    normalizedHash === "tai-chinh" ? "tai-chinh" : normalizedHash === "khac" ? "khac" : "nhan-luc";

  useEffect(() => {
    if (!user && guestSearch.login === "1") setGuestLoginOpen(true);
  }, [guestSearch.login, user]);

  const handleReload = async () => {
    if (reloading) return;
    setReloading(true);
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    window.location.reload();
  };

  useEffect(() => {
    if (!user?.id || isAdmin) {
      setCurrentEmployment(null);
      return;
    }
    let alive = true;
    findActiveEmploymentByUser(user.id)
      .then((history) => alive && setCurrentEmployment(history))
      .catch(() => alive && setCurrentEmployment(null));
    return () => {
      alive = false;
    };
  }, [isAdmin, user]);

  useEffect(() => {
    if (loading) return;
    if (!user) return;
    if (user.role === "staff") {
      nav({ to: "/staff" });
      return;
    }
  }, [loading, nav, user]);

  useEffect(() => {
    if (!isAdmin || !user?.id) return;
    let alive = true;

    (async () => {
      try {
        const res = await pb.collection("approval_responses").getList(1, 1, {
          filter: joinTenantFilters(user, `admin = "${user.id}" && status = "pending"`),
        });
        if (alive) setPendingApprovalCount(res.totalItems || 0);
      } catch {
        if (alive) setPendingApprovalCount(0);
      }
    })();

    return () => {
      alive = false;
    };
  }, [isAdmin, user]);

  useEffect(() => {
    if (!user?.id) return;
    let alive = true;

    const since = (scope: string) => {
      const ts = getSeen(scope, user.id);
      return ts ? new Date(ts).toISOString().replace("T", " ") : "";
    };
    const countNewer = async (
      collection: string,
      field: string,
      scope: string,
      extraFilter = "",
    ) => {
      const seen = since(scope);
      const parts = [extraFilter, seen ? `${field} > "${seen}"` : ""].filter(Boolean);
      const res = await pb.collection(collection).getList(1, 1, {
        filter: joinTenantFilters(user, parts.join(" && ")),
      });
      return res.totalItems || 0;
    };

    (async () => {
      const me = `user = "${user.id}"`;
      const chatCount = async () => {
        try {
          const memberships = await pb.collection("chat_room_members").getFullList({
            filter: joinTenantFilters(user, `user = "${user.id}"`),
          });
          const roomIds = (memberships as unknown as Array<{ room: string }>).map((m) => m.room);
          if (!roomIds.length) return 0;
          let total = 0;
          for (const roomId of roomIds) {
            const seen = getSeen(`chat:${roomId}`, user.id);
            const seenIso = seen ? new Date(seen).toISOString().replace("T", " ") : "";
            const filter = [
              `room = "${roomId}"`,
              `user != "${user.id}"`,
              seenIso ? `created > "${seenIso}"` : "",
            ]
              .filter(Boolean)
              .join(" && ");
            const res = await pb.collection("group_chat_messages").getList(1, 1, {
              filter: joinTenantFilters(user, filter),
            });
            total += res.totalItems || 0;
          }
          return total;
        } catch {
          return 0;
        }
      };
      const [news, chat, check, salary, advances] = await Promise.all([
        countNewer("recruitments", "created", "news", "is_active = true").catch(() => 0),
        chatCount(),
        countNewer("check_attendance_items", "created", "check-attendance", me).catch(() => 0),
        countNewer("check_salary_items", "created", "check-attendance", me).catch(() => 0),
        countNewer("advances", "resolved_at", "advances", me).catch(() => 0),
      ]);
      if (alive) setUnread({ news, chat, check: check + salary, advances });
    })();

    return () => {
      alive = false;
    };
  }, [user]);

  useEffect(() => {
    if (!isAdmin || !user?.id || desktopSection !== "khac" || typeof window === "undefined") {
      return;
    }
    let alive = true;
    setWorkforceLoading(true);
    setWorkforceError("");

    Promise.all([
      fetchFreshStaffWorkspace(user as UserRecord),
      pb.collection("users").getFullList<UserRecord>({
        filter: `role="staff" || role="admin"`,
        sort: "full_name,username",
      }),
      fetchFactories(),
    ])
      .then(async ([workspace, staffAdminUsers, factories]) => {
        const histories = workspace.workers.flatMap((worker) => worker.histories);
        const recentDates = new Set(getRecentDateKeys());
        const referencedVersionIds =
          desktopSection === "khac"
            ? histories
                .filter((history) => recentDates.has(history.join_date.slice(0, 10)))
                .map((history) => history.cccd_version || "")
                .filter(Boolean)
            : [];
        const cccdVersions = referencedVersionIds.length
          ? await fetchCccdVersionsByIds(referencedVersionIds).catch(() => [])
          : [];

        if (!alive) return;
        const workerUsers = workspace.workers.map((worker) => worker.user);
        const workerIds = new Set(workerUsers.map((worker) => worker.id));
        setWorkforceHistories(histories);
        setWorkforceUsers([
          ...workerUsers,
          ...staffAdminUsers.filter((staff) => !workerIds.has(staff.id)),
        ]);
        setWorkforceFactories(factories);
        setWorkforceCccdVersions(cccdVersions);
      })
      .catch(() => {
        if (!alive) return;
        setWorkforceHistories([]);
        setWorkforceUsers([]);
        setWorkforceFactories([]);
        setWorkforceCccdVersions([]);
        setWorkforceError("Không tải được dữ liệu nhân lực. Vui lòng thử lại.");
      })
      .finally(() => {
        if (alive) setWorkforceLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [desktopSection, isAdmin, user, workforceReloadToken]);

  useEffect(() => {
    if (!isAdmin || !user?.id || desktopSection !== "khac" || typeof window === "undefined") {
      return;
    }
    let alive = true;
    const userId = escapePb(user.id);
    const rolePart = `(admins ~ "${userId}" || creator = "${userId}")`;

    pb.collection("approval_requests")
      .getFullList<ApprovalRequestSummary>({
        filter: rolePart,
        fields: "status,amount",
      })
      .then((requests) => {
        if (!alive) return;
        const nextStats = createEmptyApprovalDashboardStats();

        for (const request of requests) {
          if (!isApprovalDashboardStatus(request.status)) continue;
          const status = request.status;
          const amount = Math.max(0, Number(request.amount) || 0);
          nextStats[status] += 1;
          nextStats.amountByStatus[status] += amount;
          nextStats.totalAmount += amount;
        }

        setApprovalStats(nextStats);
      })
      .catch(() => {
        if (alive) setApprovalStats(createEmptyApprovalDashboardStats());
      });

    return () => {
      alive = false;
    };
  }, [desktopSection, isAdmin, user?.id]);

  if (loading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center px-4 text-sm text-muted-foreground">
        Đang kiểm tra đăng nhập...
      </div>
    );
  }

  if (!user) {
    return (
      <GuestDashboard
        settings={settings}
        logoUrl={logoUrl}
        loginOpen={guestLoginOpen}
        onLoginOpenChange={setGuestLoginOpen}
        redirectTo={guestSearch.redirect || "/"}
      />
    );
  }

  const hasEmployment = Boolean(currentEmployment);
  const workDisabled = !isAdmin && !hasEmployment;
  const workDisabledReason =
    "Tính năng này chỉ dùng được khi bạn đã được admin gắn mã NV và nhà máy. Vui lòng liên hệ admin để cập nhật hồ sơ.";

  const toBadge = (count: number) => (count > 0 ? (count > 9 ? "9+" : String(count)) : undefined);

  const summaryParts: string[] = [];
  if (unread.news > 0) summaryParts.push(`${unread.news} tin tuyển dụng mới`);
  if (!workDisabled) {
    if (unread.check > 0) summaryParts.push(`${unread.check} bảng công/lương mới`);
    if (unread.advances > 0) summaryParts.push(`${unread.advances} phản hồi ứng lương`);
  }
  if (unread.chat > 0) summaryParts.push(`${unread.chat} tin nhắn chưa đọc`);
  const summaryText = summaryParts.join(" · ");

  return (
    <div className="pb-nav">
      {isAdmin && (
        <DesktopAppShell>
          <DesktopAdminDashboard
            section={desktopSection}
            histories={workforceHistories}
            users={workforceUsers}
            factories={workforceFactories}
            cccdVersions={workforceCccdVersions}
            loading={workforceLoading}
            error={workforceError}
            approvalStats={approvalStats}
            onRetry={() => setWorkforceReloadToken((value) => value + 1)}
          />
        </DesktopAppShell>
      )}
      <div className="px-4 pb-2 pt-3 desktop:hidden">
        <div className="gradient-hero relative overflow-hidden rounded-3xl px-4 py-4 text-white shadow-soft">
          <div className="absolute -right-12 -top-12 h-36 w-36 rounded-full bg-white/20 blur-2xl" />
          <div className="absolute -bottom-16 -left-8 h-40 w-40 rounded-full bg-white/10 blur-2xl" />

          <div className="relative flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white/95 shadow-soft">
              {logoUrl ? (
                <img src={logoUrl} alt="logo" className="logo-fit" />
              ) : (
                <Building2 className="h-6 w-6 text-primary" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-semibold leading-6">
                {settings.company_name}
              </div>
              {settings.slogan && (
                <div className="truncate text-xs leading-5 text-white/80">{settings.slogan}</div>
              )}
            </div>
            <button
              type="button"
              onClick={handleReload}
              disabled={reloading}
              aria-label="Tải lại trang"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur transition active:scale-95 disabled:opacity-70"
            >
              <RefreshCw className={reloading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            </button>
          </div>

          <div className="relative mt-3 flex flex-wrap items-center gap-2">
            <span className="text-sm text-white/80">Xin chào,</span>
            <span className="text-base font-semibold leading-6">
              {user?.full_name || user?.username || "Bạn"}
            </span>
            <span className="rounded-full bg-white/20 px-2.5 py-1 text-xs font-semibold backdrop-blur">
              {isAdmin ? "Quản trị viên" : "Nhân viên"}
            </span>
            {!isAdmin && hasEmployment && (
              <span className="max-w-full truncate rounded-full bg-white/15 px-2.5 py-1 text-xs backdrop-blur">
                {currentEmployment?.expand?.factory?.name || "Chưa có nhà máy"}
              </span>
            )}
          </div>

          {summaryText && (
            <div className="relative mt-3 flex items-start gap-2 rounded-2xl bg-white/15 px-3 py-2.5 text-sm leading-5 backdrop-blur">
              <Bell className="mt-0.5 h-4 w-4 shrink-0" />
              <div>{summaryText}</div>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-5 px-4 pt-2 desktop:hidden">
        {isAdmin ? (
          <>
            <MobileSection
              title="Nhóm chính"
              description="Các nghiệp vụ nhân sự và tài chính cần xử lý thường xuyên"
            >
              <div className="grid grid-cols-2 gap-3">
                <FeatureTile
                  to="/admin/workforce"
                  label="Nhân sự đi làm"
                  icon={Users}
                  variant="accent"
                  size="compact"
                  align="start"
                />
                <FeatureTile
                  to="/advances"
                  label="Ứng lương"
                  icon={Wallet}
                  variant="accent"
                  size="compact"
                  align="start"
                />
                <FeatureTile
                  to="/staff/approvals"
                  label="Phê duyệt"
                  icon={ClipboardCheck}
                  badge={toBadge(pendingApprovalCount)}
                  size="compact"
                  align="start"
                />
                <FeatureTile
                  to="/staff/salary-holds"
                  label="Giữ lương"
                  icon={ShieldCheck}
                  size="compact"
                  align="start"
                />
              </div>
            </MobileSection>

            <MobileSection title="Quản trị" description="Kiểm tra dữ liệu và cấu hình hệ thống">
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setAdminActionsOpen(true)}
                  className="group relative flex min-h-[94px] flex-col items-start gap-2 rounded-2xl border border-border/70 bg-card p-3 text-left shadow-soft transition-colors hover:border-primary/40 active:scale-[0.98]"
                >
                  <div className="gradient-primary flex h-10 w-10 items-center justify-center rounded-xl text-primary-foreground">
                    <BarChart3 className="h-[18px] w-[18px]" />
                  </div>
                  <span className="w-full text-xs font-semibold">Dashboard</span>
                </button>
                <FeatureTile
                  to="/check-attendance"
                  label="Check công/lương"
                  icon={CalendarCheck}
                  variant="accent"
                  size="compact"
                  align="start"
                />
                <FeatureTile
                  to="/staff/hour-stats"
                  label="Thống kê giờ"
                  icon={Clock}
                  variant="accent"
                  size="compact"
                  align="start"
                />
                <FeatureTile
                  to="/admin/settings"
                  label="Cài đặt"
                  icon={Settings}
                  size="compact"
                  align="start"
                />
              </div>
            </MobileSection>

            <MobileSection title="Khác" description="Tiện ích, giải trí và thông tin tài khoản">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setOpenUtil("utilities")}
                  className="group relative flex min-h-[94px] flex-col items-start gap-2 rounded-2xl border border-border/70 bg-card p-3 text-left shadow-soft transition-colors active:scale-[0.98]"
                >
                  <div className="gradient-primary flex h-10 w-10 items-center justify-center rounded-xl text-primary-foreground">
                    <LayoutGrid className="h-[18px] w-[18px]" />
                  </div>
                  <span className="w-full text-xs font-semibold">Tiện ích</span>
                </button>
                <FeatureTile
                  to="/account"
                  label="Tài khoản"
                  icon={User}
                  size="compact"
                  align="start"
                />
              </div>
            </MobileSection>
          </>
        ) : (
          <>
            <section aria-label="Tiện ích và giải trí">
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setOpenUtil("utilities")}
                  className="group relative overflow-hidden rounded-3xl border border-border/70 bg-card p-4 text-left shadow-soft transition active:scale-[0.98]"
                >
                  <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-primary/10 blur-2xl" />
                  <div className="relative flex items-start justify-between gap-2">
                    <div className="gradient-primary flex h-11 w-11 items-center justify-center rounded-2xl text-primary-foreground shadow-sm">
                      <LayoutGrid className="h-5 w-5" />
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="relative mt-3 text-sm font-semibold">Tiện ích</div>
                  <div className="relative mt-1 text-xs leading-5 text-muted-foreground">
                    Bảng tin, sổ tay và công cụ
                  </div>
                  {(unread.news > 0 || unread.chat > 0) && (
                    <span className="absolute right-3 top-3 inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 py-0.5 text-[11px] font-semibold text-white shadow-sm">
                      {toBadge(unread.news + unread.chat)}
                    </span>
                  )}
                </button>
              </div>
            </section>

            <MobileSection
              title="Khi đã đi làm"
              description={
                workDisabled
                  ? "Cần admin gắn mã nhân viên và nhà máy để mở khóa"
                  : "Các chức năng dành cho người lao động đang đi làm"
              }
            >
              <div className="grid grid-cols-2 gap-3">
                <FeatureTile
                  to="/advances"
                  label="Ứng lương"
                  description="Gửi và theo dõi yêu cầu"
                  icon={Wallet}
                  variant="accent"
                  disabled={workDisabled}
                  disabledReason={workDisabledReason}
                  badge={workDisabled ? undefined : toBadge(unread.advances)}
                />
                <FeatureTile
                  to="/check-attendance"
                  label="Check công/lương"
                  description="Kiểm tra bảng công"
                  icon={CalendarCheck}
                  variant="accent"
                  disabled={workDisabled}
                  disabledReason={workDisabledReason}
                  badge={workDisabled ? undefined : toBadge(unread.check)}
                />
                <FeatureTile
                  to="/work-history"
                  label="Lịch sử đi làm"
                  description="Nhà máy, ngày vào/nghỉ"
                  icon={History}
                  variant="accent"
                  disabled={workDisabled}
                  disabledReason={workDisabledReason}
                />
              </div>
            </MobileSection>

            {workDisabled && (
              <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-5 text-amber-900">
                <BriefcaseBusiness className="mt-0.5 h-5 w-5 shrink-0" />
                <div>
                  <div className="font-semibold">Hoàn thiện hồ sơ để mở chức năng</div>
                  <div className="mt-1">
                    Admin cần gắn mã nhân viên và nhà máy trước khi bạn dùng các nghiệp vụ đi làm
                    như ứng lương hoặc kiểm tra công/lương.
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <BottomNav />

      <Dialog open={adminActionsOpen} onOpenChange={setAdminActionsOpen}>
        <DialogContent
          className="h-[calc(100dvh-0.5rem)] max-h-[calc(100dvh-0.5rem)] w-[calc(100%-0.5rem)] max-w-none rounded-3xl desktop:hidden"
          bodyClassName="space-y-3 px-3 py-3"
        >
          <DialogHeader className="px-4 py-3 pr-14">
            <DialogTitle className="flex items-center gap-2">
              <div className="gradient-primary flex h-8 w-8 items-center justify-center rounded-xl text-primary-foreground">
                <BarChart3 className="h-4 w-4" />
              </div>
              Dashboard quản trị
            </DialogTitle>
            <DialogDescription>
              Tổng hợp nhanh số liệu quản trị trên thiết bị di động.
            </DialogDescription>
          </DialogHeader>

          <div className="sticky -top-3 z-30 flex items-center gap-1 rounded-2xl border border-border/70 bg-background/95 p-1 shadow-soft backdrop-blur">
            {(
              [
                ["nhan-luc", "Nhân lực", Users],
                ["tai-chinh", "Tài chính", Wallet],
                ["khac", "Khác", LayoutGrid],
              ] as const
            ).map(([key, label, Icon]) => (
              <Link
                key={key}
                to="/"
                hash={key}
                aria-current={desktopSection === key ? "page" : undefined}
                className={`flex min-h-10 min-w-0 flex-1 items-center justify-center gap-1 rounded-xl px-1.5 text-[11px] font-semibold transition ${
                  desktopSection === key
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground active:bg-muted"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            ))}
          </div>

          <DesktopAdminDashboard
            mobile
            section={desktopSection}
            histories={workforceHistories}
            users={workforceUsers}
            factories={workforceFactories}
            cccdVersions={workforceCccdVersions}
            loading={workforceLoading}
            error={workforceError}
            approvalStats={approvalStats}
            onRetry={() => setWorkforceReloadToken((value) => value + 1)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={openUtil !== null} onOpenChange={(open) => !open && setOpenUtil(null)}>
        <DialogContent className="rounded-3xl desktop:hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="gradient-primary flex h-8 w-8 items-center justify-center rounded-xl text-primary-foreground shadow-sm">
                <LayoutGrid className="h-4 w-4" />
              </div>
              Tiện ích
            </DialogTitle>
            <DialogDescription>Chọn tiện ích cần sử dụng</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-2" onClick={() => setOpenUtil(null)}>
            {isAdmin ? (
              <>
                <FeatureTile
                  to="/news"
                  label="Bảng tin"
                  icon={Newspaper}
                  size="compact"
                  badge={toBadge(unread.news)}
                />
                <FeatureTile to="/notebook" label="Sổ tay" icon={NotebookPen} size="compact" />
                <FeatureTile
                  to="/admin/accounts/stats"
                  label="Thống kê"
                  icon={Users}
                  size="compact"
                />
                <FeatureTile
                  to="/chat"
                  label="Trò chuyện"
                  icon={MessagesSquare}
                  size="compact"
                  badge={toBadge(unread.chat)}
                />
                <FeatureTile
                  to="/staff/money-to-text"
                  label="Đọc số tiền"
                  icon={BadgeDollarSign}
                  size="compact"
                />
                <FeatureTile
                  to="/last-working-day"
                  label="Ngày Công Cuối"
                  icon={CalendarClock}
                  size="compact"
                />
              </>
            ) : (
              <>
                <FeatureTile
                  to="/news"
                  label="Bảng tin"
                  icon={Newspaper}
                  size="compact"
                  badge={toBadge(unread.news)}
                />
                <FeatureTile
                  to="/chat"
                  label="Trò chuyện"
                  icon={MessagesSquare}
                  size="compact"
                  badge={toBadge(unread.chat)}
                />
                <FeatureTile to="/notebook" label="Sổ tay" icon={NotebookPen} size="compact" />
                <FeatureTile
                  to="/counter"
                  label="Bộ đếm"
                  icon={ListOrdered}
                  size="compact"
                  allowGuest
                />
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GuestDashboard({
  settings,
  logoUrl,
  loginOpen,
  onLoginOpenChange,
  redirectTo,
}: {
  settings: { company_name: string; slogan?: string };
  logoUrl: string;
  loginOpen: boolean;
  onLoginOpenChange: (open: boolean) => void;
  redirectTo: string;
}) {
  return (
    <div className="pb-nav desktop:mx-auto desktop:max-w-6xl">
      <section className="gradient-hero relative overflow-hidden px-5 py-8 text-white desktop:mx-6 desktop:mt-6 desktop:rounded-3xl desktop:px-10 desktop:py-12">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/20 blur-3xl" />
        <div className="absolute -bottom-16 -left-8 h-48 w-48 rounded-full bg-white/10 blur-3xl" />
        <div className="relative mx-auto flex max-w-3xl flex-col items-center text-center">
          <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-3xl bg-white/95 shadow-soft">
            {logoUrl ? (
              <img src={logoUrl} alt={`Logo ${settings.company_name}`} className="logo-fit" />
            ) : (
              <Building2 className="h-8 w-8 text-primary" />
            )}
          </div>
          <p className="mt-4 text-sm font-medium text-white/80">Chào mừng bạn đến</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight desktop:text-3xl">
            {settings.company_name}
          </h1>
          {settings.slogan && <p className="mt-2 text-sm text-white/80">{settings.slogan}</p>}
          <p className="mt-5 max-w-xl text-sm leading-6 text-white/90">
            Khám phá các tiện ích dành cho người lao động. Đăng nhập để xem và sử dụng thông tin của
            bạn.
          </p>
          <Button
            type="button"
            variant="secondary"
            className="mt-5 bg-white text-primary hover:bg-white/90"
            onClick={() => onLoginOpenChange(true)}
          >
            <LogIn aria-hidden="true" />
            Đăng nhập
          </Button>
        </div>
      </section>

      <main className="space-y-6 px-4 py-5 desktop:px-6 desktop:py-8">
        <GuestSection
          title="Dành cho người lao động"
          description="Theo dõi công việc và các quyền lợi của bạn"
        >
          <FeatureTile
            to="/check-attendance"
            label="Check công/lương"
            description="Kiểm tra bảng công"
            icon={CalendarCheck}
            variant="accent"
          />
          <FeatureTile
            to="/advances"
            label="Ứng lương"
            description="Gửi và theo dõi yêu cầu"
            icon={Wallet}
            variant="accent"
          />
          <FeatureTile
            to="/work-history"
            label="Lịch sử đi làm"
            description="Nhà máy và ngày làm"
            icon={History}
            variant="accent"
          />
        </GuestSection>

        <GuestSection title="Tiện ích" description="Thông tin, kết nối và công cụ hỗ trợ" compact>
          <FeatureTile to="/news" label="Bảng tin" icon={Newspaper} size="compact" allowGuest />
          <FeatureTile to="/chat" label="Trò chuyện" icon={MessagesSquare} size="compact" />
          <FeatureTile to="/notebook" label="Sổ tay" icon={NotebookPen} size="compact" />
          <FeatureTile to="/counter" label="Bộ đếm" icon={ListOrdered} size="compact" allowGuest />
        </GuestSection>
      </main>

      <BottomNav />
      <LoginRequiredDialog
        open={loginOpen}
        onOpenChange={onLoginOpenChange}
        redirectTo={redirectTo}
      />
    </div>
  );
}

function GuestSection({
  title,
  description,
  compact = false,
  children,
}: {
  title: string;
  description: string;
  compact?: boolean;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-3">
        <h2 className="text-base font-bold tracking-tight">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div
        className={
          compact
            ? "grid grid-cols-3 gap-3 desktop:grid-cols-6"
            : "grid grid-cols-2 gap-3 desktop:grid-cols-5"
        }
      >
        {children}
      </div>
    </section>
  );
}

type DesktopDashboardSection = "nhan-luc" | "tai-chinh" | "khac";

function DesktopAdminDashboard({
  mobile = false,
  section,
  histories,
  users,
  factories,
  cccdVersions,
  loading,
  error,
  approvalStats,
  onRetry,
}: {
  mobile?: boolean;
  section: DesktopDashboardSection;
  histories: EmploymentHistoryRecord[];
  users: UserRecord[];
  factories: FactoryRecord[];
  cccdVersions: CccdVersionRecord[];
  loading: boolean;
  error: string;
  approvalStats: ApprovalDashboardStats;
  onRetry: () => void;
}) {
  const sectionMeta = {
    "nhan-luc": {
      title: "Nhân lực",
      description: "Theo dõi tình hình tuyển dụng, nghỉ việc và khả năng duy trì lao động.",
      icon: Users,
    },
    "tai-chinh": {
      title: "Tài chính",
      description: "Không gian tổng hợp các chức năng tài chính.",
      icon: Wallet,
    },
    khac: {
      title: "Khác",
      description: "Các thông tin và tiện ích quản trị khác.",
      icon: LayoutGrid,
    },
  }[section];
  const SectionIcon = sectionMeta.icon;

  return (
    <main
      data-admin-dashboard-content={section}
      className={
        mobile
          ? "min-w-0 bg-background"
          : "hidden min-h-[calc(100dvh-5rem)] min-w-0 bg-background desktop:block"
      }
    >
      <div
        className={
          mobile ? "w-full space-y-4 pb-2" : "mx-auto w-full max-w-[110rem] space-y-6 px-8 py-7"
        }
      >
        <section id={section} className="space-y-4 scroll-mt-28">
          <div className={mobile ? "flex items-center gap-2" : "flex items-center gap-3"}>
            <div
              className={`flex shrink-0 items-center justify-center bg-primary/10 text-primary ${
                mobile ? "h-9 w-9 rounded-xl" : "h-11 w-11 rounded-2xl"
              }`}
            >
              <SectionIcon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2
                className={
                  mobile ? "text-base font-bold tracking-tight" : "text-lg font-bold tracking-tight"
                }
              >
                {sectionMeta.title}
              </h2>
              <p
                className={
                  mobile
                    ? "line-clamp-2 text-xs text-muted-foreground"
                    : "text-sm text-muted-foreground"
                }
              >
                {sectionMeta.description}
              </p>
            </div>
          </div>

          {section === "nhan-luc" ? (
            <WorkforceDashboard
              viewer={pb.authStore.record as UserRecord | null}
              detailHref="/admin/workforce"
              presentation={mobile ? "mobile-dialog" : "default"}
            />
          ) : section === "tai-chinh" ? (
            <FinanceDashboard presentation={mobile ? "mobile-dialog" : "default"} />
          ) : (
            <Tabs defaultValue="overview" className="min-w-0 space-y-4">
              <TabsList
                aria-label="Nội dung khác"
                className={mobile ? "flex w-full justify-start overflow-x-auto" : undefined}
              >
                <TabsTrigger value="overview">Tổng quan khác</TabsTrigger>
                <TabsTrigger value="progress">Tiến độ công việc</TabsTrigger>
                <TabsTrigger value="hour-stats">Thống kê giờ</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="mt-0 space-y-4">
                <OtherDashboard
                  histories={histories}
                  users={users}
                  factories={factories}
                  cccdVersions={cccdVersions}
                  loading={loading}
                  error={error}
                  onRetry={onRetry}
                  presentation={mobile ? "mobile-dialog" : "default"}
                />
                <ApprovalDashboard
                  stats={approvalStats}
                  presentation={mobile ? "mobile-dialog" : "default"}
                />
              </TabsContent>

              <TabsContent value="progress" className="mt-0">
                <WorkProgressBoard />
              </TabsContent>

              <TabsContent value="hour-stats" className="mt-0">
                <HourStatsDashboard />
              </TabsContent>
            </Tabs>
          )}
        </section>
      </div>
    </main>
  );
}
