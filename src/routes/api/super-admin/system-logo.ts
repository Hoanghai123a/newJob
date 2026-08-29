import { createFileRoute } from "@tanstack/react-router";
import { getPBUpstream } from "@/lib/pocketbase-config";
import {
  getServerAuthUser,
  getPocketBaseAdminToken,
} from "@/lib/tenant-server";

const CUSTOM_ICON_FILES = ["app-icon.png", "app-icon.jpg", "app-icon.webp", "app-icon.gif"];
const DEFAULT_ICON = "app-icon.svg";
const DEFAULT_ICON_BACKUP = "app-icon-default.svg";

/**
 * Sao lưu logo mặc định một lần duy nhất. Cần thiết vì upload SVG sẽ ghi đè
 * app-icon.svg, nếu không có bản sao thì nút "Về mặc định" mất chỗ khôi phục.
 */
async function ensureDefaultBackup(iconsDir: string) {
  const fs = await import("fs/promises");
  const path = await import("path");
  const backup = path.join(iconsDir, DEFAULT_ICON_BACKUP);
  try {
    await fs.access(backup);
    return;
  } catch {
    // Chưa có bản sao → tạo từ file mặc định hiện tại
  }
  await fs.copyFile(path.join(iconsDir, DEFAULT_ICON), backup).catch(() => {});
}

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

        const buffer = await logo.arrayBuffer();
        const uint8Array = new Uint8Array(buffer);
        const fs = await import("fs/promises");
        const path = await import("path");

        // Map MIME type to extension
        const mimeToExt: Record<string, string> = {
          "image/png": ".png",
          "image/jpeg": ".jpg",
          "image/jpg": ".jpg",
          "image/svg+xml": ".svg",
          "image/webp": ".webp",
          "image/gif": ".gif",
        };
        const ext = mimeToExt[logo.type];
        if (!ext) {
          return Response.json(
            {
              message: `Định dạng ${logo.type || "không xác định"} không được hỗ trợ. Vui lòng chọn ảnh JPEG, PNG, WebP, GIF hoặc SVG.`,
            },
            { status: 400 },
          );
        }
        const iconsDir = path.join(process.cwd(), "public", "icons");

        // Giữ bản sao logo mặc định trước khi ghi đè (upload SVG sẽ thay app-icon.svg)
        await ensureDefaultBackup(iconsDir);

        const publicPath = path.join(iconsDir, `app-icon${ext}`);

        // Ghi file chính
        await fs.writeFile(publicPath, uint8Array);

        // Xóa các biến thể extension khác để không còn file cũ nào lẫn vào
        for (const stale of CUSTOM_ICON_FILES) {
          if (stale === `app-icon${ext}`) continue;
          await fs.unlink(path.join(iconsDir, stale)).catch(() => {});
        }

        // Tạo bản 192 và 512 PNG cho PWA (sharp hỗ trợ cả SVG)
        const sharp = (await import("sharp")).default;
        const img = sharp(uint8Array);

        await img
          .clone()
          .resize(192, 192, { fit: "contain", background: { r: 244, g: 251, b: 251, alpha: 1 } })
          .png()
          .toFile(path.join(iconsDir, "app-icon-192.png"));

        await img
          .clone()
          .resize(512, 512, { fit: "contain", background: { r: 244, g: 251, b: 251, alpha: 1 } })
          .png()
          .toFile(path.join(iconsDir, "app-icon-512.png"));

        console.log("[system-logo] Success: wrote to", publicPath);
        return Response.json({ success: true, path: publicPath });
      },
      DELETE: async ({ request }) => {
        const ctx = await requireSuperAdmin(request);
        if (!ctx) return Response.json({ message: "Forbidden" }, { status: 403 });

        const fs = await import("fs/promises");
        const path = await import("path");
        const iconsDir = path.join(process.cwd(), "public", "icons");

        // Xóa các file upload tùy chỉnh (png/jpg/webp/gif)
        for (const filename of CUSTOM_ICON_FILES) {
          await fs.unlink(path.join(iconsDir, filename)).catch(() => {});
        }

        // Nếu app-icon.svg từng bị upload ghi đè → khôi phục từ bản sao
        const backupPath = path.join(iconsDir, DEFAULT_ICON_BACKUP);
        const defaultPath = path.join(iconsDir, DEFAULT_ICON);
        await fs.copyFile(backupPath, defaultPath).catch(() => {});

        // Regenerate 192 và 512 từ logo mặc định (sharp rasterize SVG)
        const sharp = (await import("sharp")).default;
        const img = sharp(defaultPath);

        await img
          .clone()
          .resize(192, 192, { fit: "contain", background: { r: 244, g: 251, b: 251, alpha: 1 } })
          .png()
          .toFile(path.join(iconsDir, "app-icon-192.png"));

        await img
          .clone()
          .resize(512, 512, { fit: "contain", background: { r: 244, g: 251, b: 251, alpha: 1 } })
          .png()
          .toFile(path.join(iconsDir, "app-icon-512.png"));

        console.log("[system-logo] Restored default logo from", DEFAULT_ICON);
        return Response.json({ success: true, message: "Logo hệ thống đã được đặt lại." });
      },
    },
  },
});
