import fs from "node:fs";
import PocketBase from "pocketbase";

const APPLY = process.argv.includes("--apply");

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

function field(name, type, options = {}) {
  return {
    name,
    type,
    required: true,
    system: false,
    hidden: false,
    presentable: false,
    ...options,
  };
}

function indexSignature(sql) {
  const match = sql.match(/ON\s+[`"]?([^`"\s]+)[`"]?\s*\(([^)]+)\)/i);
  if (!match) return "";
  const fields = match[2]
    .split(",")
    .map((item) => item.replace(/[`"\s]/g, "").toLowerCase())
    .join(",");
  return `${match[1].toLowerCase()}:${fields}`;
}

function fieldMatches(actual, expected) {
  return (
    actual?.type === expected.type &&
    actual?.required === expected.required &&
    (expected.collectionId === undefined || actual?.collectionId === expected.collectionId) &&
    (expected.min === undefined || actual?.min === expected.min) &&
    (expected.max === undefined || actual?.max === expected.max) &&
    (expected.pattern === undefined || actual?.pattern === expected.pattern) &&
    (expected.maxSelect === undefined || actual?.maxSelect === expected.maxSelect) &&
    (expected.cascadeDelete === undefined || actual?.cascadeDelete === expected.cascadeDelete)
  );
}

async function main() {
  const fileEnv = readEnvFile(".env");
  const url =
    process.env.PB_URL ||
    process.env.VITE_POCKETBASE_URL ||
    fileEnv.PB_URL ||
    fileEnv.VITE_POCKETBASE_URL ||
    "http://127.0.0.1:8290";
  if (APPLY && !process.env.PB_URL) {
    throw new Error("Khi chạy --apply, cần đặt PB_URL tường minh cho PocketBase đích.");
  }
  const token = process.env.PB_ADMIN_TOKEN || fileEnv.PB_ADMIN_TOKEN;
  const email = process.env.PB_ADMIN_EMAIL || fileEnv.PB_ADMIN_EMAIL;
  const password = process.env.PB_ADMIN_PASSWORD || fileEnv.PB_ADMIN_PASSWORD;
  if (!token && (!email || !password)) {
    throw new Error("Thiếu PB_ADMIN_TOKEN hoặc PB_ADMIN_EMAIL/PB_ADMIN_PASSWORD.");
  }

  const pb = new PocketBase(url);
  pb.autoCancellation(false);
  try {
    if (token) pb.authStore.save(token, null);
    else await pb.collection("_superusers").authWithPassword(email, password);

    const [companies, histories, collections] = await Promise.all([
      pb.collections.getOne("companies"),
      pb.collections.getOne("employment_histories"),
      pb.collections.getFullList(),
    ]);
    const relation = (name, collectionId) =>
      field(name, "relation", {
        collectionId,
        cascadeDelete: false,
        maxSelect: 1,
        minSelect: 0,
      });
    const desired = {
      name: "employee_monthly_hours",
      type: "base",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        relation("tenant_company", companies.id),
        relation("employment_history", histories.id),
        field("month", "text", {
          min: 7,
          max: 7,
          pattern: "^\\d{4}-(0[1-9]|1[0-2])$",
        }),
        field("regular_hours", "number", { min: 0 }),
        field("overtime_hours", "number", { min: 0 }),
      ],
      indexes: [
        "CREATE UNIQUE INDEX `idx_employee_monthly_hours_history_month` ON `employee_monthly_hours` (`employment_history`, `month`)",
        "CREATE INDEX `idx_employee_monthly_hours_tenant_month` ON `employee_monthly_hours` (`tenant_company`, `month`)",
      ],
    };

    const current = collections.find((collection) => collection.name === desired.name);
    if (current) {
      const fieldsMatch = desired.fields.every((expected) =>
        fieldMatches(current.fields?.find((actual) => actual.name === expected.name), expected),
      );
      const indexes = new Set((current.indexes || []).map(indexSignature));
      const indexesMatch = desired.indexes.every((index) => indexes.has(indexSignature(index)));
      const rulesLocked = ["listRule", "viewRule", "createRule", "updateRule", "deleteRule"].every(
        (rule) => current[rule] === null,
      );
      if (current.type !== "base" || !fieldsMatch || !indexesMatch || !rulesLocked) {
        throw new Error(
          "employee_monthly_hours đã tồn tại nhưng chưa khớp schema/rules mong muốn; không tự sửa collection hiện có.",
        );
      }
      console.log("PocketBase: employee_monthly_hours đã đúng schema và khóa truy cập trực tiếp.");
      return;
    }

    if (!APPLY) {
      console.log(
        "PocketBase chưa có employee_monthly_hours. Chỉ kiểm tra; chạy lại với PB_URL rõ ràng và --apply để tạo collection.",
      );
      console.log(
        "Schema: tenant_company, employment_history, month, regular_hours, overtime_hours; direct API rules: locked; indexes: history+month unique, tenant+month.",
      );
      return;
    }

    await pb.collections.create(desired);
    console.log("PocketBase: đã tạo employee_monthly_hours với API rules bị khóa.");
  } finally {
    pb.authStore.clear();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
