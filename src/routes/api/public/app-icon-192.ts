import { createFileRoute } from "@tanstack/react-router";
import {
  fetchAppSettingsRecord,
  getAppLogoFileUrl,
  readNewestSystemIcon,
  systemIconResponse,
} from "@/lib/server-app-brand";
import sharp from "sharp";

const FALLBACK_ICON = "/icons/app-icon-192.png";
const SIZE = 192;

function fallback() {
  return new Response(null, {
    status: 302,
    headers: { Location: FALLBACK_ICON, "Cache-Control": "no-cache" },
  });
}

export const Route = createFileRoute("/api/public/app-icon-192")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const companyId = new URL(request.url).searchParams.get("company") || undefined;

        // Nếu không có company ID → trả logo hệ thống từ file tĩnh
        if (!companyId) {
          const icon = await readNewestSystemIcon(["app-icon-192.png"]);
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

        const buffer = Buffer.from(await upstreamFile.arrayBuffer());
        const resized = await sharp(buffer)
          .resize(SIZE, SIZE, { fit: "contain", background: { r: 244, g: 251, b: 251, alpha: 1 } })
          .png()
          .toBuffer()
          .catch(() => null);

        if (!resized) return fallback();

        return new Response(new Uint8Array(resized), {
          status: 200,
          headers: {
            "Content-Type": "image/png",
            "Cache-Control": "public, max-age=300",
          },
        });
      },
    },
  },
});
