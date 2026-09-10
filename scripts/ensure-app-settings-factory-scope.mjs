import fs from "node:fs";
import PocketBase from "pocketbase";

const APPLY = process.argv.includes("--apply");
const FIELD_NAME = "staff_employment_factory_scope";
const DESIRED_FIELD = {
  name: FIELD_NAME,
  type: "select",
  required: false,
  maxSelect: 1,
  values: ["assigned", "all"],
};

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

function selectFieldMatches(current) {
  return (
    current?.type === DESIRED_FIELD.type &&
    Boolean(current?.required) === DESIRED_FIELD.required &&
    Number(current?.maxSelect) === DESIRED_FIELD.maxSelect &&
    JSON.stringify([...(current?.values || [])].sort()) ===
      JSON.stringify([...DESIRED_FIELD.values].sort())
  );
}

async function main() {
  const fileEnv = readEnvFile(".env");
  const url =
    process.env.PB_URL ||
    process.env.VITE_PB_URL ||
    fileEnv.PB_URL ||
    fileEnv.VITE_PB_URL ||
    "http://127.0.0.1:8290";
  const email = process.env.PB_ADMIN_EMAIL || fileEnv.PB_ADMIN_EMAIL;
  const password = process.env.PB_ADMIN_PASSWORD || fileEnv.PB_ADMIN_PASSWORD;
  if (!email || !password) throw new Error("Thiếu PB_ADMIN_EMAIL hoặc PB_ADMIN_PASSWORD.");
  const pb = new PocketBase(url);
  pb.autoCancellation(false);
  try {
    await pb.collection("_superusers").authWithPassword(email, password);

    // 1) Đảm bảo trường select phạm vi nhà máy tồn tại và đúng cấu hình.
    const collection = await pb.collections.getOne("app_settings");
    const fields = collection.fields || [];
    const fieldIndex = fields.findIndex((field) => field.name === FIELD_NAME);
    let nextFields = fields;
    let needsUpdate = false;
    if (fieldIndex === -1) {
      console.log(`app_settings: thiếu trường ${FIELD_NAME}.`);
      nextFields = [...fields, { ...DESIRED_FIELD }];
      needsUpdate = true;
    } else if (!selectFieldMatches(fields[fieldIndex])) {
      console.log(`app_settings: trường ${FIELD_NAME} sai cấu hình, cần chuẩn hoá.`);
      nextFields = fields.map((field, index) =>
        index === fieldIndex ? { ...field, ...DESIRED_FIELD, id: field.id } : field,
      );
      needsUpdate = true;
    } else {
      console.log(`app_settings: trường ${FIELD_NAME} đã đúng cấu hình.`);
    }
    if (needsUpdate) {
      if (!APPLY) {
        console.log("Chỉ kiểm tra. Chạy lại với --apply để bổ sung/chuẩn hoá trường.");
      } else {
        await pb.collections.update(collection.id, { fields: nextFields });
        console.log(`app_settings: đã cập nhật trường ${FIELD_NAME}.`);
      }
    }

    // 2) Kiểm tra giá trị đang đặt trên từng bản ghi app_settings (không tự sửa dữ liệu).
    const settingsRecords = await pb.collection("app_settings").getFullList({
      fields: `id,tenant_company,company_name,${FIELD_NAME}`,
    });
    const byTenant = new Map();
    for (const record of settingsRecords) {
      const key = record.tenant_company || "(không có tenant)";
      if (!byTenant.has(key)) byTenant.set(key, []);
      byTenant.get(key).push(record);
    }
    for (const [tenant, records] of byTenant) {
      if (records.length > 1) {
        console.warn(
          `Cảnh báo: tenant ${tenant} có ${records.length} bản ghi app_settings ` +
            `(${records.map((record) => record.id).join(", ")}). ` +
            "Nên gộp còn 1 bản ghi để tránh đọc/ghi không nhất quán.",
        );
      }
      for (const record of records) {
        const value = record[FIELD_NAME] || "(trống → mặc định assigned)";
        console.log(` - ${record.company_name || record.id}: ${FIELD_NAME}=${value}`);
      }
    }
  } finally {
    pb.authStore.clear();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
