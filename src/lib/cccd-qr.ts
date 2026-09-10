import jsQR from "jsqr";
import { normalizeDate } from "./date-utils";

export type CccdQrScanMode = "auto" | "basic" | "full";

export type CccdQrScanStage =
  | { step: "decoding"; message: string }
  | { step: "whole"; message: string }
  | { step: "region" | "refining" | "enhancing"; region: number; total: number; message: string }
  | {
      step: "rotating";
      region: number;
      total: number;
      rotation: 90 | 180 | 270;
      message: string;
    };

export type CccdQrScanOptions = {
  mode?: CccdQrScanMode;
  timeoutMs?: number;
  signal?: AbortSignal;
  onProgress?: (stage: CccdQrScanStage) => void;
};

export type CccdQrScanFailureReason =
  | "not_found"
  | "invalid_qr"
  | "timeout"
  | "unsupported_image"
  | "cancelled";

export type CccdQrScanResult =
  | { status: "success"; data: CccdQrData }
  | { status: "failed"; reason: CccdQrScanFailureReason };

const MAX_QR_SCAN_TIMEOUT_MS = 15000;
const SCAN_REGION_OVERLAP_RATIO = 0.08;
const AUTO_LONG_EDGE = 1600;
const BASIC_LONG_EDGE = 1200;
const FULL_LONG_EDGE = 2000;
const MAX_UPSCALE = 3;

export interface CccdQrData {
  cccd?: string;
  oldIdentity?: string;
  fullName?: string;
  dateOfBirth?: string;
  gender?: string;
  address?: string;
  issuedDate?: string;
}

export function formatDateForDisplay(value: unknown): string {
  const normalized = normalizeDate(value);
  if (!normalized) return "";
  const [year, month, day] = normalized.split("-");
  return `${day}-${month}-${year}`;
}

export function normalizeDisplayDate(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "";

  if (/^\d{8}$/.test(text)) {
    return formatDateForDisplay(`${text.slice(0, 2)}-${text.slice(2, 4)}-${text.slice(4)}`);
  }

  return formatDateForDisplay(text);
}

export function displayDateToPocketBase(value: unknown): string {
  return normalizeDate(value);
}

export function parseCccdQrText(text: string): CccdQrData | null {
  const normalizedText = text
    .split("\u0000")
    .join("")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/[\r\n]+/g, "")
    .trim();
  const parts = normalizedText.split("|").map((part) => part.trim());
  if (parts.length < 6) return null;

  return {
    cccd: parts[0]?.replace(/\D/g, "") || "",
    oldIdentity: parts[1]?.replace(/\D/g, "") || "",
    fullName: parts[2] || "",
    dateOfBirth: normalizeDisplayDate(parts[3]),
    gender: parts[4] || "",
    address: parts[5] || "",
    issuedDate: normalizeDisplayDate(parts[6]),
  };
}

type PastedCccdField =
  | "cccd"
  | "oldIdentity"
  | "fullName"
  | "dateOfBirth"
  | "gender"
  | "address"
  | "issuedDate";

const PASTED_CCCD_LABELS: Record<string, PastedCccdField> = {
  "so cccd": "cccd",
  cccd: "cccd",
  "so cmnd": "oldIdentity",
  cmnd: "oldIdentity",
  "so cmt": "oldIdentity",
  cmt: "oldIdentity",
  "ho va ten": "fullName",
  "ho ten": "fullName",
  "ngay sinh": "dateOfBirth",
  "gioi tinh": "gender",
  "noi thuong tru": "address",
  "dia chi thuong tru": "address",
  "thuong tru": "address",
  "ngay cap cccd": "issuedDate",
  "ngay cap": "issuedDate",
};

function normalizePastedCccdLabel(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u0110\u0111]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function parseCccdPastedText(text: string): CccdQrData | null {
  const normalizedText = String(text ?? "")
    .split("\u0000")
    .join("")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!normalizedText) return null;

  if (normalizedText.includes("|")) {
    const qrData = parseCccdQrText(normalizedText);
    if (qrData?.cccd?.length === 12 && qrData.fullName?.trim()) return qrData;
  }

  const values: Partial<Record<PastedCccdField, string>> = {};
  let activeField: PastedCccdField | null = null;

  for (const rawLine of normalizedText.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const labelledLine = /^([^:\uFF1A]+?)\s*[:\uFF1A]\s*(.*)$/.exec(line);
    if (labelledLine) {
      activeField = PASTED_CCCD_LABELS[normalizePastedCccdLabel(labelledLine[1])] ?? null;
      if (activeField) values[activeField] = labelledLine[2].trim();
      continue;
    }

    if (activeField) {
      values[activeField] = [values[activeField], line].filter(Boolean).join(" ");
    }
  }

  const cccd = values.cccd?.replace(/\D/g, "") || "";
  const fullName = values.fullName?.trim() || "";
  if (cccd.length !== 12 || !fullName) return null;

  const dateOfBirth = normalizeDisplayDate(values.dateOfBirth);
  const issuedDate = normalizeDisplayDate(values.issuedDate);
  if ((values.dateOfBirth && !dateOfBirth) || (values.issuedDate && !issuedDate)) return null;

  return {
    cccd,
    oldIdentity: values.oldIdentity?.replace(/\D/g, "") || "",
    fullName,
    dateOfBirth,
    gender: values.gender?.trim() || "",
    address: values.address?.trim() || "",
    issuedDate,
  };
}

type ScanRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type BarcodeDetectorResult = { rawValue?: string };
type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<BarcodeDetectorResult[]>;
};
type BarcodeDetectorConstructor = {
  new (options: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
};

type DecodedImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
};

type DetectionAttempt = {
  data: CccdQrData | null;
  detected: boolean;
};

type ScanContext = {
  deadline: number;
  signal?: AbortSignal;
  sawInvalidQr: boolean;
};

type TimedResult<T> =
  | { status: "completed"; value: T }
  | { status: "failed"; reason: "timeout" | "cancelled" }
  | { status: "error" };

function getStopReason(context: ScanContext): "timeout" | "cancelled" | null {
  if (context.signal?.aborted) return "cancelled";
  return Date.now() >= context.deadline ? "timeout" : null;
}

function recordAttempt(context: ScanContext, attempt: DetectionAttempt) {
  if (attempt.detected && !attempt.data) context.sawInvalidQr = true;
  return attempt.data;
}

function reportProgress(options: CccdQrScanOptions, stage: CccdQrScanStage) {
  options.onProgress?.(stage);
}

async function yieldToUi() {
  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
}

async function waitWithinDeadline<T>(
  promise: Promise<T>,
  context: ScanContext,
): Promise<TimedResult<T>> {
  const stopReason = getStopReason(context);
  if (stopReason) return { status: "failed", reason: stopReason };

  return new Promise((resolve) => {
    let settled = false;
    const remainingMs = Math.max(1, context.deadline - Date.now());
    const finish = (result: TimedResult<T>) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timerId);
      context.signal?.removeEventListener("abort", handleAbort);
      resolve(result);
    };
    const handleAbort = () => finish({ status: "failed", reason: "cancelled" });
    const timerId = globalThis.setTimeout(
      () => finish({ status: "failed", reason: "timeout" }),
      remainingMs,
    );

    context.signal?.addEventListener("abort", handleAbort, { once: true });
    promise.then(
      (value) => finish({ status: "completed", value }),
      () => finish({ status: "error" }),
    );
  });
}

function createHtmlImage(file: File) {
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Không giải mã được ảnh"));
    image.src = objectUrl;
  });
  return {
    image,
    objectUrl,
    promise,
    cancel: () => {
      image.onload = null;
      image.onerror = null;
      image.src = "";
      URL.revokeObjectURL(objectUrl);
    },
  };
}

async function decodeImage(
  file: File,
  context: ScanContext,
): Promise<DecodedImage | CccdQrScanFailureReason> {
  if (typeof createImageBitmap === "function") {
    const bitmapPromise = createImageBitmap(file);
    const bitmapResult = await waitWithinDeadline(bitmapPromise, context);
    if (bitmapResult.status === "completed") {
      const bitmap = bitmapResult.value;
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    }
    if (bitmapResult.status === "failed") {
      void bitmapPromise.then((lateBitmap) => lateBitmap.close()).catch(() => undefined);
      return bitmapResult.reason;
    }
  }

  if (typeof Image === "undefined") return "unsupported_image";
  const fallback = createHtmlImage(file);
  const imageResult = await waitWithinDeadline(fallback.promise, context);
  if (imageResult.status !== "completed") {
    fallback.cancel();
    return imageResult.status === "failed" ? imageResult.reason : "unsupported_image";
  }

  const image = imageResult.value;
  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    close: () => {
      image.src = "";
      URL.revokeObjectURL(fallback.objectUrl);
    },
  };
}

function buildPriorityRegions(
  width: number,
  height: number,
  overlapRatio = SCAN_REGION_OVERLAP_RATIO,
): ScanRegion[] {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const overlapX = (width * overlapRatio) / 2;
  const overlapY = (height * overlapRatio) / 2;
  const rightX = Math.max(0, halfWidth - overlapX);

  // Mẫu cũ có QR ở góc trên phải; mẫu mới thường nằm gần trung tâm bên phải.
  return [
    { x: rightX, y: 0, width: width - rightX, height: halfHeight + overlapY },
    { x: rightX, y: 0, width: width - rightX, height },
  ];
}

function renderScanRegion(image: DecodedImage, region: ScanRegion, targetLongEdge: number) {
  const sourceX = Math.max(0, Math.floor(region.x));
  const sourceY = Math.max(0, Math.floor(region.y));
  const sourceWidth = Math.max(1, Math.min(image.width - sourceX, Math.ceil(region.width)));
  const sourceHeight = Math.max(1, Math.min(image.height - sourceY, Math.ceil(region.height)));
  const sourceLongEdge = Math.max(sourceWidth, sourceHeight);
  const requestedScale = targetLongEdge / sourceLongEdge;
  const scale = requestedScale > 1 ? Math.min(requestedScale, MAX_UPSCALE) : requestedScale;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  // Ảnh camera bị mờ nhẹ đọc tốt hơn khi nội suy chất lượng cao thay vì nhân điểm ảnh.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    image.source,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return { canvas, ctx };
}

function renderRotatedCanvas(source: HTMLCanvasElement, rotation: 90 | 180 | 270) {
  const swapDimensions = rotation === 90 || rotation === 270;
  const canvas = document.createElement("canvas");
  canvas.width = swapDimensions ? source.height : source.width;
  canvas.height = swapDimensions ? source.width : source.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return { canvas, ctx };
}

function parseDetectedQrText(value: string | undefined) {
  if (!value) return null;
  return parseCccdQrText(value);
}

async function createQrBarcodeDetector(): Promise<BarcodeDetectorLike | null> {
  const BarcodeDetectorApi = (
    globalThis as typeof globalThis & { BarcodeDetector?: BarcodeDetectorConstructor }
  ).BarcodeDetector;
  if (!BarcodeDetectorApi) return null;

  try {
    if (BarcodeDetectorApi.getSupportedFormats) {
      const formats = await BarcodeDetectorApi.getSupportedFormats();
      if (!formats.includes("qr_code")) return null;
    }
    return new BarcodeDetectorApi({ formats: ["qr_code"] });
  } catch {
    return null;
  }
}

async function scanWithBarcodeDetector(
  detector: BarcodeDetectorLike | null,
  source: CanvasImageSource,
  context: ScanContext,
): Promise<DetectionAttempt> {
  if (!detector) return { data: null, detected: false };
  try {
    const detected = await waitWithinDeadline(detector.detect(source), context);
    if (detected.status !== "completed") return { data: null, detected: false };

    const results = detected.value;
    for (const result of results) {
      const data = parseDetectedQrText(result.rawValue);
      if (data) return { data, detected: true };
    }
    return { data: null, detected: results.some((result) => Boolean(result.rawValue)) };
  } catch {
    // Một số trình duyệt công bố BarcodeDetector nhưng không đọc được nguồn ảnh này.
    return { data: null, detected: false };
  }
}

function scanWithJsQr(imageData: ImageData): DetectionAttempt {
  const result = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: "attemptBoth",
  });
  return {
    data: parseDetectedQrText(result?.data),
    detected: Boolean(result?.data),
  };
}

function getCanvasImageData(rendered: {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}) {
  return rendered.ctx.getImageData(0, 0, rendered.canvas.width, rendered.canvas.height);
}

async function scanCanvas(
  detector: BarcodeDetectorLike | null,
  rendered: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D },
  context: ScanContext,
) {
  const nativeResult = recordAttempt(
    context,
    await scanWithBarcodeDetector(detector, rendered.canvas, context),
  );
  if (nativeResult) return nativeResult;
  if (getStopReason(context)) return null;
  const jsQrAttempt = scanWithJsQr(getCanvasImageData(rendered));
  if (getStopReason(context)) return null;
  return recordAttempt(context, jsQrAttempt);
}

function enhanceQrImage(source: ImageData) {
  const histogram = new Uint32Array(256);
  const sourcePixels = source.data;
  const pixelCount = source.width * source.height;

  for (let index = 0; index < sourcePixels.length; index += 4) {
    const luminance = Math.round(
      sourcePixels[index] * 0.299 +
        sourcePixels[index + 1] * 0.587 +
        sourcePixels[index + 2] * 0.114,
    );
    histogram[luminance] += 1;
  }

  const percentile = (ratio: number) => {
    const target = pixelCount * ratio;
    let count = 0;
    for (let value = 0; value < histogram.length; value += 1) {
      count += histogram[value];
      if (count >= target) return value;
    }
    return 255;
  };

  const low = percentile(0.01);
  const high = percentile(0.99);
  const range = Math.max(24, high - low);
  const output = new Uint8ClampedArray(sourcePixels.length);

  for (let index = 0; index < sourcePixels.length; index += 4) {
    const luminance =
      sourcePixels[index] * 0.299 +
      sourcePixels[index + 1] * 0.587 +
      sourcePixels[index + 2] * 0.114;
    const normalized = ((luminance - low) * 255) / range;
    const contrasted = Math.max(0, Math.min(255, (normalized - 128) * 1.2 + 128));
    output[index] = contrasted;
    output[index + 1] = contrasted;
    output[index + 2] = contrasted;
    output[index + 3] = 255;
  }

  return new ImageData(output, source.width, source.height);
}

function thresholdQrImage(source: ImageData) {
  const histogram = new Uint32Array(256);
  const pixels = source.data;
  const pixelCount = source.width * source.height;
  let totalLuminance = 0;

  for (let index = 0; index < pixels.length; index += 4) {
    const luminance = pixels[index];
    histogram[luminance] += 1;
    totalLuminance += luminance;
  }

  let backgroundWeight = 0;
  let backgroundSum = 0;
  let bestVariance = -1;
  let threshold = 128;

  for (let value = 0; value < histogram.length; value += 1) {
    backgroundWeight += histogram[value];
    if (backgroundWeight === 0) continue;

    const foregroundWeight = pixelCount - backgroundWeight;
    if (foregroundWeight === 0) break;

    backgroundSum += value * histogram[value];
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (totalLuminance - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      threshold = value;
    }
  }

  const output = new Uint8ClampedArray(pixels.length);
  for (let index = 0; index < pixels.length; index += 4) {
    const value = pixels[index] <= threshold ? 0 : 255;
    output[index] = value;
    output[index + 1] = value;
    output[index + 2] = value;
    output[index + 3] = 255;
  }
  return new ImageData(output, source.width, source.height);
}

function isMobileDevice() {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

function getDefaultTimeout(mode: CccdQrScanMode, mobile: boolean) {
  if (mode === "basic") return mobile ? 3000 : 4000;
  if (mode === "full") return mobile ? 10000 : 12000;
  return mobile ? 6000 : 8000;
}

function failed(reason: CccdQrScanFailureReason): CccdQrScanResult {
  return { status: "failed", reason };
}

export async function scanCccdQrFromFileDetailed(
  file: File,
  options: CccdQrScanOptions = {},
): Promise<CccdQrScanResult> {
  if (!file.type.startsWith("image/")) return failed("unsupported_image");

  const mode = options.mode ?? "auto";
  const timeoutMs = Math.min(
    Math.max(options.timeoutMs ?? getDefaultTimeout(mode, isMobileDevice()), 500),
    MAX_QR_SCAN_TIMEOUT_MS,
  );
  const context: ScanContext = {
    deadline: Date.now() + timeoutMs,
    signal: options.signal,
    sawInvalidQr: false,
  };

  reportProgress(options, { step: "decoding", message: "Đang chuẩn bị ảnh CCCD…" });
  const decoded = await decodeImage(file, context);
  if (typeof decoded === "string") return failed(decoded);

  try {
    const stoppedBeforeScan = getStopReason(context);
    if (stoppedBeforeScan) return failed(stoppedBeforeScan);

    const detectorResult = await waitWithinDeadline(createQrBarcodeDetector(), context);
    if (detectorResult.status === "failed") return failed(detectorResult.reason);
    const detector = detectorResult.status === "completed" ? detectorResult.value : null;
    reportProgress(options, { step: "whole", message: "Đang kiểm tra toàn ảnh…" });

    const originalNative = recordAttempt(
      context,
      await scanWithBarcodeDetector(detector, decoded.source, context),
    );
    if (originalNative) return { status: "success", data: originalNative };
    const stoppedAfterNativeScan = getStopReason(context);
    if (stoppedAfterNativeScan) return failed(stoppedAfterNativeScan);

    const wholeTarget = mode === "basic" ? BASIC_LONG_EDGE : AUTO_LONG_EDGE;
    const whole = renderScanRegion(
      decoded,
      { x: 0, y: 0, width: decoded.width, height: decoded.height },
      wholeTarget,
    );
    if (whole) {
      const wholeResult = await scanCanvas(detector, whole, context);
      if (wholeResult) return { status: "success", data: wholeResult };
    }

    const regions = buildPriorityRegions(decoded.width, decoded.height);
    const regionTarget =
      mode === "basic" ? BASIC_LONG_EDGE : mode === "full" ? FULL_LONG_EDGE : AUTO_LONG_EDGE;

    for (let index = 0; index < regions.length; index += 1) {
      const stopReason = getStopReason(context);
      if (stopReason) return failed(stopReason);
      reportProgress(options, {
        step: "region",
        region: index + 1,
        total: regions.length,
        message: `Đang phóng to vùng ${index + 1}/${regions.length}…`,
      });
      const rendered = renderScanRegion(decoded, regions[index], regionTarget);
      if (rendered) {
        const result = await scanCanvas(detector, rendered, context);
        if (result) return { status: "success", data: result };
      }
      await yieldToUi();
    }

    if (mode !== "basic") {
      for (let index = 0; index < regions.length; index += 1) {
        const stopReason = getStopReason(context);
        if (stopReason) return failed(stopReason);
        reportProgress(options, {
          step: "enhancing",
          region: index + 1,
          total: regions.length,
          message: `Đang tăng độ rõ vùng ${index + 1}/${regions.length}…`,
        });
        const rendered = renderScanRegion(decoded, regions[index], regionTarget);
        if (!rendered) continue;

        const enhanced = enhanceQrImage(getCanvasImageData(rendered));
        const enhancedAttempt = scanWithJsQr(enhanced);
        const stoppedAfterEnhancing = getStopReason(context);
        if (stoppedAfterEnhancing) return failed(stoppedAfterEnhancing);
        const enhancedResult = recordAttempt(context, enhancedAttempt);
        if (enhancedResult) return { status: "success", data: enhancedResult };

        const thresholdAttempt = scanWithJsQr(thresholdQrImage(enhanced));
        const stoppedAfterThreshold = getStopReason(context);
        if (stoppedAfterThreshold) return failed(stoppedAfterThreshold);
        const thresholdResult = recordAttempt(context, thresholdAttempt);
        if (thresholdResult) return { status: "success", data: thresholdResult };
        await yieldToUi();
      }
    }

    if (mode === "full") {
      const rotations = [90, 180, 270] as const;
      for (let index = 0; index < regions.length; index += 1) {
        const rendered = renderScanRegion(decoded, regions[index], FULL_LONG_EDGE);
        if (!rendered) continue;
        for (const rotation of rotations) {
          const stopReason = getStopReason(context);
          if (stopReason) return failed(stopReason);
          reportProgress(options, {
            step: "rotating",
            region: index + 1,
            total: regions.length,
            rotation,
            message: `Đang xoay thử vùng ${index + 1}/${regions.length} (${rotation}°)…`,
          });
          const rotated = renderRotatedCanvas(rendered.canvas, rotation);
          if (rotated) {
            const result = await scanCanvas(detector, rotated, context);
            if (result) return { status: "success", data: result };
          }
          await yieldToUi();
        }
      }
    }

    const finalStopReason = getStopReason(context);
    if (finalStopReason) return failed(finalStopReason);
    return failed(context.sawInvalidQr ? "invalid_qr" : "not_found");
  } finally {
    decoded.close();
  }
}

export async function scanCccdQrFromFile(
  file: File,
  options: CccdQrScanOptions = {},
): Promise<CccdQrData | null> {
  const result = await scanCccdQrFromFileDetailed(file, options);
  return result.status === "success" ? result.data : null;
}
