const SUPPORTED_CLIPBOARD_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type ClipboardImageResult =
  | { status: "success"; file: File }
  | { status: "fallback"; message: string };

export async function readClipboardImage(sideLabel: string): Promise<ClipboardImageResult> {
  if (!navigator.clipboard?.read) {
    return {
      status: "fallback",
      message: "Trình duyệt không hỗ trợ đọc ảnh tự động. Hãy nhấn Ctrl+V trong popup.",
    };
  }

  try {
    const clipboardItems = await navigator.clipboard.read();
    for (const item of clipboardItems) {
      const imageType = item.types.find((type) => SUPPORTED_CLIPBOARD_IMAGE_TYPES.has(type));
      if (!imageType) continue;
      const blob = await item.getType(imageType);
      return { status: "success", file: clipboardBlobToFile(blob, sideLabel) };
    }
    return {
      status: "fallback",
      message: "Clipboard không có ảnh PNG, JPEG hoặc WebP. Hãy sao chép ảnh rồi nhấn Ctrl+V.",
    };
  } catch {
    return {
      status: "fallback",
      message: "Trình duyệt chưa cho phép đọc ảnh. Hãy nhấn Ctrl+V trong popup.",
    };
  }
}

function clipboardBlobToFile(blob: Blob, sideLabel: string) {
  const type = SUPPORTED_CLIPBOARD_IMAGE_TYPES.has(blob.type) ? blob.type : "image/png";
  const extension = type === "image/jpeg" ? "jpg" : type.split("/")[1] || "png";
  const safeSide = sideLabel.toLowerCase().includes("trước") ? "mat-truoc" : "mat-sau";
  return new File([blob], `cccd-${safeSide}-${Date.now()}.${extension}`, { type });
}
