import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X, ZoomIn } from "lucide-react";

export function ImageViewer({
  images,
  className,
}: {
  images: { url: string; thumbUrl: string }[];
  className?: string;
}) {
  const [viewIdx, setViewIdx] = useState<number | null>(null);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const activeImage = viewIdx !== null ? images[viewIdx] : null;
  const canBrowse = images.length > 1;

  const closeViewer = () => {
    setViewIdx(null);
    setTouchStartX(null);
  };

  const showPrev = () => {
    setViewIdx((current) => {
      if (current === null) return current;
      return current === 0 ? images.length - 1 : current - 1;
    });
  };

  const showNext = () => {
    setViewIdx((current) => {
      if (current === null) return current;
      return current === images.length - 1 ? 0 : current + 1;
    });
  };

  useEffect(() => {
    if (!activeImage) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeViewer();
      if (event.key === "ArrowLeft" && canBrowse) showPrev();
      if (event.key === "ArrowRight" && canBrowse) showNext();
    };

    document.body.dataset.approvalImageViewerOpen = "true";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      delete document.body.dataset.approvalImageViewerOpen;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [activeImage, canBrowse, images.length]);

  function handleTouchEnd(event: React.TouchEvent<HTMLDivElement>) {
    if (touchStartX === null) return;
    const diff = event.changedTouches[0].clientX - touchStartX;
    setTouchStartX(null);

    if (!canBrowse || Math.abs(diff) < 40) return;
    if (diff > 0) showPrev();
    else showNext();
  }

  if (!images.length) return null;

  return (
    <>
      <div className={className}>
        <div className="flex flex-wrap gap-2">
          {images.map((img, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setViewIdx(i)}
              className="group relative h-16 w-16 overflow-hidden rounded-lg border shadow-sm transition hover:shadow-md active:scale-95"
              aria-label={`Xem ảnh ${i + 1} kích thước lớn`}
            >
              <img src={img.thumbUrl} alt={`Ảnh ${i + 1}`} className="h-full w-full object-cover" />
              <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition group-hover:bg-black/30 group-hover:opacity-100">
                <ZoomIn className="h-4 w-4" />
              </span>
            </button>
          ))}
        </div>
      </div>

      {activeImage &&
        createPortal(
          <div
            data-approval-image-viewer
            className="pointer-events-auto fixed inset-0 z-[80] flex touch-pan-y select-none items-center justify-center bg-black/90 p-3 sm:p-6"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              if (event.target === event.currentTarget) closeViewer();
            }}
            onTouchStart={(event) => setTouchStartX(event.touches[0].clientX)}
            onTouchEnd={handleTouchEnd}
          >
            <button
              type="button"
              onClick={closeViewer}
              className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-foreground shadow-lg transition hover:bg-white"
              aria-label="Đóng ảnh"
            >
              <X className="h-5 w-5" />
            </button>

            {canBrowse && (
              <>
                <button
                  type="button"
                  onClick={showPrev}
                  className="absolute left-3 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-foreground shadow-lg transition hover:bg-white sm:flex"
                  aria-label="Xem ảnh trước"
                >
                  <ChevronLeft className="h-6 w-6" />
                </button>
                <button
                  type="button"
                  onClick={showNext}
                  className="absolute right-3 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-foreground shadow-lg transition hover:bg-white sm:flex"
                  aria-label="Xem ảnh tiếp theo"
                >
                  <ChevronRight className="h-6 w-6" />
                </button>
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white">
                  {viewIdx! + 1}/{images.length}
                </div>
              </>
            )}

            <img
              src={activeImage.url}
              alt={`Ảnh ${viewIdx! + 1}`}
              className="max-h-[88dvh] max-w-[96vw] rounded-lg object-contain shadow-2xl"
              draggable={false}
              onClick={(event) => event.stopPropagation()}
            />
          </div>,
          document.body,
        )}
    </>
  );
}
