import { useEffect, useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { Download, Monitor, Smartphone, X } from "lucide-react";
import { isStandaloneMode, usePwaInstallPrompt } from "@/lib/pwa-install";
import { IosInstallGuideDialog } from "./IosInstallGuideDialog";
import { DesktopInstallGuideDialog } from "./DesktopInstallGuideDialog";

const HIDE_FLAG_KEY = "hideInstallBanner";
const HIDE_UNTIL_KEY = "hideInstallBannerUntil";
const HIDE_MS = 30 * 24 * 60 * 60 * 1000;
const VISIT_COUNT_KEY = "jobconnect.installBanner.visitCount";
const SESSION_MARKER_KEY = "jobconnect.installBanner.session";

function isTemporarilyHidden(now: number) {
  const until = Number(window.localStorage.getItem(HIDE_UNTIL_KEY) || 0);
  return Number.isFinite(until) && until > now;
}

export function InstallFloatingBanner() {
  const { installPrompt, installApp, isAndroid, isIos } = usePwaInstallPrompt();
  const { pathname } = useLocation();
  const [ready, setReady] = useState(false);
  const [hidden, setHidden] = useState(true);
  const [guideOpen, setGuideOpen] = useState(false);
  const [desktopGuideOpen, setDesktopGuideOpen] = useState(false);
  const [hasUsedEnough, setHasUsedEnough] = useState(false);
  const [focused, setFocused] = useState(false);
  const [forceOpen, setForceOpen] = useState(false);

  const isDesktop = !isIos && !isAndroid;

  useEffect(() => {
    if (typeof window === "undefined") return;

    const evaluateVisibility = () => {
      if (isStandaloneMode() || isTemporarilyHidden(Date.now())) {
        setHidden(true);
        setReady(true);
        return;
      }

      const count = Number(window.localStorage.getItem(VISIT_COUNT_KEY) || 0);
      if (!window.sessionStorage.getItem(SESSION_MARKER_KEY)) {
        window.sessionStorage.setItem(SESSION_MARKER_KEY, "true");
        window.localStorage.setItem(VISIT_COUNT_KEY, String(count + 1));
        setHasUsedEnough(count + 1 >= 2);
      } else {
        setHasUsedEnough(count >= 2);
      }
      setHidden(false);
      setReady(true);
    };

    const onAppInstalled = () => {
      setHidden(true);
      window.localStorage.removeItem(HIDE_FLAG_KEY);
      window.localStorage.removeItem(HIDE_UNTIL_KEY);
    };

    window.addEventListener("appinstalled", onAppInstalled);
    evaluateVisibility();

    return () => {
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, [installPrompt, isAndroid, isIos, isDesktop]);

  useEffect(() => {
    const openInstallPrompt = () => {
      setHidden(false);
      setReady(true);
      setHasUsedEnough(true);
      setFocused(false);
      setForceOpen(true);
    };
    window.addEventListener("jobconnect:open-install", openInstallPrompt);
    return () => window.removeEventListener("jobconnect:open-install", openInstallPrompt);
  }, []);

  useEffect(() => {
    const updateFocusedState = () => {
      const active = document.activeElement;
      const tagName = active?.tagName || "";
      const isTextControl = tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
      const keyboardOpen = Boolean(
        window.visualViewport && window.visualViewport.height < window.innerHeight - 120,
      );
      setFocused(isTextControl || keyboardOpen);
    };

    updateFocusedState();
    document.addEventListener("focusin", updateFocusedState);
    document.addEventListener("focusout", updateFocusedState);
    window.visualViewport?.addEventListener("resize", updateFocusedState);
    return () => {
      document.removeEventListener("focusin", updateFocusedState);
      document.removeEventListener("focusout", updateFocusedState);
      window.visualViewport?.removeEventListener("resize", updateFocusedState);
    };
  }, []);

  const close = () => {
    window.localStorage.setItem(HIDE_FLAG_KEY, "true");
    window.localStorage.setItem(HIDE_UNTIL_KEY, String(Date.now() + HIDE_MS));
    setHidden(true);
    setForceOpen(false);
  };

  const install = async () => {
    if (installPrompt) {
      const choice = await installApp();
      if (choice === "accepted") {
        setHidden(true);
        setForceOpen(false);
      }
      return;
    }
    if (isDesktop) {
      setDesktopGuideOpen(true);
    }
  };

  const allowedRoute =
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/about" ||
    (pathname === "/account" && forceOpen);

  if (!ready || hidden || !hasUsedEnough || focused || !allowedRoute) return null;

  return (
    <>
      {!guideOpen && !desktopGuideOpen && (
        <div
          data-install-banner="visible"
          className="fixed left-1/2 z-50 w-[calc(100%-1rem)] max-w-[29rem] -translate-x-1/2 rounded-2xl border border-border/70 bg-card/95 px-3 py-2 shadow-[0_18px_45px_-20px_rgba(15,23,42,0.38)] backdrop-blur-xl"
          style={{ bottom: "calc(var(--mobile-nav-h) + 0.5rem + env(safe-area-inset-bottom))" }}
          role="status"
        >
          <button
            type="button"
            aria-label="Ẩn gợi ý cài đặt"
            onClick={close}
            className="absolute -right-1.5 -top-2 flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-soft active:scale-95"
          >
            <X className="h-3.5 w-3.5" />
          </button>

          <div className="flex items-center gap-2.5 pr-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
              {isIos ? (
                <Smartphone className="h-4.5 w-4.5" />
              ) : isDesktop ? (
                <Monitor className="h-4.5 w-4.5" />
              ) : (
                <Download className="h-4.5 w-4.5" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-tight text-foreground">
                {isIos
                  ? "Hướng dẫn cài app"
                  : isAndroid
                    ? "Cài app ra màn hình chính"
                    : "Cài ứng dụng trên máy tính"}
              </p>
              <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                {isIos
                  ? "Xem 5 bước thêm app vào màn hình chính trên iPhone/iPad."
                  : isAndroid
                    ? "Nhấn Cài đặt để thêm ứng dụng vào màn hình chính."
                    : "Mở nhanh như app, không cần trình duyệt."}
              </p>
            </div>

            {isIos ? (
              <button
                type="button"
                onClick={() => setGuideOpen(true)}
                className="flex min-h-10 shrink-0 items-center rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground active:scale-95"
              >
                Hướng dẫn
              </button>
            ) : (
              <button
                type="button"
                onClick={install}
                className="flex min-h-10 shrink-0 items-center rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground active:scale-95"
              >
                Cài đặt
              </button>
            )}
          </div>
        </div>
      )}

      <IosInstallGuideDialog open={guideOpen} onOpenChange={setGuideOpen} />
      <DesktopInstallGuideDialog open={desktopGuideOpen} onOpenChange={setDesktopGuideOpen} />
    </>
  );
}
