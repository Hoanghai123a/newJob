import fs from "node:fs";
import PocketBase from "pocketbase";

const APPLY = process.argv.includes("--apply");
const DELETE_USERS = process.argv.includes("--delete-legacy-users");
const DROP_FIELDS = process.argv.includes("--drop-legacy-fields");
const env = Object.fromEntries(
  fs.readFileSync(".env", "utf8").split(/\r?\n/).map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => { const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1).replace(/^['\"]|['\"]$/g, "")]; }),
);
const url = process.env.PB_URL || process.env.VITE_PB_URL || env.PB_URL || env.VITE_PB_URL;
const email = process.env.PB_ADMIN_EMAIL || env.PB_ADMIN_EMAIL;
const password = process.env.PB_ADMIN_PASSWORD || env.PB_ADMIN_PASSWORD;
if (!url || !email || !password) throw new Error("Thiếu cấu hình PocketBase.");
const pb = new PocketBase(url);
pb.autoCancellation(false);
await pb.collection("_superusers").authWithPassword(email, password).catch(() => pb.admins.authWithPassword(email, password));

const RELATIONS = [
  { collection: "employment_histories", oldField: "user", newField: "worker", required: true, dropOld: true },
  { collection: "cccd_versions", oldField: "user", newField: "worker", required: false, dropOld: true },
  { collection: "advances", oldField: "user", newField: "worker", required: false, dropOld: true },
  { collection: "check_attendance_items", oldField: "user", newField: "worker", required: false, dropOld: false },
  { collection: "check_salary_items", oldField: "user", newField: "worker", required: false, dropOld: false },
  { collection: "group_chat_messages", oldField: "user", newField: "worker", required: false, dropOld: false },
  { collection: "chat_room_members", oldField: "user", newField: "worker", required: false, dropOld: false },
  { collection: "chat_join_requests", oldField: "user", newField: "worker", required: false, dropOld: false },
  { collection: "push_subscriptions", oldField: "user", newField: "worker", required: false, dropOld: false },
  { collection: "staff_action_logs", oldField: "target_user", newField: "target_worker", required: false, dropOld: false },
  { collection: "notebook_entries", oldField: "worker", newField: "worker_profile", required: false, dropOld: true },
  { collection: "salary_holds", oldField: "worker", newField: "worker_profile", required: true, dropOld: true },
];

function fieldByName(collection, name) { return (collection.fields || []).find((field) => field.name === name); }
function relationField(name, collectionId, required = false) {
  return { name, type: "relation", required, presentable: false, system: false, collectionId, cascadeDelete: false, maxSelect: 1, minSelect: 0 };
}
function unique(values) { return [...new Set(values.filter(Boolean))]; }
async function getAll(name, fields) { return pb.collection(name).getFullList({ fields }); }
async function updateRecord(collection, id, payload) { return pb.collection(collection).update(id, payload); }

const collections = await pb.collections.getFullList();
const workersCollection = collections.find((c) => c.name === "workers");
const usersCollection = collections.find((c) => c.name === "users");
if (!workersCollection || !usersCollection) throw new Error("Thiếu collection users hoặc workers.");

const users = await getAll("users", "id,role,tenant_company,full_name,username,phone,uid,cccd,cccd_issue_date,gender,date_of_birth,address,bank_name,bank_account_number,bank_account_name,bank_account_note,employee_code,status,company");
const legacyUsers = users.filter((u) => u.role === "user" || !u.role);
const workers = await getAll("workers", "id,auth_user,tenant_company,full_name,phone,uid,cccd,cccd_issue_date,gender,date_of_birth,address,bank_name,bank_account_number,bank_account_name,bank_account_note,employee_code,status,company,source_user_id");
const workerById = new Map(workers.map((w) => [w.id, w]));
const workerByAuth = new Map(workers.filter((w) => w.auth_user).map((w) => [w.auth_user, w]));
const userToWorker = new Map();
const report = { apply: APPLY, deleteUsers: DELETE_USERS, dropFields: DROP_FIELDS, createdWorkers: [], reusedWorkers: [], addedFields: [], migrated: [], unresolved: [], deletedUsers: [], droppedFields: [] };

for (const user of legacyUsers) {
  let worker = workerByAuth.get(user.id) || workerById.get(user.id);
  if (!worker && APPLY) {
    const payload = {
      id: user.id,
      full_name: String(user.full_name || user.username || user.phone || "NLĐ chưa có tên").trim(),
      phone: user.phone || "", uid: user.uid || "", cccd: user.cccd || "", cccd_issue_date: user.cccd_issue_date || "",
      gender: user.gender || "", date_of_birth: user.date_of_birth || "", address: user.address || "", bank_name: user.bank_name || "",
      bank_account_number: user.bank_account_number || "", bank_account_name: user.bank_account_name || "", bank_account_note: user.bank_account_note || "",
      employee_code: user.employee_code || "", status: user.status === "disabled" ? "inactive" : "active", tenant_company: user.tenant_company || user.company || "",
      company: user.tenant_company || user.company || "", source_user_id: user.id,
    };
    try {
      worker = await pb.collection("workers").create(payload);
      workerById.set(worker.id, worker);
      report.createdWorkers.push(worker.id);
    } catch (error) {
      report.unresolved.push({ userId: user.id, reason: error?.response?.message || error?.message || String(error) });
    }
  }
  if (worker) {
    userToWorker.set(user.id, worker.id);
    if (worker.auth_user !== user.id && APPLY) {
      await pb.collection("workers").update(worker.id, { auth_user: user.id });
      worker.auth_user = user.id;
    }
    if (!report.createdWorkers.includes(worker.id)) report.reusedWorkers.push(worker.id);
  } else if (!userToWorker.has(user.id)) {
    report.unresolved.push({ userId: user.id, reason: "Không tìm thấy worker tương ứng." });
  }
}

for (const target of RELATIONS) {
  const collection = collections.find((c) => c.name === target.collection);
  if (!collection) continue;
  const oldField = fieldByName(collection, target.oldField);
  if (!oldField || oldField.collectionId !== usersCollection.id) continue;
  let newField = fieldByName(collection, target.newField);
  if (!newField && APPLY) {
    const nextRules = {};
    for (const ruleName of ["listRule", "viewRule", "createRule", "updateRule", "deleteRule"]) {
      const rule = collection[ruleName];
      if (typeof rule === "string") nextRules[ruleName] = rule.replaceAll(target.oldField, target.newField);
    }
    await pb.collections.update(collection.id, { fields: [...collection.fields, relationField(target.newField, workersCollection.id, false)], ...nextRules });
    newField = fieldByName(await pb.collections.getOne(collection.id), target.newField);
    report.addedFields.push(`${target.collection}.${target.newField}`);
  }
  const records = await getAll(target.collection, `id,${target.oldField},${target.newField},tenant_company`);
  let migratedCount = 0;
  let nonWorkerCount = 0;
  for (const record of records) {
    const oldId = String(record[target.oldField] || "").trim();
    if (!oldId) continue;
    const workerId = userToWorker.get(oldId);
    if (!workerId) { nonWorkerCount++; continue; }
    migratedCount++;
    if (APPLY && newField && record[target.newField] !== workerId) await updateRecord(target.collection, record.id, { [target.newField]: workerId });
  }
  report.migrated.push({ collection: target.collection, oldField: target.oldField, newField: target.newField, migratedCount, nonWorkerCount, dropOld: target.dropOld });
  if (DROP_FIELDS && target.dropOld && nonWorkerCount === 0 && newField) {
    const refreshed = await pb.collections.getOne(collection.id);
    const withoutOld = refreshed.fields.filter((f) => f.name !== target.oldField);
    await pb.collections.update(collection.id, { fields: withoutOld });
    report.droppedFields.push(`${target.collection}.${target.oldField}`);
  }
}

if (DROP_FIELDS && APPLY) {
  const refreshed = await pb.collections.getFullList();
  for (const item of RELATIONS.filter((x) => x.dropOld)) {
    const c = refreshed.find((x) => x.name === item.collection);
    if (!c) continue;
    const old = fieldByName(c, item.oldField);
    const next = fieldByName(c, item.newField);
    if (!old && next && next.collectionId === workersCollection.id && !report.droppedFields.includes(`${item.collection}.${item.oldField}`)) {
      report.droppedFields.push(`${item.collection}.${item.oldField}`);
    }
  }
}

if (DELETE_USERS && APPLY && report.unresolved.length === 0) {
  const remaining = await pb.collections.getFullList();
  const blockers = [];
  for (const c of remaining) {
    if (c.system || c.name.startsWith("_")) continue;
    for (const f of c.fields || []) {
      if (f.collectionId === usersCollection.id && ["user", "worker", "target_user"].includes(f.name)) blockers.push(`${c.name}.${f.name}`);
    }
  }
  if (blockers.length) report.unresolved.push({ reason: `Còn relation NLĐ trỏ users: ${blockers.join(", ")}` });
  else {
    for (const user of legacyUsers) {
      try { await pb.collection("users").delete(user.id); report.deletedUsers.push(user.id); }
      catch (error) { report.unresolved.push({ userId: user.id, reason: error?.response?.message || error?.message || String(error) }); }
    }
  }
}

console.log(JSON.stringify(report, null, 2));
if (!APPLY) console.log("Dry-run: chưa thay đổi PocketBase. Chạy với --apply sau khi rà soát.");
if (report.unresolved.length) process.exitCode = 2;
pb.authStore.clear();
