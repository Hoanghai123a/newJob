import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
  useCallback,
  useRef,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { pb, type UserRecord } from "./pocketbase";
import { isSuperAdmin } from "./tenant";
import { getPBUpstream } from "./pocketbase-config";
import { clearStaffCache } from "./staff-cache";
import { stopStaffRealtimeSync } from "./realtime-sync";
import {
  STAFF_DIRECTORY_AUX_QUERY_ROOT,
  STAFF_DIRECTORY_STATE_PREFIX,
  STAFF_WORKSPACE_QUERY_ROOT,
} from "./staff-workspace-query";

interface AuthCtx {
  user: UserRecord | null;
  loading: boolean;
  isAdmin: boolean;
  isStaff: boolean;
  login: (
    identity: string,
    password: string,
    options?: { companyCode?: string; superAdmin?: boolean },
  ) => Promise<UserRecord>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);
const AUTH_REFRESH_TIMEOUT_MS = 3500;
const PASSWORD_REAUTH_INTERVAL_MS = 96 * 60 * 60 * 1000;
const PASSWORD_REAUTH_STORAGE_PREFIX = "jobconnect:password-verified-at:";
const LOGIN_ROLES = new Set(["super_admin", "admin", "staff"]);
export const PASSWORD_REAUTH_NOTICE_KEY = "jobconnect:password-reauth-notice";
export const PASSWORD_REAUTH_NOTICE =
  "Phiên đăng nhập đã hết hạn. Vui lòng nhập lại mật khẩu để tiếp tục.";
let pendingAuthRefresh: Promise<unknown> | null = null;

function passwordReauthStorageKey(userId: string) {
  return `${PASSWORD_REAUTH_STORAGE_PREFIX}${userId}`;
}

function getPasswordVerifiedAt(userId: string): number | undefined | null {
  if (typeof window === "undefined") return undefined;

  const value = window.localStorage.getItem(passwordReauthStorageKey(userId));
  if (value === null) return undefined;

  const verifiedAt = Number(value);
  if (!Number.isFinite(verifiedAt) || verifiedAt <= 0 || verifiedAt > Date.now()) return null;
  return verifiedAt;
}

function savePasswordVerifiedAt(userId: string, verifiedAt = Date.now()) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(passwordReauthStorageKey(userId), String(verifiedAt));
}

function clearPasswordVerifiedAt(userId?: string) {
  if (typeof window === "undefined" || !userId) return;
  window.localStorage.removeItem(passwordReauthStorageKey(userId));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("Auth refresh timeout")), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function refreshAuthOnce() {
  if (!pendingAuthRefresh) {
    pendingAuthRefresh = withTimeout(
      pb.collection("users").authRefresh(),
      AUTH_REFRESH_TIMEOUT_MS,
    ).finally(() => {
      pendingAuthRefresh = null;
    });
  }
  return pendingAuthRefresh;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<UserRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const isRedirectingForPasswordReauth = useRef(false);

  const logout = useCallback(() => {
    const userId = (pb.authStore.record as UserRecord | null)?.id;
    clearPasswordVerifiedAt(userId);
    // Disconnect SSE before clearing/changing the auth token to avoid PocketBase 403.
    pb.realtime.disconnect();
    pb.authStore.clear();
    queryClient.removeQueries({ queryKey: STAFF_WORKSPACE_QUERY_ROOT });
    queryClient.removeQueries({ queryKey: STAFF_DIRECTORY_AUX_QUERY_ROOT });
    if (typeof window !== "undefined") {
      for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
        const key = window.sessionStorage.key(index);
        if (key?.startsWith(STAFF_DIRECTORY_STATE_PREFIX)) {
          window.sessionStorage.removeItem(key);
        }
      }
    }
    stopStaffRealtimeSync()
      .catch((error) => console.warn("[auth] stopRealtime failed", error))
      .finally(() => clearStaffCache());
  }, [queryClient]);

  const expirePasswordReauth = useCallback(
    (userId: string) => {
      if (isRedirectingForPasswordReauth.current || typeof window === "undefined") return;
      isRedirectingForPasswordReauth.current = true;
      clearPasswordVerifiedAt(userId);
      window.sessionStorage.setItem(PASSWORD_REAUTH_NOTICE_KEY, PASSWORD_REAUTH_NOTICE);
      logout();
      window.location.replace("/login");
    },
    [logout],
  );

  useEffect(() => {
    const unsub = pb.authStore.onChange(() => {
      setUser((pb.authStore.record as UserRecord | null) ?? null);
    }, false);
    // Validate the stored session before exposing authenticated UI.
    (async () => {
      try {
        if (pb.authStore.isValid) {
          const storedUser = pb.authStore.record as UserRecord | null;
          const passwordVerifiedAt = storedUser?.id ? getPasswordVerifiedAt(storedUser.id) : null;

          if (!storedUser?.id || passwordVerifiedAt === null) {
            if (storedUser?.id) expirePasswordReauth(storedUser.id);
            else pb.authStore.clear();
            setUser(null);
            return;
          }

          // Existing sessions receive their first 96-hour cycle after this feature is deployed.
          if (passwordVerifiedAt === undefined) savePasswordVerifiedAt(storedUser.id);

          await refreshAuthOnce();
          const refreshedUser = pb.authStore.record as UserRecord | null;
          if (refreshedUser?.status === "disabled" || !LOGIN_ROLES.has(refreshedUser?.role || "")) {
            pb.authStore.clear();
            setUser(null);
          } else {
            setUser(refreshedUser ?? null);
          }
        } else {
          setUser(null);
        }
      } catch (error) {
        console.warn("[auth] refresh skipped", error);
        pb.authStore.clear();
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
    return () => unsub();
  }, [expirePasswordReauth]);

  useEffect(() => {
    if (loading || !user?.id || typeof window === "undefined") return;

    const passwordVerifiedAt = getPasswordVerifiedAt(user.id);
    if (passwordVerifiedAt === null) {
      expirePasswordReauth(user.id);
      return;
    }

    const verifiedAt = passwordVerifiedAt ?? Date.now();
    if (passwordVerifiedAt === undefined) savePasswordVerifiedAt(user.id, verifiedAt);

    const enforcePasswordReauth = () => {
      if (Date.now() - verifiedAt >= PASSWORD_REAUTH_INTERVAL_MS) {
        expirePasswordReauth(user.id);
      }
    };

    enforcePasswordReauth();
    const timeoutId = window.setTimeout(
      enforcePasswordReauth,
      Math.max(0, verifiedAt + PASSWORD_REAUTH_INTERVAL_MS - Date.now()),
    );
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") enforcePasswordReauth();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", enforcePasswordReauth);
    return () => {
      window.clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", enforcePasswordReauth);
    };
  }, [expirePasswordReauth, loading, user?.id]);

  const login = useCallback(
    async (
      identity: string,
      password: string,
      options?: { companyCode?: string; superAdmin?: boolean },
    ) => {
      const res = await fetch("/api/public/pocketbase-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity, password, ...options }),
      });
      const payload = await res.json().catch(() => ({}));

      if (!res.ok) {
        const error = new Error(payload?.message || "Đăng nhập thất bại") as Error & {
          status?: number;
          data?: unknown;
        };
        error.status = res.status;
        error.data = payload?.data;
        throw error;
      }

      if (!LOGIN_ROLES.has(payload?.record?.role)) {
        throw new Error("Tài khoản này không được phép đăng nhập hệ thống quản trị.");
      }

      if (payload?.token && payload?.record) {
        pb.authStore.save(payload.token, payload.record);
        savePasswordVerifiedAt(payload.record.id);
      }

      return payload.record as UserRecord;
    },
    [],
  );

  const refresh = useCallback(async () => {
    if (pb.authStore.isValid) {
      await refreshAuthOnce();
    }
  }, []);

  return (
    <Ctx.Provider
      value={{
        user,
        loading,
        isAdmin: user?.role === "admin" || isSuperAdmin(user),
        isStaff: user?.role === "staff",
        login,
        logout,
        refresh,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}
