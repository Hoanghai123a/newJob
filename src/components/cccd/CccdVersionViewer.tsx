import { useState } from "react";
import { Download, ZoomIn } from "lucide-react";
import { toast } from "@/lib/toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { fileUrl } from "@/lib/pocketbase";
import type { CccdVersionRecord } from "@/lib/cccd-versions";

interface CccdVersionViewerProps {
  version: CccdVersionRecord;
  trigger: React.ReactNode;
}

export function CccdVersionViewer({ version, trigger }: CccdVersionViewerProps) {
  const [zoomSrc, setZoomSrc] = useState("");

  const frontUrl = version.front_image ? fileUrl(version, version.front_image) : "";
  const backUrl = version.back_image ? fileUrl(version, version.back_image) : "";

  const download = async (url: string, label: string) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `CCCD_${version.cccd_number}_${label}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } catch {
      toast.error("Không tải được ảnh");
    }
  };

  if (!frontUrl && !backUrl) return null;

  return (
    <>
      <Dialog>
        <DialogTrigger asChild>{trigger}</DialogTrigger>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>CCCD: {version.cccd_number}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {frontUrl && (
              <ImageCard
                label="Mặt trước"
                url={frontUrl}
                onZoom={() => setZoomSrc(frontUrl)}
                onDownload={() => download(frontUrl, "mat_truoc")}
              />
            )}
            {backUrl && (
              <ImageCard
                label="Mặt sau"
                url={backUrl}
                onZoom={() => setZoomSrc(backUrl)}
                onDownload={() => download(backUrl, "mat_sau")}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!zoomSrc} onOpenChange={() => setZoomSrc("")}>
        <DialogContent className="w-auto max-w-[min(500px,calc(100vw-2rem))] rounded-2xl p-2">
          <DialogHeader>
            <DialogTitle>Ảnh CCCD</DialogTitle>
          </DialogHeader>
          {zoomSrc && (
            <img
              src={zoomSrc}
              alt="CCCD"
              className="h-auto max-h-[calc(100dvh-8rem)] w-auto max-w-[min(500px,calc(100vw-2rem))] rounded-xl object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ImageCard({
  label,
  url,
  onZoom,
  onDownload,
}: {
  label: string;
  url: string;
  onZoom: () => void;
  onDownload: () => void;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="relative aspect-[1.586/1] overflow-hidden rounded-xl border bg-muted/30">
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
        </div>
      </div>
    </div>
  );
}
