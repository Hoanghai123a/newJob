import fs from "node:fs";
import PocketBase from "pocketbase";

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

const fileEnv = readEnvFile(".env");
const baseUrl =
  process.env.PB_URL ||
  process.env.VITE_PB_URL ||
  fileEnv.PB_URL ||
  fileEnv.VITE_PB_URL ||
  "http://127.0.0.1:8290";
const email = process.env.PB_ADMIN_EMAIL || fileEnv.PB_ADMIN_EMAIL;
const password = process.env.PB_ADMIN_PASSWORD || fileEnv.PB_ADMIN_PASSWORD;
const apply = process.argv.includes("--apply");

if (!email || !password) {
  throw new Error("Thiếu PB_ADMIN_EMAIL hoặc PB_ADMIN_PASSWORD.");
}

const pb = new PocketBase(baseUrl);
pb.autoCancellation(false);

try {
  await pb.collection("_superusers").authWithPassword(email, password);
  const collection = await pb.collections.getOne("employment_histories");
  const targetNames = new Set(["worker_name_snapshot", "worker_cccd_snapshot"]);
  const fields = (collection.fields || []).map((field) =>
    targetNames.has(field.name) ? { ...field, required: false } : field,
  );
  const changed = fields
    .filter((field) => targetNames.has(field.name))
    .filter((field) => (collection.fields || []).find((item) => item.name === field.name)?.required)
    .map((field) => field.name);

  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "audit",
        collection: collection.name,
        fields: changed,
        changedCount: changed.length,
      },
      null,
      2,
    ),
  );

  if (apply && changed.length) {
    await pb.collections.update(collection.id, { fields });
    console.log("PocketBase: đã đổi các field snapshot thành không bắt buộc.");
  }
} finally {
  pb.authStore.clear();
}
