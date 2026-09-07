#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const strict = process.argv.includes("--strict");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const roots = ["src", "scripts", "docs"].map((name) => path.join(root, name));
const extensions = new Set([".ts", ".tsx", ".js", ".mjs", ".jsx", ".json", ".md", ".css", ".html"]);
const mojibake =
  /\uFFFD|Ã[\u0080-\u00FF]|Ä[\u0080-\u00FF]|Æ[\u0080-\u00FF]|á»|â€|Â[\u0080-\u00BF]/u;
const findings = [];

async function walk(directory) {
  let entries = [];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (
      extensions.has(path.extname(entry.name).toLowerCase()) &&
      !["fix-mojibake.mjs", "audit-vietnamese-encoding.mjs"].includes(entry.name)
    ) {
      const bytes = await fs.readFile(full);
      let text;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        findings.push({ file: path.relative(root, full), issue: "không phải UTF-8 hợp lệ" });
        continue;
      }
      const lines = text.split(/\r?\n/);
      lines.forEach((line, index) => {
        if (mojibake.test(line))
          findings.push({
            file: path.relative(root, full),
            line: index + 1,
            issue: "nghi mojibake",
          });
      });
    }
  }
}

await Promise.all(roots.map(walk));
const report = {
  status: findings.length ? "failed" : "passed",
  strict,
  scanned: roots.map((item) => path.relative(root, item)),
  findings,
};
console.log(JSON.stringify(report, null, 2));
if (strict && findings.length) process.exit(1);
