import { createFileRoute } from "@tanstack/react-router";
import { fetchAppSettingsRecord, getSystemIconVersion } from "@/lib/server-app-brand";

const FALLBACK_ICON = "/icons/app-icon.svg";

export const Route = createFileRoute("/api/public/manifest/webmanifest")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const companyId = new URL(request.url).searchParams.get("company") || undefined;

        // Không có company ID → dùng tên và icon hệ thống, không mượn từ tenant
        if (!companyId) {
          // Lấy timestamp của file logo mới nhất để cache-busting
          const iconVersion = await getSystemIconVersion([
            "app-icon-192.png",
            "app-icon-512.png",
            "app-icon.png",
            "app-icon.jpg",
          ]);
          const versionParam = `?v=${encodeURIComponent(iconVersion)}`;

          return Response.json(
            {
              name: "Tuyển dụng 4.0",
              short_name: "Tuyển dụng",
              description: "Tuyển dụng 4.0, bảng tin và hỗ trợ người lao động.",
              start_url: "/",
              scope: "/",
              display: "standalone",
              display_override: ["standalone", "minimal-ui"],
              background_color: "#f4fbfb",
              theme_color: "#0e6b7a",
              orientation: "portrait-primary",
              icons: [
                {
                  src: `/api/public/app-icon-192${versionParam}`,
                  sizes: "192x192",
                  type: "image/png",
                  purpose: "any",
                },
                {
                  src: `/api/public/app-icon-512${versionParam}`,
                  sizes: "512x512",
                  type: "image/png",
                  purpose: "any",
                },
                {
                  src: `/api/public/app-icon-192${versionParam}`,
                  sizes: "192x192",
                  type: "image/png",
                  purpose: "maskable",
                },
                {
                  src: `/api/public/app-icon-512${versionParam}`,
                  sizes: "512x512",
                  type: "image/png",
                  purpose: "maskable",
                },
                {
                  src: `/api/public/app-icon${versionParam}`,
                  sizes: "any",
                  type: "image/png",
                  purpose: "any",
                },
              ],
            },
            {
              headers: {
                "Content-Type": "application/manifest+json; charset=utf-8",
                "Cache-Control": "no-cache",
              },
            },
          );
        }

        const app = await fetchAppSettingsRecord(companyId);
        const name = app?.item.company_name?.trim() || "Tuyển dụng 4.0";
        const shortName = name.slice(0, 12) || "Tuyển dụng";
        const iconVersion = app?.item.updated || app?.item.id || "";
        const companyParam = companyId ? `&company=${encodeURIComponent(companyId)}` : "";
        const iconSrc = app?.item.logo
          ? `/api/public/app-icon?v=${encodeURIComponent(iconVersion)}${companyParam}`
          : FALLBACK_ICON;
        const iconType = app?.item.logo ? undefined : "image/svg+xml";

        return Response.json(
          {
            name,
            short_name: shortName,
            description: "Tuyển dụng 4.0, bảng tin và hỗ trợ người lao động.",
            start_url: "/",
            scope: "/",
            display: "standalone",
            display_override: ["standalone", "minimal-ui"],
            background_color: "#f4fbfb",
            theme_color: "#0e6b7a",
            orientation: "portrait-primary",
            icons: [
              {
                src: `/api/public/app-icon-192?v=${encodeURIComponent(iconVersion)}${companyParam}`,
                sizes: "192x192",
                type: "image/png",
                purpose: "any",
              },
              {
                src: `/api/public/app-icon-512?v=${encodeURIComponent(iconVersion)}${companyParam}`,
                sizes: "512x512",
                type: "image/png",
                purpose: "any",
              },
              {
                src: `/api/public/app-icon-192?v=${encodeURIComponent(iconVersion)}${companyParam}`,
                sizes: "192x192",
                type: "image/png",
                purpose: "maskable",
              },
              {
                src: `/api/public/app-icon-512?v=${encodeURIComponent(iconVersion)}${companyParam}`,
                sizes: "512x512",
                type: "image/png",
                purpose: "maskable",
              },
              {
                src: iconSrc,
                sizes: "any",
                type: iconType,
                purpose: "any",
              },
            ],
          },
          {
            headers: {
              "Content-Type": "application/manifest+json; charset=utf-8",
              "Cache-Control": "no-cache",
            },
          },
        );
      },
    },
  },
});
