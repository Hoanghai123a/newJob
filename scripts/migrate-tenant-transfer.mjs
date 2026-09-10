import fs from "node:fs";
import PocketBase from "pocketbase";

const apply = process.argv.includes("--apply");
const env = Object.fromEntries(
  fs
    .readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i), line.slice(i + 1).replace(/^['\"]|['\"]$/g, "")];
    }),
);
const url = process.env.PB_URL || env.PB_URL || process.env.VITE_PB_URL || env.VITE_PB_URL;
const email = process.env.PB_ADMIN_EMAIL || env.PB_ADMIN_EMAIL;
const password = process.env.PB_ADMIN_PASSWORD || env.PB_ADMIN_PASSWORD;
if (!url || !email || !password)
  throw new Error("Thiếu PB_URL, PB_ADMIN_EMAIL hoặc PB_ADMIN_PASSWORD.");

const pb = new PocketBase(url);
pb.autoCancellation(false);
await pb
  .collection("_superusers")
  .authWithPassword(email, password)
  .catch(() => pb.admins.authWithPassword(email, password));

async function ensureSystemLogCollection(name) {
  let col = await pb.collections.getOne(name).catch(() => null);
  if (!col) {
    if (!apply) return { name, status: "cần tạo collection hệ thống" };
    col = await pb.collections.create({
      name,
      type: "base",
      listRule: '@request.auth.role = "super_admin"',
      viewRule: '@request.auth.role = "super_admin"',
      createRule: '@request.auth.role = "super_admin"',
      updateRule: '@request.auth.role = "super_admin"',
      deleteRule: null,
      fields: [
        { name: "company_id_snapshot", type: "text", max: 64 },
        { name: "company_code_snapshot", type: "text", max: 64 },
        { name: "company_name_snapshot", type: "text", max: 200 },
        { name: "actor_super_admin", type: "text", max: 64 },
        { name: "started_at", type: "text", max: 64 },
        { name: "completed_at", type: "text", max: 64 },
        { name: "status", type: "select", values: ["running", "completed", "failed"] },
        { name: "preview_counts", type: "json" },
        { name: "deleted_counts", type: "json" },
        { name: "backup_checksum", type: "text", max: 128 },
        { name: "error_summary", type: "text", max: 1000 },
      ],
    });
    return { name, status: "đã tạo thành công" };
  }
  return { name, status: "đã sẵn sàng" };
}

const purgeLog = await ensureSystemLogCollection("tenant_purge_logs");
const restoreLog = await ensureSystemLogCollection("tenant_restore_logs");
console.log(JSON.stringify({ purgeLog, restoreLog }, null, 2));
