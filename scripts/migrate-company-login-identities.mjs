import fs from "node:fs";
import PocketBase from "pocketbase";

const apply = process.argv.includes("--apply");
const env = fs.existsSync(".env")
  ? Object.fromEntries(
      fs
        .readFileSync(".env", "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => {
          const index = line.indexOf("=");
          return [line.slice(0, index), line.slice(index + 1).replace(/^['\"]|['\"]$/g, "")];
        }),
    )
  : {};
const url = process.env.PB_URL || env.PB_URL || process.env.VITE_PB_URL || env.VITE_PB_URL;
const email = process.env.PB_ADMIN_EMAIL || env.PB_ADMIN_EMAIL;
const password = process.env.PB_ADMIN_PASSWORD || env.PB_ADMIN_PASSWORD;
if (!url || !email || !password)
  throw new Error("Thiếu PB_URL, PB_ADMIN_EMAIL hoặc PB_ADMIN_PASSWORD.");

const pb = new PocketBase(url);
pb.autoCancellation(false);
await pb
  .collection("_superusers")
  .authWithPassword(email, password)
  .catch(() => pb.admins.authWithPassword(email, password));

function normalizeLoginName(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}
function loginNameFromUsername(value) {
  const username = normalizeLoginName(value);
  const separator = username.indexOf("__");
  return separator >= 0 ? username.slice(separator + 2) : username;
}
function technicalUsername(code, loginName) {
  return `${String(code).toLowerCase()}__${loginNameFromUsername(loginName)}`;
}
function validCode(code) {
  return /^[A-Za-z0-9_.]+$/.test(String(code || ""));
}
function validLoginName(loginName) {
  return /^[a-z0-9_.]{4,30}$/.test(loginName);
}

const usersCollection = await pb.collections.getOne("users");
const hasLoginName = (usersCollection.fields || []).some((field) => field.name === "login_name");
const companies = await pb.collection("companies").getFullList({ fields: "id,code" });
const companyById = new Map(companies.map((company) => [company.id, company]));
const users = await pb
  .collection("users")
  .getFullList({ fields: "id,username,login_name,tenant_company,role" });
const errors = [];
const changes = [];
const seen = new Map();
for (const user of users) {
  if (user.role === "super_admin") continue;
  const company = companyById.get(user.tenant_company);
  const loginName = normalizeLoginName(user.login_name || loginNameFromUsername(user.username));
  if (!company || !validCode(company.code) || !validLoginName(loginName)) {
    errors.push({
      id: user.id,
      username: user.username,
      reason: !company ? "Thiếu công ty hợp lệ" : "Mã công ty hoặc tên đăng nhập ngắn không hợp lệ",
    });
    continue;
  }
  const username = technicalUsername(company.code, loginName);
  const duplicate = seen.get(username);
  if (duplicate) {
    errors.push({ id: user.id, username, reason: `Trùng username kỹ thuật với ${duplicate}` });
    continue;
  }
  seen.set(username, user.id);
  if (user.username !== username || user.login_name !== loginName)
    changes.push({ id: user.id, username, login_name: loginName });
}

const report = {
  apply,
  loginNameField: hasLoginName ? "đã có" : "sẽ thêm",
  totalUsers: users.length,
  changes,
  errors,
};
if (errors.length) {
  console.log(JSON.stringify(report, null, 2));
  throw new Error("Migration bị chặn vì có dữ liệu không hợp lệ hoặc xung đột.");
}
if (apply) {
  if (!hasLoginName)
    await pb.collections.update(usersCollection.id, {
      fields: [
        ...usersCollection.fields,
        { name: "login_name", type: "text", required: false, max: 30 },
      ],
    });
  for (const change of changes)
    await pb
      .collection("users")
      .update(change.id, { username: change.username, login_name: change.login_name });
}
console.log(JSON.stringify(report, null, 2));
if (!apply)
  console.log("Dry-run hoàn tất. Chạy lại với --apply sau khi sao lưu và rà soát report.");
