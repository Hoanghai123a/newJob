import fs from "node:fs";
import PocketBase from "pocketbase";

const APPLY = process.argv.includes("--apply");
const DESIRED_USER_INDEX = "CREATE INDEX `idx_emphist_user` ON `employment_histories` (`user`)";
const DESIRED_ACTIVE_INDEX =
  "CREATE UNIQUE INDEX `idx_emphist_one_active` ON `employment_histories` (`user`) WHERE `status` = 'working'";

function readEnvFile(path) {
  if (!fs.existsSync(path)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        const key = line.slice(0, separator).trim();
        const value = line
          .slice(separator + 1)
          .trim()
          .replace(/^["']|["']$/g, "");
        return [key, value];
      }),
  );
}

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

function dateOnly(value) {
  const match = String(value || "").match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || "";
}

function indexName(index) {
  return index.match(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+[`"]?([^`"\s]+)[`"]?/i)?.[1] || "";
}

function isUniqueUserOnlyIndex(index) {
  return (
    /CREATE\s+UNIQUE\s+INDEX/i.test(index) &&
    /ON\s+[`"]?employment_histories[`"]?\s*\(\s*[`"]?user[`"]?\s*\)/i.test(index)
  );
}

function buildCorrectedIndexes(indexes) {
  const hasExactUserIndex = indexes.includes(DESIRED_USER_INDEX);
  const hasExactActiveIndex = indexes.includes(DESIRED_ACTIVE_INDEX);
  const hasWrongUserUniqueIndex = indexes.some(
    (index) => isUniqueUserOnlyIndex(index) && index !== DESIRED_ACTIVE_INDEX,
  );
  const hasMalformedNamedIndex = indexes.some((index) => {
    const name = indexName(index);
    return (
      (name === "idx_emphist_user" && index !== DESIRED_USER_INDEX) ||
      (name === "idx_emphist_one_active" && index !== DESIRED_ACTIVE_INDEX)
    );
  });

  if (
    hasExactUserIndex &&
    hasExactActiveIndex &&
    !hasWrongUserUniqueIndex &&
    !hasMalformedNamedIndex
  ) {
    return indexes;
  }

  const corrected = indexes.filter((index) => {
    const name = indexName(index);
    if (name === "idx_emphist_user" || name === "idx_emphist_one_active") return false;
    return !isUniqueUserOnlyIndex(index);
  });
  corrected.push(DESIRED_USER_INDEX, DESIRED_ACTIVE_INDEX);
  return corrected;
}

async function main() {
  const fileEnv = readEnvFile(".env");
  const baseUrl =
    process.env.PB_URL ||
    process.env.VITE_PB_URL ||
    fileEnv.PB_URL ||
    fileEnv.VITE_PB_URL ||
    "http://127.0.0.1:8290";
  const email = process.env.PB_ADMIN_EMAIL || fileEnv.PB_ADMIN_EMAIL;
  const password = process.env.PB_ADMIN_PASSWORD || fileEnv.PB_ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error("Thiếu PB_ADMIN_EMAIL hoặc PB_ADMIN_PASSWORD.");
  }

  const pb = new PocketBase(baseUrl);
  pb.autoCancellation(false);

  try {
    await pb.collection("_superusers").authWithPassword(email, password);

    const collection = await pb.collections.getOne("employment_histories");
    const userField = (collection.fields || []).find((field) => field.name === "user");
    if (!userField || userField.type !== "relation" || userField.maxSelect !== 1) {
      throw new Error(
        "Field employment_histories.user không phải relation một giá trị. Dừng để tránh sửa sai schema.",
      );
    }

    const histories = await pb.collection("employment_histories").getFullList({
      fields: "id,user,status,join_date,leave_date",
      sort: "user,join_date,created",
    });
    const referenceDate = todayIso();
    const staleWorking = histories.filter((history) => {
      const leaveDate = dateOnly(history.leave_date);
      return history.status === "working" && Boolean(leaveDate) && leaveDate <= referenceDate;
    });
    const activeWorking = histories.filter((history) => {
      if (history.status !== "working") return false;
      const leaveDate = dateOnly(history.leave_date);
      return !leaveDate || leaveDate > referenceDate;
    });

    const activeCounts = new Map();
    for (const history of activeWorking) {
      activeCounts.set(history.user, (activeCounts.get(history.user) || 0) + 1);
    }
    const conflictingUsers = [...activeCounts.values()].filter((count) => count > 1).length;

    const currentIndexes = Array.isArray(collection.indexes) ? collection.indexes : [];
    const correctedIndexes = buildCorrectedIndexes(currentIndexes);
    const indexesNeedUpdate = JSON.stringify(currentIndexes) !== JSON.stringify(correctedIndexes);

    console.log(`PocketBase: ngày đối chiếu ${referenceDate}.`);
    console.log(`PocketBase: tổng số lịch sử ${histories.length}.`);
    console.log(
      `PocketBase: ${staleWorking.length} bản ghi working đã đến ngày nghỉ cần chuyển sang left.`,
    );
    console.log(`PocketBase: ${conflictingUsers} người có nhiều hơn một bản ghi đang làm thực sự.`);
    console.log(
      indexesNeedUpdate
        ? "PocketBase: index employment_histories.user cần được chuẩn hóa."
        : "PocketBase: index employment_histories.user đã đúng cấu hình.",
    );

    if (conflictingUsers > 0) {
      throw new Error(
        "Phát hiện nhiều bản ghi đang làm thực sự cho cùng một người. Không tự động áp dụng; cần kiểm tra thủ công trước.",
      );
    }

    if (!APPLY) {
      console.log("PocketBase: dry-run hoàn tất, chưa thay đổi dữ liệu. Dùng --apply để áp dụng.");
      return;
    }

    for (const history of staleWorking) {
      await pb.collection("employment_histories").update(history.id, { status: "left" });
    }

    if (indexesNeedUpdate) {
      await pb.collections.update(collection.id, { indexes: correctedIndexes });
    }

    console.log(
      `PocketBase: đã chuyển ${staleWorking.length} bản ghi sang left và ${
        indexesNeedUpdate ? "đã chuẩn hóa" : "không cần thay đổi"
      } index.`,
    );
  } finally {
    pb.authStore.clear();
  }
}

main().catch((error) => {
  console.error(`PocketBase: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
