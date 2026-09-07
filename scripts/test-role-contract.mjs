#!/usr/bin/env node
import fs from "node:fs";
import PocketBase from "pocketbase";

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
if (!url || !email || !password) {
  console.log(
    JSON.stringify(
      {
        status: "skipped",
        reason: "Thiếu credential PocketBase; sẽ kiểm tra live khi migration:test/apply.",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
const pb = new PocketBase(url);
pb.autoCancellation(false);
await pb
  .collection("_superusers")
  .authWithPassword(email, password)
  .catch(() => pb.admins.authWithPassword(email, password));
const users = await pb.collections.getOne("users");
const role = (users.fields || []).find((field) => field.name === "role");
const expected = ["super_admin", "admin", "staff", "user"];
const actual = role?.values || [];
const missing = expected.filter((item) => !actual.includes(item));
if (missing.length) throw new Error(`Users.role thiếu role: ${missing.join(", ")}`);
console.log(JSON.stringify({ status: "passed", roles: actual }, null, 2));
