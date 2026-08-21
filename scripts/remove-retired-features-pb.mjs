import fs from "node:fs";
import PocketBase from "pocketbase";

const APPLY = process.argv.includes("--apply");
const COLLECTIONS = [
  "garden_gem_rewards",
  "garden_game_sessions",
  "garden_duels",
  "garden_coin_logs",
  "garden_visit_saves",
  "garden_exchange_requests",
  "garden_balances",
  "garden_exchange_tiers",
  "garden_foods",
  "guide_documents",
  "guides",
  "transport_contacts",
  "complaints",
  "attendance",
];
const USER_FIELDS = [
  "attendance_cutoff_day",
  "lcb",
  "chuyen_can",
  "doi_song",
  "tham_nien",
  "default_hc_hours",
  "default_ot_hours",
];

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

async function main() {
  const fileEnv = readEnvFile(".env");
  const url =
    process.env.PB_URL || process.env.VITE_PB_URL || fileEnv.PB_URL || fileEnv.VITE_PB_URL;
  const email = process.env.PB_ADMIN_EMAIL || fileEnv.PB_ADMIN_EMAIL;
  const password = process.env.PB_ADMIN_PASSWORD || fileEnv.PB_ADMIN_PASSWORD;
  if (!url || !email || !password) {
    throw new Error("Thiếu VITE_PB_URL, PB_ADMIN_EMAIL hoặc PB_ADMIN_PASSWORD.");
  }

  const pb = new PocketBase(url);
  pb.autoCancellation(false);
  try {
    await pb.collection("_superusers").authWithPassword(email, password);
    const existing = new Map(
      (await pb.collections.getFullList()).map((collection) => [collection.name, collection]),
    );

    console.log(
      APPLY
        ? "Bắt đầu xóa dữ liệu và schema PocketBase..."
        : "Chỉ kiểm tra. Chạy lại với --apply để xóa.",
    );
    for (const name of COLLECTIONS) {
      const collection = existing.get(name);
      if (!collection) {
        console.log(`${name}: không tồn tại.`);
        continue;
      }
      const count = await pb
        .collection(name)
        .getList(1, 1, { fields: "id" })
        .then((result) => result.totalItems);
      if (!APPLY) {
        console.log(`${name}: ${count} bản ghi, sẽ xóa collection.`);
        continue;
      }
      await pb.collections.delete(collection.id);
      console.log(`${name}: đã xóa ${count} bản ghi và collection.`);
    }

    const users = await pb.collections.getOne("users");
    const fields = users.fields || [];
    const removed = fields.filter((field) => USER_FIELDS.includes(field.name));
    if (!APPLY) {
      console.log(
        `users: sẽ xóa field ${removed.map((field) => field.name).join(", ") || "(không có)"}.`,
      );
      return;
    }
    if (removed.length) {
      await pb.collections.update(users.id, {
        fields: fields.filter((field) => !USER_FIELDS.includes(field.name)),
      });
    }
    console.log(
      `users: đã xóa field ${removed.map((field) => field.name).join(", ") || "(không có)"}.`,
    );
  } finally {
    pb.authStore.clear();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
