import { createFileRoute } from "@tanstack/react-router";
import {
  fetchAppSettingsRecord,
  getAppLogoFileUrl,
  readNewestSystemIcon,
  systemIconResponse,
} from "@/lib/server-app-brand";

const FALLBACK_ICON = "/icons/app-icon.svg";

function fallback() {
  return new Response(null, {
    status: 302,
    headers: { Location: FALLBACK_ICON, "Cache-Control": "no-cache" },
  });
}

export const Route = createFileRoute("/api/public/app-icon")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const companyId = new URL(request.url).searchParams.get("company") || undefined;

        // Nếu không có company ID → trả logo hệ thống từ file tĩnh
        if (!companyId) {
          // Chọn file được ghi gần nhất, tránh việc .png cũ che mất .jpg mới upload
          const icon = await readNewestSystemIcon([
            "app-icon.png",
            "app-icon.jpg",
            "app-icon.svg",
          ]);
          if (!icon) return fallback();
          return systemIconResponse(request, icon);
        }

        // Có company ID → lấy logo công ty từ PocketBase
        const app = await fetchAppSettingsRecord(companyId);
        if (!app) return fallback();

        const fileUrl = getAppLogoFileUrl(app);
        if (!fileUrl) return fallback();

        const upstreamFile = await fetch(fileUrl, {
          headers: { "ngrok-skip-browser-warning": "true" },
        }).catch(() => null);

        if (!upstreamFile || !upstreamFile.ok) return fallback();

        return new Response(upstreamFile.body, {
          status: 200,
          headers: {
            "Content-Type": upstreamFile.headers.get("content-type") || "image/png",
            "Cache-Control": "public, max-age=300",
          },
        });
      },
    },
  },
});
