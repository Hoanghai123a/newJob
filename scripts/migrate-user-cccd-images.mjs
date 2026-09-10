import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import PocketBase from "pocketbase";

export function normalizeCccd(value) {
  return String(value ?? "").replace(/\D/g, "");
}

export function isValidCccd(value) {
  return [9, 12].includes(normalizeCccd(value).length);
}

export function versionKey(userId, cccdNumber) {
  return `${userId}:${normalizeCccd(cccdNumber)}`;
}

export function resolveHistoryCccd(history, user) {
  const historyNumber = normalizeCccd(history?.worker_cccd_snapshot);
  if (isValidCccd(historyNumber)) return { number: historyNumber, source: "history" };
  const userNumber = normalizeCccd(user?.cccd);
  if (isValidCccd(userNumber)) return { number: userNumber, source: "user" };
  return { number: "", source: "skipped" };
}

async function loadLocalEnv() {
  try {
    const source = await fs.readFile(path.resolve(".env"), "utf8");
    for (const line of source.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator <= 0) continue;
      const key = trimmed.slice(0, separator).trim();
      const rawValue = trimmed.slice(separator + 1).trim();
      if (!(key in process.env)) process.env[key] = rawValue.replace(/^(['"])(.*)\1$/, "$2");
    }
  } catch {
    // Cho phép cấu hình hoàn toàn bằng biến môi trường.
  }
}

function parseMode(argv) {
  const selected = ["--apply", "--finalize"].filter((flag) => argv.includes(flag));
  if (selected.length > 1) throw new Error("Chỉ được chọn một chế độ: --apply hoặc --finalize.");
  return selected[0] || "--audit";
}

function reportTarget(argv) {
  const arg = argv.find((item) => item.startsWith("--report="));
  return arg ? path.resolve(arg.slice("--report=".length)) : "";
}

function fileName(record, field) {
  return String(record?.[field] || "").trim();
}

async function downloadRecordFile(pb, record, filename) {
  const response = await fetch(pb.files.getURL(record, filename));
  if (!response.ok) throw new Error(`Không tải được file ${filename}: HTTP ${response.status}`);
  const blob = await response.blob();
  return new File([blob], filename, { type: blob.type || "application/octet-stream" });
}

async function createVersion(pb, userId, cccdNumber, isCurrent) {
  try {
    return await pb.collection("cccd_versions").create({
      user: userId,
      cccd_number: cccdNumber,
      is_current: isCurrent,
      note: "Tạo bởi migration ảnh CCCD từ users",
    });
  } catch (error) {
    const matches = await pb
      .collection("cccd_versions")
      .getFullList({ filter: `user="${userId}"` });
    const concurrent = matches.find((item) => normalizeCccd(item.cccd_number) === cccdNumber);
    if (concurrent) return concurrent;
    throw error;
  }
}

export function buildAudit(users, histories, versions, hasLegacyFields = true) {
  const usersById = new Map(users.map((user) => [user.id, user]));
  const versionsById = new Map(versions.map((version) => [version.id, version]));
  const versionsByKey = new Map();
  const duplicateVersionKeys = [];
  for (const version of versions) {
    const key = versionKey(version.user, version.cccd_number);
    const bucket = versionsByKey.get(key) || [];
    bucket.push(version);
    versionsByKey.set(key, bucket);
  }
  for (const [key, bucket] of versionsByKey) {
    if (bucket.length > 1)
      duplicateVersionKeys.push({ key, versionIds: bucket.map((item) => item.id) });
  }

  const usersWithLegacyImages = [];
  const usersWithImagesButInvalidCccd = [];
  const legacyImageConflicts = [];
  const legacyImagesNotMigrated = [];
  const skippedLegacyImages = [];
  if (hasLegacyFields) {
    for (const user of users) {
      const front = fileName(user, "cccd_front");
      const back = fileName(user, "cccd_back");
      if (!front && !back) continue;
      usersWithLegacyImages.push({
        id: user.id,
        username: user.username || "",
        cccd: user.cccd || "",
        front: Boolean(front),
        back: Boolean(back),
      });
      const number = normalizeCccd(user.cccd);
      if (!isValidCccd(number)) {
        const skipped = {
          id: user.id,
          username: user.username || "",
          cccd: user.cccd || "",
          front: Boolean(front),
          back: Boolean(back),
          reason: "Không có số CMND/CCCD hợp lệ trên users",
        };
        usersWithImagesButInvalidCccd.push(skipped);
        skippedLegacyImages.push(skipped);
        continue;
      }
      const target = versionsByKey.get(versionKey(user.id, number))?.[0];
      for (const side of ["front", "back"]) {
        const legacy = side === "front" ? front : back;
        if (!legacy) continue;
        const targetFile = fileName(target, side === "front" ? "front_image" : "back_image");
        if (!targetFile) legacyImagesNotMigrated.push({ user: user.id, cccd: number, side });
        else
          legacyImageConflicts.push({
            user: user.id,
            cccd: number,
            side,
            keptVersionFile: targetFile,
          });
      }
    }
  }

  const invalidHistories = [];
  const fallbackHistoryCandidates = [];
  const skippedHistories = [];
  const missingHistoryVersions = [];
  const mismatchedHistoryVersions = [];
  const missingUsers = [];
  for (const history of histories) {
    const user = usersById.get(history.user);
    if (!user) {
      missingUsers.push({ history: history.id, user: history.user });
      continue;
    }
    const originalNumber = normalizeCccd(history.worker_cccd_snapshot);
    const resolved = resolveHistoryCccd(history, user);
    if (!isValidCccd(originalNumber)) {
      const invalid = {
        id: history.id,
        uid: history.uid || "",
        user: history.user,
        cccd: history.worker_cccd_snapshot || "",
      };
      invalidHistories.push(invalid);
      if (resolved.source === "user") {
        fallbackHistoryCandidates.push({
          ...invalid,
          fallbackCccd: resolved.number,
          reason: "Dùng users.cccd vì số CCCD trên history không hợp lệ",
        });
      } else {
        skippedHistories.push({
          ...invalid,
          reason: "History và users đều không có số CMND/CCCD hợp lệ",
        });
        continue;
      }
    }
    const number = resolved.number;
    const linked = history.cccd_version ? versionsById.get(history.cccd_version) : null;
    if (!linked) {
      missingHistoryVersions.push({
        id: history.id,
        uid: history.uid || "",
        user: history.user,
        cccd: number,
        source: resolved.source,
      });
      continue;
    }
    if (linked.user !== history.user || normalizeCccd(linked.cccd_number) !== number) {
      mismatchedHistoryVersions.push({
        id: history.id,
        uid: history.uid || "",
        user: history.user,
        cccd: number,
        source: resolved.source,
        linkedVersion: linked.id,
        linkedUser: linked.user,
        linkedCccd: linked.cccd_number,
      });
    }
  }

  const blockers =
    duplicateVersionKeys.length +
    missingUsers.length +
    missingHistoryVersions.length +
    mismatchedHistoryVersions.length +
    legacyImagesNotMigrated.length;
  return {
    totals: { users: users.length, histories: histories.length, versions: versions.length },
    blockers,
    usersWithLegacyImages,
    usersWithImagesButInvalidCccd,
    invalidHistories,
    fallbackHistoryCandidates,
    skippedHistories,
    skippedLegacyImages,
    missingUsers,
    missingHistoryVersions,
    mismatchedHistoryVersions,
    duplicateVersionKeys,
    legacyImagesNotMigrated,
    legacyImageConflicts,
  };
}

async function readState(pb) {
  const usersCollection = await pb.collections.getOne("users");
  const historyCollection = await pb.collections.getOne("employment_histories");
  const userFields = new Set((usersCollection.fields || []).map((field) => field.name));
  const hasLegacyFields = userFields.has("cccd_front") || userFields.has("cccd_back");
  const userFieldList = ["id", "username", "cccd"];
  if (userFields.has("cccd_front")) userFieldList.push("cccd_front");
  if (userFields.has("cccd_back")) userFieldList.push("cccd_back");
  const [rawUsers, histories, versions] = await Promise.all([
    pb.collection("users").getFullList({ sort: "created", fields: userFieldList.join(",") }),
    pb
      .collection("employment_histories")
      .getFullList({ sort: "created", fields: "id,uid,user,worker_cccd_snapshot,cccd_version" }),
    pb.collection("cccd_versions").getFullList({ sort: "created" }),
  ]);
  const users = rawUsers.map((user) => ({
    ...user,
    collectionId: user.collectionId || usersCollection.id,
    collectionName: user.collectionName || usersCollection.name,
  }));
  return { usersCollection, historyCollection, hasLegacyFields, users, histories, versions };
}

async function applyMigration(pb, initial) {
  const stats = {
    createdVersions: 0,
    linkedHistories: 0,
    uploadedImages: 0,
    preservedVersionImages: 0,
    historiesUsingUserCccd: 0,
    skippedHistories: [],
    skippedLegacyImages: [],
    failed: [],
  };
  const versionsByKey = new Map();
  for (const version of initial.versions) {
    const key = versionKey(version.user, version.cccd_number);
    if (!versionsByKey.has(key)) versionsByKey.set(key, version);
  }
  const usersById = new Map(initial.users.map((user) => [user.id, user]));

  async function ensureVersion(userId, number) {
    const key = versionKey(userId, number);
    let version = versionsByKey.get(key);
    if (version) return version;
    const user = usersById.get(userId);
    version = await createVersion(pb, userId, number, normalizeCccd(user?.cccd) === number);
    versionsByKey.set(key, version);
    stats.createdVersions += 1;
    return version;
  }

  for (const user of initial.users) {
    const front = fileName(user, "cccd_front");
    const back = fileName(user, "cccd_back");
    if (!front && !back) continue;
    const number = normalizeCccd(user.cccd);
    if (!isValidCccd(number)) {
      stats.skippedLegacyImages.push({
        id: user.id,
        username: user.username || "",
        reason: "Không có số CMND/CCCD hợp lệ trên users; chấp nhận xóa ảnh cũ",
      });
      continue;
    }
    try {
      let version = await ensureVersion(user.id, number);
      const form = new FormData();
      for (const [legacyField, versionField] of [
        ["cccd_front", "front_image"],
        ["cccd_back", "back_image"],
      ]) {
        const legacy = fileName(user, legacyField);
        if (!legacy) continue;
        if (fileName(version, versionField)) {
          stats.preservedVersionImages += 1;
          continue;
        }
        form.append(versionField, await downloadRecordFile(pb, user, legacy));
        stats.uploadedImages += 1;
      }
      if ([...form.keys()].length) {
        version = await pb.collection("cccd_versions").update(version.id, form);
        versionsByKey.set(versionKey(user.id, number), version);
      }
    } catch (error) {
      stats.failed.push({
        type: "user_image",
        id: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const history of initial.histories) {
    const user = usersById.get(history.user);
    if (!user) continue;
    const resolved = resolveHistoryCccd(history, user);
    if (!resolved.number) {
      stats.skippedHistories.push({
        id: history.id,
        uid: history.uid || "",
        user: history.user,
        reason: "History và users đều không có số CMND/CCCD hợp lệ",
      });
      continue;
    }
    const originalNumber = normalizeCccd(history.worker_cccd_snapshot);
    if (resolved.source === "user") stats.historiesUsingUserCccd += 1;
    try {
      const version = await ensureVersion(history.user, resolved.number);
      if (history.cccd_version !== version.id || originalNumber !== resolved.number) {
        await pb.collection("employment_histories").update(history.id, {
          worker_cccd_snapshot: resolved.number,
          cccd_version: version.id,
        });
        stats.linkedHistories += 1;
      }
    } catch (error) {
      stats.failed.push({
        type: "history",
        id: history.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return stats;
}

async function finalizeSchema(pb, state, audit) {
  if (audit.blockers) {
    throw new Error(
      `Không thể finalize: còn ${audit.blockers} lỗi dữ liệu có thể khắc phục. Hãy xem báo cáo audit.`,
    );
  }
  const keepRelationOptional = audit.skippedHistories.length > 0;
  const historyFields = (state.historyCollection.fields || []).map((field) =>
    field.name === "cccd_version"
      ? {
          ...field,
          required: !keepRelationOptional,
          minSelect: keepRelationOptional ? 0 : 1,
        }
      : field,
  );
  if (!historyFields.some((field) => field.name === "cccd_version")) {
    throw new Error("Collection employment_histories chưa có field cccd_version.");
  }
  await pb.collections.update(state.historyCollection.id, { fields: historyFields });
  const userFields = (state.usersCollection.fields || []).filter(
    (field) => field.name !== "cccd_front" && field.name !== "cccd_back",
  );
  await pb.collections.update(state.usersCollection.id, { fields: userFields });
  return {
    historyCccdVersionRequired: !keepRelationOptional,
    skippedHistoryCount: audit.skippedHistories.length,
    removedUserFields: ["cccd_front", "cccd_back"],
  };
}

export async function main(argv = process.argv.slice(2)) {
  await loadLocalEnv();
  const mode = parseMode(argv);
  const reportPath = reportTarget(argv);
  const baseUrl =
    process.env.PB_URL ||
    process.env.VITE_PB_URL ||
    process.env.POCKETBASE_URL ||
    "http://127.0.0.1:8290";
  const email = process.env.PB_ADMIN_EMAIL;
  const password = process.env.PB_ADMIN_PASSWORD;
  if (!email || !password)
    throw new Error("Thiếu PB_ADMIN_EMAIL hoặc PB_ADMIN_PASSWORD trong môi trường/.env.");

  const pb = new PocketBase(baseUrl);
  pb.autoCancellation(false);
  await pb.collection("_superusers").authWithPassword(email, password);
  try {
    let state = await readState(pb);
    const before = buildAudit(state.users, state.histories, state.versions, state.hasLegacyFields);
    let migration = null;
    let finalize = null;
    if (mode === "--apply") {
      migration = await applyMigration(pb, state);
      state = await readState(pb);
    } else if (mode === "--finalize") {
      migration = await applyMigration(pb, state);
      state = await readState(pb);
      const readyForFinalize = buildAudit(
        state.users,
        state.histories,
        state.versions,
        state.hasLegacyFields,
      );
      finalize = await finalizeSchema(pb, state, readyForFinalize);
      state = await readState(pb);
    }
    const after = buildAudit(state.users, state.histories, state.versions, state.hasLegacyFields);
    const report = {
      mode,
      generatedAt: new Date().toISOString(),
      before,
      migration,
      finalize,
      after,
    };
    const json = JSON.stringify(report, null, 2);
    if (reportPath) await fs.writeFile(reportPath, `${json}\n`, "utf8");
    console.log(json);
    if (migration?.failed?.length || after.blockers) process.exitCode = 1;
    return report;
  } finally {
    pb.authStore.clear();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
