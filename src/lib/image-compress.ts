export async function compressImage(
  file: File,
  opts: { maxWidth?: number; quality?: number } = {},
): Promise<File> {
  const { maxWidth = 500, quality = 0.78 } = opts;

  if (!file.type.startsWith("image/")) return file;

  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;

  let targetW = width;
  let targetH = height;
  if (width > maxWidth || height > maxWidth) {
    const scale = maxWidth / Math.max(width, height);
    targetW = Math.round(width * scale);
    targetH = Math.round(height * scale);
  }

  const canvas = new OffscreenCanvas(targetW, targetH);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, targetW, targetH);
  bitmap.close();

  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
  const name = file.name.replace(/\.[^.]+$/, ".jpg");
  return new File([blob], name, { type: "image/jpeg" });
}
