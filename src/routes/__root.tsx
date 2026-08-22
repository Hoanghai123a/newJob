import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  Link,
} from "@tanstack/react-router";
import { useEffect } from "react";

import appCss from "../styles.css?url";
import { AuthProvider } from "@/lib/auth";
import { getUserErrorMessage } from "@/lib/toast";
import { Toaster } from "@/components/ui/sonner";
import { installPwaPromptListeners } from "@/lib/pwa-install";
import { BrandHeadLinks } from "@/components/layout/BrandHeadLinks";
import { PushPermissionPrompt } from "@/components/layout/PushPermissionPrompt";
import { DEVICE_PROFILE_BOOTSTRAP } from "@/lib/device-profile";

const CHUNK_RELOAD_KEY = "jobconnect.chunk-reload-path";

function isChunkLoadError(error: Error) {
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Load failed for module/i.test(
    error.message,
  );
}

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <p className="mt-2 text-sm text-muted-foreground">Trang không tồn tại.</p>
        <Link
          to="/"
          className="mt-6 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Về trang chủ
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  const chunkLoadFailed = isChunkLoadError(error);
  const userMessage = getUserErrorMessage(error);

  useEffect(() => {
    if (import.meta.env.DEV) console.error("[JobConnect] Lỗi giao diện gốc:", error);
  }, [error]);

  useEffect(() => {
    if (!chunkLoadFailed) return;

    const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (sessionStorage.getItem(CHUNK_RELOAD_KEY) === currentPath) return;

    sessionStorage.setItem(CHUNK_RELOAD_KEY, currentPath);
    window.location.reload();
  }, [chunkLoadFailed]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">Đã có lỗi xảy ra</h1>
        <p className="mt-2 text-sm text-muted-foreground">{userMessage}</p>
        <button
          onClick={() => {
            if (chunkLoadFailed) {
              window.location.reload();
              return;
            }
            router.invalidate();
            reset();
          }}
          className="mt-6 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Thử lại
        </button>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "theme-color", content: "#0e6b7a" },
      { title: "Hoàng Long DJC" },
      { name: "description", content: "Kết nối nhà tuyển dụng và người lao động khu công nghiệp." },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;500;600;700&display=swap",
      },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/api/public/app-icon" },
      { rel: "icon", href: "/api/public/app-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" data-ui-device="mobile" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: DEVICE_PROFILE_BOOTSTRAP }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  useEffect(() => {
    sessionStorage.removeItem(CHUNK_RELOAD_KEY);
    const removePwaListeners = installPwaPromptListeners();
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
    return removePwaListeners;
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrandHeadLinks />
        <PushPermissionPrompt />
        <div className="app-shell">
          <Outlet />
          <Toaster richColors position="top-center" />
        </div>
      </AuthProvider>
    </QueryClientProvider>
  );
}
