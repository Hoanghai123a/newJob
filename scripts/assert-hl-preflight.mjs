#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const root = process.env.NEWAPP_ROOT || process.cwd();
const file = path.join(root, "docs", "migration-audit", "latest-jobconnect-to-hl-preflight.json");
const report = JSON.parse(await fs.readFile(file, "utf8").catch(() => "{}"));
if (!report.created_at || report.apply || report.direct || report.unresolved?.length)
  throw new Error(
    "Preflight JobConnect -> HL chưa đạt hoặc có safety stop; chạy npm run migration:test rồi rà report.",
  );
console.log(
  JSON.stringify({ status: "passed", created_at: report.created_at, unresolved: 0 }, null, 2),
);
