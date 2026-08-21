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
        const key = line.slice(0, separator).trim();
        const value = line
          .slice(separator + 1)
          .trim()
          .replace(/^["']|["']$/g, "");
        return [key, value];
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

if (!email || !password) {
  throw new Error("Thiếu PB_ADMIN_EMAIL hoặc PB_ADMIN_PASSWORD.");
}

const pb = new PocketBase(baseUrl);
pb.autoCancellation(false);

try {
  await pb.collection("_superusers").authWithPassword(email, password);
  const collection = await pb.collections.getOne("advances");
  const fields = collection.fields || [];
  const existing = fields.find((field) => field.name === "payout_method");

  if (existing) {
    const isValid =
      existing.type === "select" &&
      existing.maxSelect === 1 &&
      existing.values?.includes("bank_transfer") &&
      existing.values?.includes("cash");

    if (!isValid) {
      throw new Error(
        "Field payout_method đã tồn tại nhưng không đúng cấu hình Select(bank_transfer, cash).",
      );
    }

    console.log("PocketBase: payout_method đã tồn tại đúng cấu hình.");
  } else {
    await pb.collections.update(collection.id, {
      fields: [
        ...fields,
        {
          name: "payout_method",
          type: "select",
          required: false,
          presentable: false,
          hidden: false,
          system: false,
          maxSelect: 1,
          values: ["bank_transfer", "cash"],
        },
      ],
    });
    console.log("PocketBase: đã thêm payout_method vào collection advances.");
  }
} finally {
  pb.authStore.clear();
}
