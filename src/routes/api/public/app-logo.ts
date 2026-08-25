import { createFileRoute } from "@tanstack/react-router";
import { fetchAppSettingsRecord, getAppLogoFileUrl } from "@/lib/server-app-brand";

const FALLBACK_ICON = "/icons/app-icon.svg";

function svgIconFromDataUrl(dataUrl: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#f4fbfb"/>
  <rect x="28" y="28" width="456" height="456" rx="92" fill="#ffffff"/>
  <image href="${dataUrl}" x="56" y="56" width="400" height="400" preserveAspectRatio="xMidYMid meet" />
</svg>`;
}

function fallback() {
  return new Response(null, {
    status: 302,
    headers: { Location: FALLBACK_ICON, "Cache-Control": "no-cache" },
  });
}

export const Route = createFileRoute("/api/public/app-logo")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const companyId = new URL(request.url).searchParams.get("company") || undefined;
        const app = await fetchAppSettingsRecord(companyId);
        if (!app) return fallback();

        const fileUrl = getAppLogoFileUrl(app);
        if (!fileUrl) return fallback();
        const upstreamFile = await fetch(fileUrl, {
          headers: { "ngrok-skip-browser-warning": "true" },
        }).catch(() => null);

        if (!upstreamFile || !upstreamFile.ok) return fallback();

        const contentType = upstreamFile.headers.get("content-type") || "application/octet-stream";
        const bytes = new Uint8Array(await upstreamFile.arrayBuffer());
        const base64 = Buffer.from(bytes).toString("base64");
        const dataUrl = `data:${contentType};base64,${base64}`;

        return new Response(svgIconFromDataUrl(dataUrl), {
          status: 200,
          headers: {
            "Content-Type": "image/svg+xml; charset=utf-8",
            "Cache-Control": "public, max-age=300",
          },
        });
      },
    },
  },
});
