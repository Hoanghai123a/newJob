#!/usr/bin/env node
import fs from "node:fs";
import PocketBase from "pocketbase";

const APPLY = process.argv.includes("--apply");
const env = Object.fromEntries(
  fs
    .readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .map((line) => {
      const i = line.indexOf("=");
      return i > 0 ? [line.slice(0, i), line.slice(i + 1).replace(/^['\"]|['\"]$/g, "")] : null;
    })
    .filter(Boolean),
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
const excluded = new Set(["_superusers", "_otps", "_mfas", "_authOrigins", "_externalAuths"]);
const changes = [];
for (const collection of await pb.collections.getFullList()) {
  if (collection.system || excluded.has(collection.name) || collection.name.startsWith("_"))
    continue;
  if ((collection.fields || []).some((field) => field.name === "migration_run_id")) continue;
  changes.push({ collection: collection.name, field: "migration_run_id" });
  if (APPLY) {
    await pb.collections.update(collection.id, {
      fields: [
        ...(collection.fields || []),
        { name: "migration_run_id", type: "text", required: false, max: 100 },
      ],
    });
  }
}
console.log(JSON.stringify({ apply: APPLY, changes }, null, 2));
if (!APPLY)
  console.log("Dry-run schema: chưa ghi PocketBase. Chạy lại với --apply trong migration:apply.");
