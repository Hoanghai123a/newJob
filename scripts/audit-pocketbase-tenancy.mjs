#!/usr/bin/env node
import fs from "node:fs";
import PocketBase from "pocketbase";

const strict = process.argv.includes("--strict");
const env = Object.fromEntries(
  fs
    .readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .map((line) => {
      const i = line.indexOf("=");
      return i > 0
        ? [line.slice(0, i).trim(), line.slice(i + 1).replace(/^['\"]|['\"]$/g, "")]
        : null;
    })
    .filter(Boolean),
);
const url = process.env.PB_URL || env.PB_URL || process.env.VITE_PB_URL || env.VITE_PB_URL;
const email = process.env.PB_ADMIN_EMAIL || env.PB_ADMIN_EMAIL;
const password = process.env.PB_ADMIN_PASSWORD || env.PB_ADMIN_PASSWORD;
if (!url || !email || !password) throw new Error("Thiếu cấu hình PocketBase admin.");

const pb = new PocketBase(url);
pb.autoCancellation(false);
await pb
  .collection("_superusers")
  .authWithPassword(email, password)
  .catch(() => pb.admins.authWithPassword(email, password));

const collections = await pb.collections.getFullList();
const companiesCollection = collections.find((collection) => collection.name === "companies");
const companies = await pb.collection("companies").getFullList({ fields: "id,code,name,status" });
const companyIds = new Set(companies.map((company) => company.id));
const issues = [];
const checked = [];
for (const collection of collections) {
  if (
    collection.system ||
    collection.name.startsWith("_") ||
    ["companies", "uid_counters"].includes(collection.name)
  )
    continue;
  const tenant = (collection.fields || []).find((field) => field.name === "tenant_company");
  if (!tenant) continue;
  if (tenant.type !== "relation" || tenant.collectionId !== companiesCollection?.id) {
    issues.push({
      collection: collection.name,
      issue: "tenant_company không phải relation tới companies",
    });
    continue;
  }
  const rows = await pb.collection(collection.name).getFullList({ fields: "id,tenant_company" });
  const missing = rows.filter((row) => !row.tenant_company).length;
  const invalid = rows.filter(
    (row) => row.tenant_company && !companyIds.has(row.tenant_company),
  ).length;
  if (missing)
    issues.push({
      collection: collection.name,
      issue: "record thiếu tenant_company",
      count: missing,
    });
  if (invalid)
    issues.push({
      collection: collection.name,
      issue: "tenant_company không tồn tại",
      count: invalid,
    });
  const rules = [
    collection.listRule,
    collection.viewRule,
    collection.createRule,
    collection.updateRule,
    collection.deleteRule,
  ]
    .filter(Boolean)
    .join(" ");
  if (!rules.includes("tenant_company") && collection.name !== "users")
    issues.push({ collection: collection.name, issue: "rules không tham chiếu tenant_company" });
  checked.push({ collection: collection.name, records: rows.length, missing, invalid });
}
const report = { status: issues.length ? "failed" : "passed", strict, companies, checked, issues };
console.log(JSON.stringify(report, null, 2));
pb.authStore.clear();
if (strict && issues.length) process.exit(1);
