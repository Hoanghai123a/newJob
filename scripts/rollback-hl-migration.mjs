#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import PocketBase from "pocketbase";

const APPLY = process.argv.includes("--apply");
const runId =
  process.env.MIGRATION_RUN_ID || process.argv.find((arg) => arg.startsWith("--run-id="))?.slice(9);
if (!runId) throw new Error("Thiếu MIGRATION_RUN_ID hoặc --run-id=<id>.");
const root = process.env.NEWAPP_ROOT || process.cwd();
const envText = await fs.readFile(path.join(root, ".env"), "utf8").catch(() => "");
const env = Object.fromEntries(
  envText
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

const collections = (await pb.collections.getFullList())
  .filter(
    (collection) =>
      !collection.system &&
      !collection.name.startsWith("_") &&
      collection.name !== "companies" &&
      (collection.fields || []).some((field) => field.name === "migration_run_id"),
  )
  .map((collection) => collection.name);
const deletionOrder = collections.toSorted((a, b) => {
  const rank = (name) => (name === "users" ? 2 : name === "workers" ? 1 : 0);
  return rank(a) - rank(b);
});
const report = { migration_run_id: runId, apply: APPLY, deleted: {}, skipped: [] };
if (APPLY) {
  let pending = new Map();
  for (const name of deletionOrder) {
    const collection = await pb.collections.getOne(name).catch(() => null);
    if (!collection) {
      report.skipped.push(name);
      continue;
    }
    const rows = await pb
      .collection(name)
      .getFullList({ filter: `migration_run_id="${runId}"`, fields: "id" })
      .catch(() => []);
    pending.set(
      name,
      rows.map((row) => row.id),
    );
    report.deleted[name] = 0;
  }
  for (let pass = 0; pending.size && pass < deletionOrder.length + 2; pass++) {
    let progress = 0;
    for (const name of deletionOrder) {
      const ids = pending.get(name) || [];
      const remaining = [];
      for (const id of ids) {
        try {
          await pb.collection(name).delete(id);
          report.deleted[name]++;
          progress++;
        } catch {
          remaining.push(id);
        }
      }
      if (remaining.length) pending.set(name, remaining);
      else pending.delete(name);
    }
    if (!progress) break;
  }
  for (const [name, ids] of pending) {
    report.skipped.push(`${name}:${ids.join(",")}`);
  }
  const companies = await pb
    .collection("companies")
    .getFullList({ filter: `code="HL" && migration_run_id="${runId}"`, fields: "id" })
    .catch(() => []);
  for (const company of companies) await pb.collection("companies").delete(company.id);
  report.deleted.companies = companies.length;
}
const output = path.join(root, "docs", "migration-audit", `hl-rollback-${runId}.json`);
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify(report, null, 2));
if (!APPLY) console.log("Dry-run rollback: chưa xóa dữ liệu. Thêm --apply sau khi rà soát report.");
