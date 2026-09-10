import fs from "node:fs/promises";
import path from "node:path";
import PocketBase from "pocketbase";

async function main() {
  const APPLY = process.argv.includes("--apply");
  const reportArg = process.argv.find((arg) => arg.startsWith("--report="));
  const reportPath = reportArg ? path.resolve(reportArg.slice("--report=".length)) : "";

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
        if (!(key in process.env)) {
          process.env[key] = rawValue.replace(/^(['"])(.*)\1$/, "$2");
        }
      }
    } catch {
      // Cho phép truyền toàn bộ cấu hình bằng biến môi trường khi không có file .env.
    }
  }

  function text(value) {
    return String(value ?? "").trim();
  }

  function dateOnly(value) {
    const valueText = text(value);
    if (!valueText) return "";
    const match = valueText.match(/^(\d{4}-\d{2}-\d{2})/);
    return match?.[1] || "";
  }

  await loadLocalEnv();

  const pocketBaseUrl =
    process.env.VITE_PB_URL || process.env.POCKETBASE_URL || "http://127.0.0.1:8290";
  const adminEmail = process.env.PB_ADMIN_EMAIL;
  const adminPassword = process.env.PB_ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    throw new Error("Thiếu PB_ADMIN_EMAIL hoặc PB_ADMIN_PASSWORD trong môi trường/.env.");
  }

  const pb = new PocketBase(pocketBaseUrl);
  pb.autoCancellation(false);
  await pb.collection("_superusers").authWithPassword(adminEmail, adminPassword);

  const collections = await pb.collections.getFullList();
  const historyCollection = collections.find(
    (collection) => collection.name === "employment_histories",
  );
  if (!historyCollection) throw new Error("Không tìm thấy collection employment_histories.");

  const requiredSchemaFields = [
    "worker_date_of_birth_snapshot",
    "worker_address_snapshot",
    "cccd_issue_date",
  ];
  const schemaFieldNames = new Set(historyCollection.fields.map((field) => field.name));
  const hasHometownSnapshot = schemaFieldNames.has("hometown_snapshot");
  const missingSchemaFields = requiredSchemaFields.filter((field) => !schemaFieldNames.has(field));
  if (missingSchemaFields.length) {
    throw new Error(
      `PocketBase chưa có field: ${missingSchemaFields.join(", ")}. Hãy cập nhật schema trước khi backfill.`,
    );
  }

  const [histories, users] = await Promise.all([
    pb.collection("employment_histories").getFullList({ sort: "created" }),
    pb.collection("users").getFullList({ sort: "created" }),
  ]);
  const usersById = new Map(users.map((user) => [user.id, user]));
  const changes = [];
  const review = [];

  for (const history of histories) {
    const user = usersById.get(history.user);
    const current = {
      worker_name_snapshot: text(history.worker_name_snapshot),
      worker_cccd_snapshot: text(history.worker_cccd_snapshot),
      worker_date_of_birth_snapshot: dateOnly(history.worker_date_of_birth_snapshot),
      worker_address_snapshot:
        text(history.worker_address_snapshot) || text(history.hometown_snapshot),
      cccd_issue_date: dateOnly(history.cccd_issue_date),
    };
    const next = {
      worker_name_snapshot:
        current.worker_name_snapshot || text(user?.full_name) || text(user?.username),
      worker_cccd_snapshot: current.worker_cccd_snapshot || text(user?.cccd),
      worker_date_of_birth_snapshot:
        current.worker_date_of_birth_snapshot || dateOnly(user?.date_of_birth),
      worker_address_snapshot: current.worker_address_snapshot || text(user?.address),
      cccd_issue_date: current.cccd_issue_date || dateOnly(user?.cccd_issue_date),
    };
    const payload = {};

    for (const [field, value] of Object.entries(next)) {
      if (!current[field] && value) payload[field] = value;
    }
    if (hasHometownSnapshot && !text(history.hometown_snapshot) && next.worker_address_snapshot) {
      payload.hometown_snapshot = next.worker_address_snapshot;
    }

    const missing = Object.entries(next)
      .filter(([, value]) => !value)
      .map(([field]) => field);
    if (missing.length) {
      review.push({
        id: history.id,
        uid: history.uid || "",
        user: history.user,
        missing,
      });
    }
    if (Object.keys(payload).length) {
      changes.push({ id: history.id, uid: history.uid || "", payload });
    }
  }

  if (APPLY) {
    for (const change of changes) {
      await pb.collection("employment_histories").update(change.id, change.payload);
    }
  }

  const report = {
    mode: APPLY ? "apply" : "dry-run",
    pocketBaseUrl,
    totalHistories: histories.length,
    recordsToUpdate: changes.length,
    recordsNeedingReview: review.length,
    changes,
    review,
  };

  if (reportPath) {
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  console.log(
    JSON.stringify(
      {
        mode: report.mode,
        totalHistories: report.totalHistories,
        recordsToUpdate: report.recordsToUpdate,
        recordsNeedingReview: report.recordsNeedingReview,
        reportPath: reportPath || null,
      },
      null,
      2,
    ),
  );

  if (review.length) {
    console.log("Các bản ghi vẫn thiếu dữ liệu (tối đa 20):");
    console.log(JSON.stringify(review.slice(0, 20), null, 2));
  }
}

main().catch((error) => {
  const responseMessage = error?.response?.message;
  const message = responseMessage || (error instanceof Error ? error.message : String(error));
  console.error(`Backfill thất bại: ${message}`);
  process.exitCode = 1;
});
