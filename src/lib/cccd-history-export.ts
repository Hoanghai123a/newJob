import JSZip from "jszip";
import { saveAs } from "file-saver";
import type { Paragraph as DocxParagraph } from "docx";
import { fetchCccdVersionsByUsers, type CccdVersionRecord } from "./cccd-versions";
import type { EmploymentHistoryRecord } from "./employment";
import type { FactoryRecord } from "./factories";
import { fileUrl, type UserRecord } from "./pocketbase";

export type CccdHistoryExportMode = "folders" | "word";
export type CccdHistorySelectionSource = "date-range" | "excel";

export interface CccdHistoryExcelIssue {
  rowNumber: number;
  employeeCode: string;
  factoryName: string;
  workerName: string;
  reason: string;
  selectedHistoryId?: string;
  selectedJoinDate?: string;
}

export interface CccdHistoryExcelMatchResult {
  totalRows: number;
  histories: EmploymentHistoryRecord[];
  issues: CccdHistoryExcelIssue[];
  blockingError?: string;
}

export interface CccdHistoryExportProgress {
  completed: number;
  total: number;
  message: string;
}

function createAbortError() {
  return new DOMException("Đã hủy", "AbortError");
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : createAbortError();
}

function isAbortError(error: unknown, signal?: AbortSignal) {
  return (
    signal?.aborted ||
    (error && typeof error === "object" && "isAbort" in error && Boolean(error.isAbort)) ||
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export interface PreparedCccdHistoryRecord {
  historyId: string;
  factoryId: string;
  factoryName: string;
  joinDate: string;
  workerName: string;
  cccdNumber: string;
  frontUrl?: string;
  backUrl?: string;
}

export interface CccdHistoryExportStats {
  total: number;
  full: number;
  partial: number;
  missing: number;
}

export interface CccdHistoryPreparation {
  records: PreparedCccdHistoryRecord[];
  stats: CccdHistoryExportStats;
  recordOrder: "default" | "source";
}

export interface CccdHistoryExportResult extends CccdHistoryExportStats {
  exported: number;
  failedImages: number;
}

type ImageSide = "front" | "back";
type DownloadedImage = {
  blob: Blob;
  extension: string;
};
type WordImage = {
  data: Uint8Array;
  type: "jpg" | "png" | "gif" | "bmp";
  width: number;
  height: number;
};

const WORD_IMAGE_WIDTH_PX = 432;
const WORD_IMAGE_MAX_HEIGHT_PX = 3.5 * 96;
const WORD_IMAGE_GAP_TWIP = 2 * 1440;

function normalizeCccd(value?: string | null) {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizeLookupText(value?: string | null) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("vi");
}

function normalizeEmployeeCode(value?: string | null) {
  return normalizeLookupText(value).replace(/\s+/g, "");
}

function historyIsoDate(value?: string | null) {
  return String(value ?? "").match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || "";
}

function compareLatestHistory(a: EmploymentHistoryRecord, b: EmploymentHistoryRecord) {
  const joinDiff = historyIsoDate(b.join_date).localeCompare(historyIsoDate(a.join_date));
  if (joinDiff) return joinDiff;
  const updatedDiff = toTimestamp(b.updated) - toTimestamp(a.updated);
  if (updatedDiff) return updatedDiff;
  const createdDiff = toTimestamp(b.created) - toTimestamp(a.created);
  if (createdDiff) return createdDiff;
  return b.id.localeCompare(a.id);
}

export function filterCccdHistoriesByLeaveDate(
  histories: EmploymentHistoryRecord[],
  factoryIds: string[],
  endDate: string,
) {
  if (!factoryIds.length || !endDate) return [];
  const factoryIdSet = new Set(factoryIds);
  return histories.filter((history) => {
    if (!factoryIdSet.has(history.factory)) return false;
    const leaveDate = historyIsoDate(history.leave_date);
    return !leaveDate || leaveDate <= endDate;
  });
}

function findHeaderIndex(headers: string[], aliases: string[]) {
  const normalizedAliases = new Set(aliases.map(normalizeLookupText));
  return headers.findIndex((header) => normalizedAliases.has(normalizeLookupText(header)));
}

export function matchCccdHistoriesFromExcelRows(
  rows: string[][],
  histories: EmploymentHistoryRecord[],
  factories: FactoryRecord[],
): CccdHistoryExcelMatchResult {
  const headers = rows[0] || [];
  const employeeCodeIndex = findHeaderIndex(headers, ["Mã nhân viên", "Mã NV"]);
  const factoryNameIndex = findHeaderIndex(headers, ["Tên nhà máy", "Nhà máy"]);
  const workerNameIndex = findHeaderIndex(headers, ["Họ tên"]);
  const missingColumns = [
    employeeCodeIndex < 0 ? "Mã nhân viên" : "",
    factoryNameIndex < 0 ? "Tên nhà máy" : "",
    workerNameIndex < 0 ? "Họ tên" : "",
  ].filter(Boolean);

  if (missingColumns.length) {
    const reason = `Thiếu cột bắt buộc: ${missingColumns.join(", ")}`;
    return {
      totalRows: Math.max(0, rows.length - 1),
      histories: [],
      issues: [
        {
          rowNumber: 1,
          employeeCode: "",
          factoryName: "",
          workerName: "",
          reason,
        },
      ],
      blockingError: reason,
    };
  }

  const factoryByName = new Map(
    factories.map((factory) => [normalizeLookupText(factory.name), factory]),
  );
  const historiesByKey = new Map<string, EmploymentHistoryRecord[]>();
  for (const history of histories) {
    const code = normalizeEmployeeCode(history.employee_code);
    if (!code || !history.factory) continue;
    const key = `${history.factory}::${code}`;
    const bucket = historiesByKey.get(key) || [];
    bucket.push(history);
    historiesByKey.set(key, bucket);
  }
  for (const bucket of historiesByKey.values()) bucket.sort(compareLatestHistory);

  const dataRows = rows
    .slice(1)
    .map((row, index) => ({ row, rowNumber: index + 2 }))
    .filter(({ row }) => row.some((cell) => String(cell ?? "").trim()));
  const issues: CccdHistoryExcelIssue[] = [];
  const selectedHistories = new Map<string, EmploymentHistoryRecord>();
  const seenSourceKeys = new Set<string>();

  dataRows.forEach(({ row, rowNumber }) => {
    const employeeCode = String(row[employeeCodeIndex] ?? "").trim();
    const factoryName = String(row[factoryNameIndex] ?? "").trim();
    const workerName = String(row[workerNameIndex] ?? "").trim();
    const normalizedCode = normalizeEmployeeCode(employeeCode);
    const normalizedFactory = normalizeLookupText(factoryName);
    const issueBase = { rowNumber, employeeCode, factoryName, workerName };

    if (!normalizedCode || !normalizedFactory) {
      issues.push({
        ...issueBase,
        reason: !normalizedCode ? "Thiếu Mã nhân viên" : "Thiếu Tên nhà máy",
      });
      return;
    }

    const sourceKey = `${normalizedFactory}::${normalizedCode}`;
    if (seenSourceKeys.has(sourceKey)) {
      issues.push({ ...issueBase, reason: "Dòng trùng Mã nhân viên và Nhà máy trong file" });
      return;
    }
    seenSourceKeys.add(sourceKey);

    const factory = factoryByName.get(normalizedFactory);
    if (!factory) {
      issues.push({ ...issueBase, reason: "Không tìm thấy nhà máy" });
      return;
    }

    const matches = historiesByKey.get(`${factory.id}::${normalizedCode}`) || [];
    const selected = matches[0];
    if (!selected) {
      issues.push({ ...issueBase, reason: "Không khớp lịch sử đi làm" });
      return;
    }

    selectedHistories.set(selected.id, selected);
    if (matches.length > 1) {
      issues.push({
        ...issueBase,
        reason: `Khớp ${matches.length} lịch sử, đã chọn lịch sử mới nhất`,
        selectedHistoryId: selected.id,
        selectedJoinDate: historyIsoDate(selected.join_date),
      });
    }
  });

  return {
    totalRows: dataRows.length,
    histories: [...selectedHistories.values()],
    issues,
  };
}

function toTimestamp(value?: string) {
  const time = new Date(value || 0).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function safePathSegment(value: string, fallback: string) {
  const cleaned = value
    .normalize("NFC")
    .replace(
      new RegExp(`[<>:"/\\|?*${String.fromCharCode(0)}-${String.fromCharCode(31)}]`, "g"),
      "_",
    )
    .replace(/[. ]+$/g, "")
    .trim();
  return (cleaned || fallback).slice(0, 120);
}

function safeJoinDate(value?: string) {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "khong-ro-ngay-vao";
}

function timestampForFilename() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function comparePreparedRecords(a: PreparedCccdHistoryRecord, b: PreparedCccdHistoryRecord) {
  const factoryDiff = a.factoryName.localeCompare(b.factoryName, "vi");
  if (factoryDiff) return factoryDiff;
  const dateDiff = a.joinDate.localeCompare(b.joinDate);
  if (dateDiff) return dateDiff;
  const nameDiff = a.workerName.localeCompare(b.workerName, "vi");
  if (nameDiff) return nameDiff;
  return a.historyId.localeCompare(b.historyId);
}

function summarizeRecords(records: PreparedCccdHistoryRecord[]): CccdHistoryExportStats {
  let full = 0;
  let partial = 0;
  let missing = 0;
  for (const record of records) {
    const count = Number(Boolean(record.frontUrl)) + Number(Boolean(record.backUrl));
    if (count === 2) full += 1;
    else if (count === 1) partial += 1;
    else missing += 1;
  }
  return { total: records.length, full, partial, missing };
}

function versionsByUserId(versions: CccdVersionRecord[]) {
  const grouped = new Map<string, CccdVersionRecord[]>();
  for (const version of versions) {
    const bucket = grouped.get(version.user) || [];
    bucket.push(version);
    grouped.set(version.user, bucket);
  }
  for (const bucket of grouped.values()) {
    bucket.sort((a, b) => {
      const updatedDiff = toTimestamp(b.updated) - toTimestamp(a.updated);
      return updatedDiff || toTimestamp(b.created) - toTimestamp(a.created);
    });
  }
  return grouped;
}

function exportFileUrl(record: object, filename?: string) {
  const url = fileUrl(record, filename);
  if (!url) return "";

  try {
    const parsed = new URL(url);
    if (parsed.pathname.includes("/api/public/pb/api/files/") && !parsed.pathname.endsWith("/")) {
      // Keep dotted filenames behind the app proxy from being handled as static Vite assets.
      parsed.pathname += "/";
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function imageUrlFromVersion(version: CccdVersionRecord | undefined, side: ImageSide) {
  if (!version) return "";
  const filename = side === "front" ? version.front_image : version.back_image;
  return exportFileUrl(version, filename);
}

function resolveImageUrl(
  history: EmploymentHistoryRecord,
  versions: CccdVersionRecord[],
  versionById: Map<string, CccdVersionRecord>,
  side: ImageSide,
) {
  const historyCccd = normalizeCccd(history.worker_cccd_snapshot);
  const directVersion = history.cccd_version ? versionById.get(history.cccd_version) : undefined;
  const expandedVersion = history.expand?.cccd_version;
  const matchingVersions = historyCccd
    ? versions.filter((version) => normalizeCccd(version.cccd_number) === historyCccd)
    : [];

  const candidates = [directVersion, expandedVersion, ...matchingVersions].filter(
    (version): version is CccdVersionRecord => Boolean(version),
  );
  for (const version of candidates) {
    const url = imageUrlFromVersion(version, side);
    if (url) return url;
  }
  return "";
}
export async function prepareCccdHistoryExport(
  histories: EmploymentHistoryRecord[],
  users: UserRecord[],
  factories: FactoryRecord[],
  recordOrder: CccdHistoryPreparation["recordOrder"] = "default",
  signal?: AbortSignal,
): Promise<CccdHistoryPreparation> {
  throwIfAborted(signal);
  const userIds = [...new Set(histories.map((history) => history.worker).filter(Boolean))];
  const versions = await fetchCccdVersionsByUsers(userIds, signal);
  throwIfAborted(signal);
  const groupedVersions = versionsByUserId(versions);
  const versionById = new Map(versions.map((version) => [version.id, version]));
  void users;
  const factoryById = new Map(factories.map((factory) => [factory.id, factory]));

  const records = histories.map((history) => {
    const userVersions = groupedVersions.get(history.worker) || [];
    return {
      historyId: history.id,
      factoryId: history.factory,
      factoryName:
        factoryById.get(history.factory)?.name ||
        history.expand?.factory?.name ||
        "Chưa rõ nhà máy",
      joinDate: safeJoinDate(history.join_date),
      workerName: history.worker_name_snapshot || "thieu-thong-tin",
      cccdNumber: history.worker_cccd_snapshot || "khong-co-cccd",
      frontUrl: resolveImageUrl(history, userVersions, versionById, "front") || undefined,
      backUrl: resolveImageUrl(history, userVersions, versionById, "back") || undefined,
    } satisfies PreparedCccdHistoryRecord;
  });

  if (recordOrder === "default") records.sort(comparePreparedRecords);

  return { records, stats: summarizeRecords(records), recordOrder };
}

function inferImageExtension(blob: Blob) {
  const mime = blob.type.toLowerCase().split(";")[0];
  if (mime === "image/png") return "png";
  if (mime === "image/gif") return "gif";
  if (mime === "image/bmp") return "bmp";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

async function downloadImage(url: string, signal?: AbortSignal): Promise<DownloadedImage> {
  throwIfAborted(signal);
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Không tải được ảnh (${response.status})`);
  const blob = await response.blob();
  if (!blob.size) throw new Error("Ảnh tải về rỗng");
  return { blob, extension: inferImageExtension(blob) };
}

function uniqueZipPath(path: string, usedPaths: Set<string>) {
  if (!usedPaths.has(path)) {
    usedPaths.add(path);
    return path;
  }
  const dot = path.lastIndexOf(".");
  const base = dot >= 0 ? path.slice(0, dot) : path;
  const extension = dot >= 0 ? path.slice(dot) : "";
  let index = 2;
  while (usedPaths.has(`${base}_${index}${extension}`)) index += 1;
  const unique = `${base}_${index}${extension}`;
  usedPaths.add(unique);
  return unique;
}

function progress(
  callback: ((value: CccdHistoryExportProgress) => void) | undefined,
  completed: number,
  total: number,
  message: string,
  signal?: AbortSignal,
) {
  throwIfAborted(signal);
  callback?.({ completed, total, message });
}

function updateActualSides(
  actualSides: Map<string, Set<ImageSide>>,
  historyId: string,
  side: ImageSide,
) {
  const sides = actualSides.get(historyId) || new Set<ImageSide>();
  sides.add(side);
  actualSides.set(historyId, sides);
}

function summarizeActual(
  total: number,
  actualSides: Map<string, Set<ImageSide>>,
  failedImages: number,
): CccdHistoryExportResult {
  let full = 0;
  let partial = 0;
  for (const sides of actualSides.values()) {
    if (sides.size === 2) full += 1;
    else if (sides.size === 1) partial += 1;
  }
  const exported = full + partial;
  return { total, full, partial, missing: total - exported, exported, failedImages };
}

async function exportFolderArchive(
  preparation: CccdHistoryPreparation,
  onProgress?: (value: CccdHistoryExportProgress) => void,
  signal?: AbortSignal,
): Promise<CccdHistoryExportResult> {
  throwIfAborted(signal);
  const zip = new JSZip();
  const usedPaths = new Set<string>();
  const actualSides = new Map<string, Set<ImageSide>>();
  const availableRecords = preparation.records
    .filter((record) => record.frontUrl || record.backUrl)
    .sort(comparePreparedRecords);
  const totalImages = availableRecords.reduce(
    (total, record) => total + Number(Boolean(record.frontUrl)) + Number(Boolean(record.backUrl)),
    0,
  );
  let completed = 0;
  let failedImages = 0;
  const sequenceByGroup = new Map<string, number>();

  for (const record of availableRecords) {
    throwIfAborted(signal);
    const factoryFolder = safePathSegment(record.factoryName, "chua-ro-nha-may");
    const dateFolder = safePathSegment(record.joinDate, "khong-ro-ngay-vao");
    const groupKey = `${record.factoryId}|${record.joinDate}`;
    const sequence = (sequenceByGroup.get(groupKey) || 0) + 1;
    sequenceByGroup.set(groupKey, sequence);
    const prefix = [
      String(sequence).padStart(3, "0"),
      safePathSegment(record.workerName, "nguoi-lao-dong"),
      safePathSegment(record.cccdNumber, "khong-co-cccd"),
    ].join("_");

    for (const [side, url] of [
      ["front", record.frontUrl],
      ["back", record.backUrl],
    ] as const) {
      if (!url) continue;
      throwIfAborted(signal);
      try {
        const image = await downloadImage(url, signal);
        const label = side === "front" ? "mat_truoc" : "mat_sau";
        const path = uniqueZipPath(
          `${factoryFolder}/${dateFolder}/${prefix}_${label}.${image.extension}`,
          usedPaths,
        );
        zip.file(path, image.blob);
        updateActualSides(actualSides, record.historyId, side);
      } catch (error) {
        if (isAbortError(error, signal)) throw error;
        failedImages += 1;
      } finally {
        if (!signal?.aborted) {
          completed += 1;
          progress(
            onProgress,
            completed,
            totalImages,
            `Đang tải ảnh ${completed}/${totalImages}`,
            signal,
          );
        }
      }
    }
  }

  throwIfAborted(signal);
  const result = summarizeActual(preparation.stats.total, actualSides, failedImages);
  if (!result.exported) throw new Error("Không tải được ảnh CCCD nào để xuất");
  progress(onProgress, totalImages, totalImages, "Đang đóng gói ZIP...", signal);
  const content = await zip.generateAsync({ type: "blob", compression: "DEFLATE" }, () =>
    throwIfAborted(signal),
  );
  throwIfAborted(signal);
  saveAs(content, `CCCD_thu_muc_theo_lich_su_${timestampForFilename()}.zip`);
  return result;
}

async function loadDrawable(blob: Blob): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  cleanup: () => void;
}> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      cleanup: () => bitmap.close(),
    };
  }

  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = "async";
  image.src = objectUrl;
  await image.decode();
  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    cleanup: () => URL.revokeObjectURL(objectUrl),
  };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Không chuyển đổi được ảnh"))),
      type,
      quality,
    );
  });
}

async function normalizeWordImage(blob: Blob, signal?: AbortSignal): Promise<WordImage> {
  throwIfAborted(signal);
  const drawable = await loadDrawable(blob);
  try {
    throwIfAborted(signal);
    if (!drawable.width || !drawable.height) throw new Error("Kích thước ảnh không hợp lệ");
    const mime = blob.type.toLowerCase().split(";")[0];
    const supportedType =
      mime === "image/png"
        ? "png"
        : mime === "image/gif"
          ? "gif"
          : mime === "image/bmp"
            ? "bmp"
            : mime === "image/jpeg" || mime === "image/jpg"
              ? "jpg"
              : null;

    let outputBlob = blob;
    let outputType: WordImage["type"] = supportedType || "png";
    if (!supportedType) {
      const canvas = document.createElement("canvas");
      canvas.width = drawable.width;
      canvas.height = drawable.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Trình duyệt không hỗ trợ chuyển đổi ảnh");
      context.drawImage(drawable.source, 0, 0, drawable.width, drawable.height);
      outputBlob = await canvasToBlob(canvas, "image/png");
      outputType = "png";
    }

    throwIfAborted(signal);
    return {
      data: new Uint8Array(await outputBlob.arrayBuffer()),
      type: outputType,
      width: drawable.width,
      height: drawable.height,
    };
  } finally {
    drawable.cleanup();
  }
}

async function exportWordArchive(
  preparation: CccdHistoryPreparation,
  onProgress?: (value: CccdHistoryExportProgress) => void,
  signal?: AbortSignal,
): Promise<CccdHistoryExportResult> {
  throwIfAborted(signal);
  const {
    AlignmentType,
    Document: WordDocument,
    ImageRun,
    Packer,
    PageOrientation,
    Paragraph,
    VerticalAlignSection,
    convertMillimetersToTwip,
  } = await import("docx");

  const zip = new JSZip();
  const usedDocumentNames = new Set<string>();
  const actualSides = new Map<string, Set<ImageSide>>();
  const recordsByFactory = new Map<string, PreparedCccdHistoryRecord[]>();
  for (const record of preparation.records) {
    if (!record.frontUrl && !record.backUrl) continue;
    const bucket = recordsByFactory.get(record.factoryId) || [];
    bucket.push(record);
    recordsByFactory.set(record.factoryId, bucket);
  }

  const totalImages = [...recordsByFactory.values()].reduce(
    (total, records) =>
      total +
      records.reduce(
        (sum, record) => sum + Number(Boolean(record.frontUrl)) + Number(Boolean(record.backUrl)),
        0,
      ),
    0,
  );
  let completed = 0;
  let failedImages = 0;

  for (const records of recordsByFactory.values()) {
    throwIfAborted(signal);
    if (preparation.recordOrder === "default") records.sort(comparePreparedRecords);
    const children: DocxParagraph[] = [];
    let exportedInDocument = 0;

    for (const record of records) {
      const images: WordImage[] = [];
      for (const [side, url] of [
        ["front", record.frontUrl],
        ["back", record.backUrl],
      ] as const) {
        if (!url) continue;
        throwIfAborted(signal);
        try {
          const downloaded = await downloadImage(url, signal);
          const image = await normalizeWordImage(downloaded.blob, signal);
          images.push(image);
          updateActualSides(actualSides, record.historyId, side);
        } catch (error) {
          if (isAbortError(error, signal)) throw error;
          failedImages += 1;
        } finally {
          if (!signal?.aborted) {
            completed += 1;
            progress(
              onProgress,
              completed,
              totalImages,
              `Đang xử lý ảnh ${completed}/${totalImages}`,
              signal,
            );
          }
        }
      }

      throwIfAborted(signal);
      if (!images.length) continue;
      images.forEach((image, imageIndex) => {
        const scale = Math.min(
          WORD_IMAGE_WIDTH_PX / image.width,
          WORD_IMAGE_MAX_HEIGHT_PX / image.height,
        );
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));
        children.push(
          new Paragraph({
            pageBreakBefore: exportedInDocument > 0 && imageIndex === 0,
            alignment: AlignmentType.CENTER,
            spacing: {
              before: 0,
              after: imageIndex === images.length - 1 ? 0 : WORD_IMAGE_GAP_TWIP,
            },
            children: [
              new ImageRun({
                type: image.type,
                data: image.data,
                transformation: { width, height },
              }),
            ],
          }),
        );
      });
      exportedInDocument += 1;
    }

    if (!children.length) continue;
    const document = new WordDocument({
      sections: [
        {
          properties: {
            page: {
              size: {
                width: convertMillimetersToTwip(210),
                height: convertMillimetersToTwip(297),
                orientation: PageOrientation.PORTRAIT,
              },
              margin: {
                top: convertMillimetersToTwip(15),
                right: convertMillimetersToTwip(15),
                bottom: convertMillimetersToTwip(15),
                left: convertMillimetersToTwip(15),
              },
            },
            verticalAlign: VerticalAlignSection.CENTER,
          },
          children,
        },
      ],
    });
    progress(
      onProgress,
      completed,
      totalImages,
      `Đang tạo Word ${records[0].factoryName}...`,
      signal,
    );
    const documentBlob = await Packer.toBlob(document);
    throwIfAborted(signal);
    const safeName = safePathSegment(records[0].factoryName, "chua-ro-nha-may");
    const documentPath = uniqueZipPath(`${safeName}.docx`, usedDocumentNames);
    zip.file(documentPath, documentBlob);
  }

  throwIfAborted(signal);
  const result = summarizeActual(preparation.stats.total, actualSides, failedImages);
  if (!result.exported) throw new Error("Không tạo được file Word từ ảnh CCCD");
  progress(onProgress, totalImages, totalImages, "Đang đóng gói Word vào ZIP...", signal);
  const content = await zip.generateAsync({ type: "blob", compression: "DEFLATE" }, () =>
    throwIfAborted(signal),
  );
  throwIfAborted(signal);
  saveAs(content, `CCCD_Word_theo_lich_su_${timestampForFilename()}.zip`);
  return result;
}

export async function exportCccdHistoryArchive(
  mode: CccdHistoryExportMode,
  preparation: CccdHistoryPreparation,
  onProgress?: (value: CccdHistoryExportProgress) => void,
  signal?: AbortSignal,
) {
  return mode === "word"
    ? exportWordArchive(preparation, onProgress, signal)
    : exportFolderArchive(preparation, onProgress, signal);
}
