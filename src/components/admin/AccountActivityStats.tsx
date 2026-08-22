import { useEffect, useMemo, useState } from "react";
import { Users, ShieldCheck, UserRoundCheck, UserRound } from "lucide-react";
import { toast } from "@/lib/toast";
import { pb, type UserRecord } from "@/lib/pocketbase";
import { StatCard } from "@/components/ui/stat-card";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { companyFilter } from "@/lib/tenant";

function daysAgoIso(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function isInRange(dateStr: string | undefined, from: string, to: string) {
  if (!dateStr) return false;
  const t = new Date(dateStr).getTime();
  if (Number.isNaN(t)) return false;
  const fromT = new Date(`${from}T00:00:00`).getTime();
  const toT = new Date(`${to}T23:59:59.999`).getTime();
  return t >= fromT && t <= toT;
}

type MinimalUser = Pick<UserRecord, "id" | "role" | "last_login">;

export function AccountActivityStats() {
  const [from, setFrom] = useState(daysAgoIso(7));
  const [to, setTo] = useState(todayIso());
  const [users, setUsers] = useState<MinimalUser[]>([]);
  const [workerUserIds, setWorkerUserIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const currentUser = pb.authStore.record as UserRecord | null;
        const [userList, histList] = await Promise.all([
          pb.collection("users").getFullList<MinimalUser>({
            fields: "id,role,last_login",
            filter: companyFilter(currentUser, "tenant_company"),
          }),
          pb.collection("employment_histories").getFullList<{ user: string }>({
            fields: "user",
            filter: companyFilter(currentUser),
          }),
        ]);
        if (!alive) return;
        setUsers(userList);
        setWorkerUserIds(new Set(histList.map((h) => h.user)));
      } catch (e: any) {
        if (alive) toast.error(e?.message || "Không tải được thống kê tài khoản");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const stats = useMemo(() => {
    const admins = users.filter((u) => u.role === "admin");
    const staff = users.filter((u) => u.role === "staff");
    const regularUsers = users.filter((u) => u.role === "user" || !u.role);
    const workers = regularUsers.filter((u) => workerUserIds.has(u.id));
    const guests = regularUsers.filter((u) => !workerUserIds.has(u.id));

    const activeInRange = (list: MinimalUser[]) =>
      list.filter((u) => isInRange(u.last_login, from, to)).length;

    return {
      total: users.length,
      totalActive: activeInRange(users),
      admins: { total: admins.length, active: activeInRange(admins) },
      staff: { total: staff.length, active: activeInRange(staff) },
      workers: { total: workers.length, active: activeInRange(workers) },
      guests: { total: guests.length, active: activeInRange(guests) },
    };
  }, [users, workerUserIds, from, to]);

  if (loading) {
    return (
      <section className="rounded-3xl bg-card p-3 shadow-soft">
        <div className="px-1 pb-2 pt-1">
          <div className="text-sm font-semibold tracking-tight">Thống kê tài khoản</div>
        </div>
        <div className="h-24 animate-pulse rounded-2xl bg-muted/60" />
      </section>
    );
  }

  return (
    <section className="rounded-3xl bg-card p-3 shadow-soft">
      <div className="px-1 pb-2 pt-1">
        <div className="text-sm font-semibold tracking-tight">Thống kê tài khoản</div>
        <div className="text-[11px] text-muted-foreground">Đăng nhập theo khoảng thời gian</div>
      </div>

      <Card className="space-y-2 p-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Từ ngày</Label>
            <DateInput value={from} max={to} onChange={(value) => setFrom(value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Đến ngày</Label>
            <DateInput value={to} min={from} max={todayIso()} onChange={(value) => setTo(value)} />
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <QuickBtn
            label="7 ngày"
            onClick={() => {
              setFrom(daysAgoIso(7));
              setTo(todayIso());
            }}
          />
          <QuickBtn
            label="30 ngày"
            onClick={() => {
              setFrom(daysAgoIso(30));
              setTo(todayIso());
            }}
          />
          <QuickBtn
            label="90 ngày"
            onClick={() => {
              setFrom(daysAgoIso(90));
              setTo(todayIso());
            }}
          />
        </div>
      </Card>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <StatCard label="Tổng tài khoản" value={stats.total} icon={Users} tone="primary" />
        <StatCard
          label="Đăng nhập trong kỳ"
          value={stats.totalActive}
          icon={UserRoundCheck}
          tone="success"
        />
      </div>

      <div className="mt-3 space-y-1.5">
        <div className="px-1 text-xs font-semibold text-muted-foreground">Phân loại</div>
        <div className="grid grid-cols-2 gap-2">
          <RoleRow
            label="Admin"
            icon={ShieldCheck}
            total={stats.admins.total}
            active={stats.admins.active}
            tone="text-primary"
          />
          <RoleRow
            label="Staff"
            icon={ShieldCheck}
            total={stats.staff.total}
            active={stats.staff.active}
            tone="text-blue-600"
          />
          <RoleRow
            label="NLĐ"
            icon={UserRoundCheck}
            total={stats.workers.total}
            active={stats.workers.active}
            tone="text-emerald-600"
          />
          <RoleRow
            label="Vãng lai"
            icon={UserRound}
            total={stats.guests.total}
            active={stats.guests.active}
            tone="text-amber-600"
          />
        </div>
      </div>
    </section>
  );
}

function QuickBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground active:bg-muted"
    >
      {label}
    </button>
  );
}

function RoleRow({
  label,
  icon: Icon,
  total,
  active,
  tone,
}: {
  label: string;
  icon: typeof Users;
  total: number;
  active: number;
  tone: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/20 px-3 py-2">
      <Icon className={`h-4 w-4 shrink-0 ${tone}`} />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold">{label}</div>
        <div className="text-[11px] text-muted-foreground">
          {total} TK · {active} đăng nhập
        </div>
      </div>
    </div>
  );
}
