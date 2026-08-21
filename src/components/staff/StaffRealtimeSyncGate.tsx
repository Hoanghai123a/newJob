import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { fetchFactoryManagers, isFactoryAssignmentActive } from "@/lib/factories";
import { startStaffRealtimeSync, stopStaffRealtimeSync } from "@/lib/realtime-sync";

export function StaffRealtimeSyncGate() {
  const { user } = useAuth();

  useEffect(() => {
    let cancelled = false;
    let syncing = false;

    const sync = async () => {
      if (
        cancelled ||
        !user?.id ||
        user.must_change_password ||
        (user.role !== "staff" && user.role !== "admin")
      ) {
        await stopStaffRealtimeSync();
        return;
      }
      if (syncing) return;
      syncing = true;
      try {
        const managers = await fetchFactoryManagers(user.id);
        const managedFactoryIds = new Set(
          managers.filter((item) => isFactoryAssignmentActive(item)).map((item) => item.factory),
        );
        if (!cancelled) await startStaffRealtimeSync(user, managedFactoryIds);
      } catch (error) {
        console.warn("[realtime-sync-gate] start failed", error);
      } finally {
        syncing = false;
      }
    };

    void sync();
    const interval = window.setInterval(() => void sync(), 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void sync();
    };
    const onOnline = () => void sync();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      stopStaffRealtimeSync().catch((error) =>
        console.warn("[realtime-sync-gate] stop failed", error),
      );
    };
    // Re-sync when identity or role changes; the callback only needs those stable fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.must_change_password, user?.role]);

  return null;
}
