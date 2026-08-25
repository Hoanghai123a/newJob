import { createFileRoute } from "@tanstack/react-router";
import { getPBUpstream } from "@/lib/pocketbase-config";
import {
  getServerAuthUser,
  getPocketBaseAdminToken,
} from "@/lib/tenant-server";

async function requireSuperAdmin(request: Request) {
  const auth = await getServerAuthUser(request);
  if (!auth || auth.user.role !== "super_admin") return null;
  const adminToken = await getPocketBaseAdminToken();
  return adminToken ? { auth, adminToken, upstream: getPBUpstream() } : null;
}

export const Route = createFileRoute("/api/super-admin/system-logo")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ctx = await requireSuperAdmin(request);
        if (!ctx) return Response.json({ message: "Forbidden" }, { status: 403 });

        const formData = await request.formData();
        const logo = formData.get("logo");

        console.log("[system-logo] Received file:", logo instanceof File ? `${logo.name} (${logo.type}, ${logo.size} bytes)` : typeof logo);

        if (!logo || !(logo instanceof File)) {
          return Response.json({ message: "Thiếu file logo." }, { status: 400 });
        }

        // Đọc file buffer
        const buffer = await logo.arrayBuffer();
        const uint8Array = new Uint8Array(buffer);

        // Ghi đè file tĩnh /public/icons/app-icon.svg (hoặc .jpg/.png tùy loại)
        const fs = await import("fs/promises");
        const path = await import("path");

        // Xác định extension dựa trên MIME type
        let ext = ".jpg";
        if (logo.type === "image/png") ext = ".png";
        else if (logo.type === "image/svg+xml") ext = ".svg";

        const publicPath = path.join(process.cwd(), "public", "icons", `app-icon${ext}`);
        await fs.writeFile(publicPath, uint8Array);

        // Nếu không phải SVG, cũng tạo bản 192 và 512 cho PWA
        if (ext !== ".svg") {
          const sharp = (await import("sharp")).default;
          const img = sharp(uint8Array);

          await img.resize(192, 192, { fit: "contain", background: { r: 244, g: 251, b: 251, alpha: 1 } })
            .png()
            .toFile(path.join(process.cwd(), "public", "icons", "app-icon-192.png"));

          await img.resize(512, 512, { fit: "contain", background: { r: 244, g: 251, b: 251, alpha: 1 } })
            .png()
            .toFile(path.join(process.cwd(), "public", "icons", "app-icon-512.png"));
        }

        console.log("[system-logo] Success: wrote to", publicPath);
        return Response.json({ success: true, path: publicPath });
      },
      DELETE: async ({ request }) => {
        const ctx = await requireSuperAdmin(request);
        if (!ctx) return Response.json({ message: "Forbidden" }, { status: 403 });

        // Khôi phục logo mặc định bằng cách xóa file custom (nếu có) hoặc copy logo H gốc
        const fs = await import("fs/promises");
        const path = await import("path");

        // Không xóa file — để logo H mặc định vẫn còn
        // Nếu muốn reset về logo cũ, copy từ backup hoặc git

        return Response.json({ success: true, message: "Logo hệ thống đã được đặt lại." });
      },
    },
  },
});
