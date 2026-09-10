import { useEffect, useState } from "react";
import { Download, IdCard, ImagePlus, Trash, ZoomIn } from "lucide-react";
import { toast } from "@/lib/toast";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fileUrl, type UserRecord } from "@/lib/pocketbase";
import type { WorkerRecord } from "@/lib/workers";
import { createStaffActionLog, type StaffActionType } from "@/lib/staff-log";
import { compressImage } from "@/lib/image-compress";
import {
  ensureCccdVersion,
  getCccdVersionByNumber,
  normalizeCccdNumber,
  updateCccdVersionAndCache,
  updateCccdVersionImages,
  type CccdVersionRecord,
} from "@/lib/cccd-versions";

interface CccdManagerProps {
  targetUser: WorkerRecord;
  actor: Partial<UserRecord> | null;
  onUpdated: () => void;
  readOnly?: boolean;
}

export function CccdManager({ targetUser, actor, onUpdated, readOnly }: CccdManagerProps) {
  const [uploading, setUploading] = useState(false);
  const [zoomSrc, setZoomSrc] = useState("");
  const [version, setVersion] = useState<CccdVersionRecord | null>(null);
  const cccdNumber = normalizeCccdNumber(targetUser.cccd);

  useEffect(() => {
    let active = true;
    setVersion(null);
    if (!cccdNumber)
      return () => {
        active = false;
      };
    getCccdVersionByNumber(targetUser.id, cccdNumber)
      .then((record) => {
        if (active) setVersion(record);
      })
      .catch(() => {
        if (active) setVersion(null);
      });
    return () => {
      active = false;
    };
  }, [cccdNumber, targetUser.id]);

  const frontUrl = version?.front_image ? fileUrl(version, version.front_image) : "";
  const backUrl = version?.back_image ? fileUrl(version, version.back_image) : "";

  const uploadCccd =
    (side: "front_image" | "back_image") => async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        toast.error("Vui lòng chọn file ảnh");
        return;
      }
      if (!cccdNumber) {
        toast.warning("Vui lòng quét QR hoặc nhập số CCCD trước khi thêm ảnh");
        e.target.value = "";
        return;
      }
      setUploading(true);
      try {
        const compressed = await compressImage(file);
        const targetVersion = version || (await ensureCccdVersion(targetUser.id, cccdNumber));
        const action: StaffActionType = targetVersion[side] ? "update" : "create";
        const updated = await updateCccdVersionImages(
          targetVersion.id,
          side === "front_image" ? compressed : undefined,
          side === "back_image" ? compressed : undefined,
        );
        setVersion(updated);
        await createStaffActionLog({
          actor,
          targetUserId: targetUser.id,
          targetCollection: "cccd_versions",
          targetRecord: updated.id,
          action,
          after: { [side]: updated[side] || compressed.name },
          note: `${actor?.role === "admin" ? "Admin" : "Staff"} ${action === "create" ? "thêm" : "cập nhật"} ảnh ${side === "front_image" ? "CCCD mặt trước" : "CCCD mặt sau"}`,
        });
        toast.success("Đã cập nhật ảnh CCCD");
        onUpdated();
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Lỗi tải ảnh");
      } finally {
        setUploading(false);
        e.target.value = "";
      }
    };

  const deleteCccd = async (side: "front_image" | "back_image") => {
    if (!version) return;
    if (!confirm(`Xoá ảnh ${side === "front_image" ? "mặt trước" : "mặt sau"}?`)) return;
    setUploading(true);
    try {
      const before = version[side];
      const updated = await updateCccdVersionAndCache(version.id, { [side]: null });
      setVersion(updated);
      await createStaffActionLog({
        actor,
        targetUserId: targetUser.id,
        targetCollection: "cccd_versions",
        targetRecord: version.id,
        action: "delete",
        before: { [side]: before },
        note: `${actor?.role === "admin" ? "Admin" : "Staff"} xoá ảnh ${side === "front_image" ? "CCCD mặt trước" : "CCCD mặt sau"}`,
      });
      toast.success("Đã xoá ảnh CCCD");
      onUpdated();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Lỗi xoá ảnh");
    } finally {
      setUploading(false);
    }
  };

  const downloadCccd = async (url: string, side: "front_image" | "back_image") => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${targetUser.full_name || targetUser.username || "nguoi-lao-dong"}_${side === "front_image" ? "mat_truoc" : "mat_sau"}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } catch {
      toast.error("Không tải được ảnh");
    }
  };

  return (
    <>
      <div className="space-y-2">
        {!cccdNumber && !readOnly && (
          <p className="text-xs text-amber-700">
            Vui lòng quét QR hoặc nhập số CCCD trước khi thêm ảnh.
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <CccdSlot
            label="Mặt trước"
            url={frontUrl}
            readOnly={readOnly}
            uploading={uploading}
            onPick={uploadCccd("front_image")}
            onDelete={() => deleteCccd("front_image")}
            onZoom={() => setZoomSrc(frontUrl)}
            onDownload={() => downloadCccd(frontUrl, "front_image")}
          />
          <CccdSlot
            label="Mặt sau"
            url={backUrl}
            readOnly={readOnly}
            uploading={uploading}
            onPick={uploadCccd("back_image")}
            onDelete={() => deleteCccd("back_image")}
            onZoom={() => setZoomSrc(backUrl)}
            onDownload={() => downloadCccd(backUrl, "back_image")}
          />
        </div>
      </div>
      <Dialog open={!!zoomSrc} onOpenChange={() => setZoomSrc("")}>
        <DialogContent className="w-auto max-w-[min(500px,calc(100vw-2rem))] rounded-2xl p-2">
          <DialogHeader>
            <DialogTitle>Ảnh CCCD</DialogTitle>
          </DialogHeader>
          {zoomSrc && (
            <img
              src={zoomSrc}
              alt="Ảnh CCCD"
              className="h-auto max-h-[calc(100dvh-8rem)] w-auto max-w-[min(500px,calc(100vw-2rem))] rounded-xl object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function CccdSlot({
  label,
  url,
  readOnly,
  uploading,
  onPick,
  onDelete,
  onZoom,
  onDownload,
}: {
  label: string;
  url: string;
  readOnly?: boolean;
  uploading: boolean;
  onPick: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDelete: () => void;
  onZoom: () => void;
  onDownload: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="relative aspect-[1.586/1] overflow-hidden rounded-xl border border-dashed border-border bg-white">
        {url ? (
          <>
            <img src={url} alt={label} className="h-full w-full object-cover" />
            <div className="absolute inset-x-0 bottom-0 flex justify-center gap-1.5 bg-gradient-to-t from-black/50 to-transparent px-2 pb-1.5 pt-4">
              <button
                type="button"
                onClick={onZoom}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-foreground shadow"
                aria-label="Phóng to"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={onDownload}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-foreground shadow"
                aria-label="Tải xuống"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
              {!readOnly && (
                <button
                  type="button"
                  onClick={onDelete}
                  disabled={uploading}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-destructive shadow"
                  aria-label="Xoá"
                >
                  <Trash className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </>
        ) : !readOnly ? (
          <label className="flex h-full w-full cursor-pointer flex-col items-center justify-center gap-1 text-muted-foreground">
            <input type="file" accept="image/*" hidden onChange={onPick} disabled={uploading} />
            <IdCard className="h-6 w-6" />
            <span className="text-[11px] font-medium">Bấm để chọn ảnh</span>
          </label>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
            <IdCard className="h-6 w-6" />
            <span className="text-[11px]">Chưa có ảnh</span>
          </div>
        )}
      </div>
      {url && !readOnly && (
        <label className="block cursor-pointer">
          <input type="file" accept="image/*" hidden onChange={onPick} disabled={uploading} />
          <span className="inline-flex items-center gap-1 text-[11px] text-primary">
            <ImagePlus className="h-3 w-3" /> Đổi ảnh
          </span>
        </label>
      )}
    </div>
  );
}
