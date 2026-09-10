import PocketBase from "pocketbase";

const pbUrl = process.env.PB_URL || process.env.VITE_PB_URL || "http://127.0.0.1:8290";
const identity = process.env.PB_ADMIN_EMAIL;
const password = process.env.PB_ADMIN_PASSWORD;
if (!identity || !password) throw new Error("Thiếu PB_ADMIN_EMAIL hoặc PB_ADMIN_PASSWORD.");

const pb = new PocketBase(pbUrl);
await pb
  .collection("_superusers")
  .authWithPassword(identity, password)
  .catch(async () => {
    await pb.admins.authWithPassword(identity, password);
  });

async function ensureUidCounterCollection() {
  const rules = {
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
  };
  const usersCollection = await pb.collections.getOne("users");
  const desiredFields = [
    { name: "counter_key", type: "text", required: true, min: 1, max: 200 },
    {
      name: "counter_type",
      type: "select",
      required: true,
      maxSelect: 1,
      values: ["user", "employment_history"],
    },
    { name: "prefix", type: "text", required: false, max: 20 },
    { name: "period", type: "text", required: false, max: 6 },
    { name: "current_value", type: "number", required: true, onlyInt: true, min: 0 },
    {
      name: "updated_by",
      type: "relation",
      required: false,
      maxSelect: 1,
      collectionId: usersCollection.id,
    },
    { name: "note", type: "text", required: false, max: 1000 },
  ];
  const counterIndex =
    "CREATE UNIQUE INDEX `idx_uid_counters_key` ON `uid_counters` (`counter_key`)";

  let collection = null;
  try {
    collection = await pb.collections.getOne("uid_counters");
  } catch (error) {
    if (error?.status !== 404) throw error;
  }

  if (!collection) {
    await pb.collections.create({
      name: "uid_counters",
      type: "base",
      ...rules,
      fields: [
        ...desiredFields,
        { name: "created", type: "autodate", onCreate: true, onUpdate: false },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: [counterIndex],
    });
    console.log("Đã tạo collection uid_counters.");
  } else {
    const desiredByName = new Map(desiredFields.map((field) => [field.name, field]));
    const fields = collection.fields.map((field) => {
      const desired = desiredByName.get(field.name);
      if (!desired) return field;
      desiredByName.delete(field.name);
      return { ...field, ...desired, id: field.id };
    });
    fields.push(...desiredByName.values());
    await pb.collections.update(collection.id, {
      ...rules,
      fields,
      indexes: [...new Set([...(collection.indexes || []), counterIndex])],
    });
    console.log("Đã kiểm tra collection uid_counters.");
  }

  return true;
}

await ensureUidCounterCollection();

const settings = await pb
  .collection("app_settings")
  .getList(1, 1, { fields: "account_code_prefix" });
const configuredPrefix = String(settings.items[0]?.account_code_prefix || "")
  .trim()
  .toUpperCase();
const counters = await pb.collection("uid_counters").getFullList();
const counterByKey = new Map(counters.map((item) => [item.counter_key, item]));
const invalid = [];
const duplicates = [];
const seen = new Map();
const maxima = new Map();

function noteUid(collection, id, uid, pattern, makeKey) {
  const value = String(uid || "")
    .trim()
    .toUpperCase();
  if (!value) return;
  if (seen.has(`${collection}:${value}`))
    duplicates.push({ collection, uid: value, ids: [seen.get(`${collection}:${value}`), id] });
  else seen.set(`${collection}:${value}`, id);
  const match = value.match(pattern);
  if (!match) return invalid.push({ collection, id, uid: value });
  const { key, type, prefix, period, sequence } = makeKey(match);
  const current = maxima.get(key);
  if (!current || sequence > current.current_value)
    maxima.set(key, {
      counter_key: key,
      counter_type: type,
      prefix,
      period,
      current_value: sequence,
    });
}

const users = await pb.collection("users").getFullList({ fields: "id,uid" });
for (const user of users)
  noteUid("users", user.id, user.uid, /^(.*?)(\d{6})$/, (m) => ({
    key: `user:${m[1]}`,
    type: "user",
    prefix: m[1],
    period: "",
    sequence: Number(m[2]),
  }));

const histories = await pb.collection("employment_histories").getFullList({ fields: "id,uid" });
for (const history of histories)
  noteUid("employment_histories", history.id, history.uid, /^(.*?)(\d{2})(\d{2})(\d{4})$/, (m) => ({
    key: `employment_history:${m[1]}:20${m[2]}${m[3]}`,
    type: "employment_history",
    prefix: m[1],
    period: `20${m[2]}${m[3]}`,
    sequence: Number(m[4]),
  }));

async function ensureUniqueUidIndex(collectionName, indexName, indexSql, duplicateGroups) {
  const target = await pb.collections.getOne(collectionName);
  if ((target.indexes || []).some((index) => index.includes(indexName))) {
    console.log(`Unique index UID của ${collectionName} đã tồn tại.`);
    return true;
  }
  if (duplicateGroups.length) {
    console.warn(
      `Bỏ qua unique index ${indexName}: collection ${collectionName} đang có ${duplicateGroups.length} nhóm UID trùng.`,
    );
    return false;
  }
  try {
    await pb.collections.update(target.id, {
      indexes: [...(target.indexes || []), indexSql],
    });
    console.log(`Đã thêm unique index UID cho ${collectionName}.`);
    return true;
  } catch (error) {
    console.warn(`Không thể tạo unique index ${indexName}; bộ đếm UID vẫn đã được khởi tạo.`);
    console.warn(JSON.stringify(error?.response?.data || error?.response || {}, null, 2));
    return false;
  }
}

for (const item of maxima.values()) {
  const existing = counterByKey.get(item.counter_key);
  if (existing && Number(existing.current_value || 0) >= item.current_value) continue;
  const payload = { ...item, note: "Khởi tạo/đối soát từ script", updated_by: "" };
  if (existing) await pb.collection("uid_counters").update(existing.id, payload);
  else await pb.collection("uid_counters").create(payload);
}

const duplicateUsers = duplicates.filter((item) => item.collection === "users");
const duplicateHistories = duplicates.filter((item) => item.collection === "employment_histories");
const userUidIndexReady = await ensureUniqueUidIndex(
  "users",
  "idx_users_uid_unique",
  "CREATE UNIQUE INDEX `idx_users_uid_unique` ON `users` (`uid`) WHERE `uid` != ''",
  duplicateUsers,
);
const historyUidIndexReady = await ensureUniqueUidIndex(
  "employment_histories",
  "idx_employment_histories_uid_unique",
  "CREATE UNIQUE INDEX `idx_employment_histories_uid_unique` ON `employment_histories` (`uid`) WHERE `uid` != ''",
  duplicateHistories,
);

console.log(
  JSON.stringify(
    {
      configuredPrefix,
      countersChecked: maxima.size,
      invalid,
      duplicates,
      uniqueIndexes: { users: userUidIndexReady, employmentHistories: historyUidIndexReady },
    },
    null,
    2,
  ),
);
if (duplicates.length) {
  console.warn(
    "Đã khởi tạo bộ đếm nhưng cần xử lý UID trùng rồi chạy lại script để tạo unique index.",
  );
}
