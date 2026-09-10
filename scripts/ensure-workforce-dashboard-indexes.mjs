import fs from "node:fs";
import PocketBase from "pocketbase";

const APPLY = process.argv.includes("--apply");
const INDEXES = {
  employment_histories: [
    "CREATE INDEX `idx_emphist_user` ON `employment_histories` (`user`)",
    "CREATE INDEX `idx_emphist_join_date` ON `employment_histories` (`join_date`)",
    "CREATE INDEX `idx_emphist_leave_date` ON `employment_histories` (`leave_date`)",
    "CREATE INDEX `idx_emphist_updated` ON `employment_histories` (`updated`)",
    "CREATE INDEX `idx_emphist_factory` ON `employment_histories` (`factory`)",
    "CREATE INDEX `idx_emphist_recruiter_staff` ON `employment_histories` (`recruiter_staff`)",
    "CREATE INDEX `idx_emphist_recruiter_partner` ON `employment_histories` (`recruiter_partner`)",
    "CREATE INDEX `idx_emphist_user_join_leave` ON `employment_histories` (`user`, `join_date`, `leave_date`)",
    "CREATE INDEX `idx_emphist_recruiter_user` ON `employment_histories` (`recruiter_staff`, `user`)",
  ],
  check_attendance_items: [
    "CREATE INDEX `idx_check_attendance_month_user_round` ON `check_attendance_items` (`month`, `user`, `round_no`)",
  ],
  check_salary_items: [
    "CREATE INDEX `idx_check_salary_month_user_round` ON `check_salary_items` (`month`, `user`, `round_no`)",
  ],
  factory_managers: ["CREATE INDEX `idx_factory_managers_staff` ON `factory_managers` (`staff`)"],
};

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
        return [
          line.slice(0, separator).trim(),
          line
            .slice(separator + 1)
            .trim()
            .replace(/^["']|["']$/g, ""),
        ];
      }),
  );
}
function indexName(sql) {
  return sql.match(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+[`"]?([^`"\s]+)[`"]?/i)?.[1] || "";
}
function indexSignature(sql) {
  const match = sql.match(/ON\s+[`"]?([^`"\s]+)[`"]?\s*\(([^)]+)\)/i);
  if (!match) return "";
  const fields = match[2]
    .split(",")
    .map((field) => field.replace(/[`"\s]/g, "").toLowerCase())
    .join(",");
  return `${match[1].toLowerCase()}:${fields}`;
}

async function main() {
  const fileEnv = readEnvFile(".env");
  const url =
    process.env.PB_URL ||
    process.env.VITE_PB_URL ||
    fileEnv.PB_URL ||
    fileEnv.VITE_PB_URL ||
    "http://127.0.0.1:8290";
  const email = process.env.PB_ADMIN_EMAIL || fileEnv.PB_ADMIN_EMAIL;
  const password = process.env.PB_ADMIN_PASSWORD || fileEnv.PB_ADMIN_PASSWORD;
  if (!email || !password) throw new Error("Thiếu PB_ADMIN_EMAIL hoặc PB_ADMIN_PASSWORD.");
  const pb = new PocketBase(url);
  pb.autoCancellation(false);
  try {
    await pb.collection("_superusers").authWithPassword(email, password);
    for (const [collectionName, desired] of Object.entries(INDEXES)) {
      const collection = await pb.collections.getOne(collectionName);
      const existing = collection.indexes || [];
      const existingSignatures = new Set(existing.map(indexSignature));
      const missing = desired.filter((sql) => !existingSignatures.has(indexSignature(sql)));
      if (!missing.length) {
        console.log(`${collectionName}: đã đủ index dashboard nhân lực.`);
        continue;
      }
      console.log(`${collectionName}: thiếu ${missing.map(indexName).join(", ")}.`);
      if (APPLY) {
        await pb.collections.update(collection.id, { indexes: [...existing, ...missing] });
        console.log(`${collectionName}: đã bổ sung index.`);
      }
    }
    if (!APPLY) console.log("Chỉ kiểm tra. Chạy lại với --apply để bổ sung index còn thiếu.");
  } finally {
    pb.authStore.clear();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
