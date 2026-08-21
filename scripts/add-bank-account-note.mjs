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
  const collection = await pb.collections.getOne("users");
  const fields = collection.fields || [];
  const existing = fields.find((field) => field.name === "bank_account_note");

  if (existing) {
    if (existing.type !== "text") {
      throw new Error("Field bank_account_note đã tồn tại nhưng không có kiểu text.");
    }

    console.log("PocketBase: bank_account_note đã tồn tại trong collection users.");
  } else {
    await pb.collections.update(collection.id, {
      fields: [
        ...fields,
        {
          name: "bank_account_note",
          type: "text",
          required: false,
          presentable: false,
          hidden: false,
          system: false,
        },
      ],
    });
    console.log("PocketBase: đã thêm bank_account_note vào collection users.");
  }
} finally {
  pb.authStore.clear();
}
