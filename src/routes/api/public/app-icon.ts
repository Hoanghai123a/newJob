import { createFileRoute } from "@tanstack/react-router";
import { fetchAppSettingsRecord, getAppLogoFileUrl } from "@/lib/server-app-brand";

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
          const fs = await import("fs/promises");
          const path = await import("path");
          const publicDir = path.join(process.cwd(), "public", "icons");

          // Ưu tiên .png hoặc .jpg (superadmin upload), fallback .svg
          for (const ext of [".png", ".jpg", ".svg"]) {
            const filePath = path.join(publicDir, `app-icon${ext}`);
            try {
              const buffer = await fs.readFile(filePath);
              const contentType = ext === ".svg" ? "image/svg+xml" : ext === ".png" ? "image/png" : "image/jpeg";
              return new Response(buffer, {
                status: 200,
                headers: {
                  "Content-Type": contentType,
                  "Cache-Control": "public, max-age=300",
                },
              });
            } catch {
              continue;
            }
          }
          return fallback();
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
