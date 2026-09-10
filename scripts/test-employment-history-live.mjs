import fs from "node:fs";
import PocketBase from "pocketbase";

function readEnv() {
  return Object.fromEntries(
    fs
      .readFileSync(".env", "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1).replace(/^["']|["']$/g, "")];
      }),
  );
}

const env = readEnv();
const pb = new PocketBase(env.PB_URL || env.VITE_PB_URL);
pb.autoCancellation(false);
const created = { historyId: "", cccdId: "", logId: "" };

try {
  await pb
    .collection("_superusers")
    .authWithPassword(env.PB_ADMIN_EMAIL, env.PB_ADMIN_PASSWORD)
    .catch(() => pb.admins.authWithPassword(env.PB_ADMIN_EMAIL, env.PB_ADMIN_PASSWORD));
  const [workers, histories, factories, houses, users] = await Promise.all([
    pb.collection("workers").getFullList({ fields: "id,auth_user,tenant_company,full_name,cccd" }),
    pb
      .collection("employment_histories")
      .getFullList({ fields: "id,user,status,leave_date,tenant_company" }),
    pb.collection("factories").getFullList({ fields: "id,tenant_company,status" }),
    pb
      .collection("recruitment_entities")
      .getFullList({ fields: "id,tenant_company,status" })
      .catch(() => []),
    pb.collection("users").getFullList({ fields: "id,role,tenant_company" }),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const activeUserIds = new Set(
    histories
      .filter(
        (history) =>
          history.status === "working" &&
          (!history.leave_date || history.leave_date.slice(0, 10) > today),
      )
      .map((history) => history.user),
  );
  const worker = workers.find(
    (candidate) => candidate.auth_user && !activeUserIds.has(candidate.auth_user),
  );
  if (!worker) throw new Error("Không có NLĐ liên kết tài khoản phù hợp để kiểm thử tạo lịch sử.");
  const factory = factories.find(
    (candidate) =>
      candidate.tenant_company === worker.tenant_company && candidate.status !== "inactive",
  );
  const house = houses.find(
    (candidate) =>
      candidate.tenant_company === worker.tenant_company && candidate.status !== "inactive",
  );
  const actor = users.find(
    (candidate) =>
      candidate.tenant_company === worker.tenant_company &&
      (candidate.role === "admin" || candidate.role === "staff"),
  );
  if (!factory || !house || !actor)
    throw new Error("Thiếu nhà máy, nhà chính hoặc tài khoản quản lý cùng công ty để kiểm thử.");

  const suffix = Date.now().toString().slice(-8);
  const cccd = `9900${suffix}`.slice(0, 12).padEnd(12, "7");
  const version = await pb.collection("cccd_versions").create({
    tenant_company: worker.tenant_company,
    user: worker.auth_user,
    cccd_number: cccd,
    is_current: false,
    note: "Dữ liệu kiểm thử tự động - sẽ xóa",
  });
  created.cccdId = version.id;

  const history = await pb.collection("employment_histories").create({
    tenant_company: worker.tenant_company,
    user: worker.auth_user,
    factory: factory.id,
    main_house: house.id,
    recruiter_staff: actor.id,
    cccd_version: version.id,
    uid: `TST${suffix}`,
    worker_name_snapshot: worker.full_name || "NLĐ kiểm thử",
    worker_cccd_snapshot: cccd,
    join_date: today,
    status: "working",
    note: "Dữ liệu kiểm thử tự động - sẽ xóa",
  });
  created.historyId = history.id;
  if (
    history.tenant_company !== worker.tenant_company ||
    history.user !== worker.auth_user ||
    history.cccd_version !== version.id
  ) {
    throw new Error("Bản ghi lịch sử mới không giữ đúng tenant, NLĐ hoặc CCCD version.");
  }

  let duplicateBlocked = false;
  try {
    await pb.collection("employment_histories").create({
      tenant_company: worker.tenant_company,
      user: worker.auth_user,
      factory: factory.id,
      main_house: house.id,
      recruiter_staff: actor.id,
      uid: `TSD${suffix}`,
      worker_name_snapshot: worker.full_name || "NLĐ kiểm thử",
      worker_cccd_snapshot: cccd,
      join_date: today,
      status: "working",
    });
  } catch (error) {
    duplicateBlocked = /unique|already exists|validation/i.test(
      [
        error?.message,
        JSON.stringify(error?.response?.data || {}),
        JSON.stringify(error?.response || {}),
      ].join(" "),
    );
  }
  if (!duplicateBlocked)
    throw new Error("PocketBase không chặn lịch sử đang làm trùng cho cùng NLĐ.");

  const log = await pb.collection("staff_action_logs").create({
    tenant_company: worker.tenant_company,
    actor: actor.id,
    actor_role_snapshot: actor.role,
    target_user: worker.auth_user,
    target_collection: "employment_histories",
    target_record: history.id,
    action: "create",
    note: "Dữ liệu kiểm thử tự động - sẽ xóa",
  });
  created.logId = log.id;
  console.log(
    JSON.stringify(
      {
        ok: true,
        workerId: worker.id,
        authUserId: worker.auth_user,
        historyId: history.id,
        cccdVersionId: version.id,
        actionLogId: log.id,
        duplicateBlocked,
      },
      null,
      2,
    ),
  );
} finally {
  for (const [collection, id] of [
    ["staff_action_logs", created.logId],
    ["employment_histories", created.historyId],
    ["cccd_versions", created.cccdId],
  ]) {
    if (id)
      await pb
        .collection(collection)
        .delete(id)
        .catch(() => undefined);
  }
  pb.authStore.clear();
}
