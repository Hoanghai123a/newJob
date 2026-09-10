import path from "node:path";
import {
  AUDIT_COLUMNS,
  connectPocketBase,
  countBy,
  duplicateGroups,
  normalizeUid,
  parseArgs,
  safeFullList,
  timestampName,
  writeCsv,
} from "./uid-duplicate-tools.mjs";

async function main() {
  const args = parseArgs();
  const pb = await connectPocketBase();
  const users = await safeFullList(pb, "users", {
    fields: "id,uid,username,full_name,phone,cccd,status,created,last_login",
    sort: "uid,created",
  });
  const groups = duplicateGroups(users);
  if (!groups.size) {
    console.log("Không phát hiện UID trùng trong collection users.");
    pb.authStore.clear();
    return;
  }

  const duplicateIds = new Set([...groups.values()].flat().map((user) => user.id));
  const relevant = (records, field) =>
    records.filter((record) => duplicateIds.has(String(record[field] || "")));
  const [histories, attendance, advances, salaryHolds, checkAttendance, checkSalary] =
    await Promise.all([
      safeFullList(pb, "employment_histories", { fields: "id,user,leave_date,status" }),
      safeFullList(pb, "attendance", { fields: "id,user" }),
      safeFullList(pb, "advances", { fields: "id,user" }),
      safeFullList(pb, "salary_holds", { fields: "id,worker" }),
      safeFullList(pb, "check_attendance_items", { fields: "id,user" }),
      safeFullList(pb, "check_salary_items", { fields: "id,user" }),
    ]);
  const scopedHistories = relevant(histories, "user");
  const metrics = {
    employment: countBy(scopedHistories, "user"),
    attendance: countBy(relevant(attendance, "user"), "user"),
    advances: countBy(relevant(advances, "user"), "user"),
    salaryHolds: countBy(relevant(salaryHolds, "worker"), "worker"),
    checkAttendance: countBy(relevant(checkAttendance, "user"), "user"),
    checkSalary: countBy(relevant(checkSalary, "user"), "user"),
  };
  const activeUsers = new Set(
    scopedHistories
      .filter((item) => !item.leave_date && (!item.status || item.status === "working"))
      .map((item) => item.user),
  );

  function score(user) {
    return (
      Number(activeUsers.has(user.id)) * 10000 +
      (metrics.employment.get(user.id) || 0) * 500 +
      (metrics.attendance.get(user.id) || 0) * 10 +
      (metrics.checkAttendance.get(user.id) || 0) * 10 +
      (metrics.checkSalary.get(user.id) || 0) * 20 +
      (metrics.advances.get(user.id) || 0) * 30 +
      (metrics.salaryHolds.get(user.id) || 0) * 30 +
      Number(Boolean(user.cccd)) * 5 +
      Number(Boolean(user.phone)) * 3 +
      Number(Boolean(user.last_login)) * 2
    );
  }

  const allUids = new Set(users.map((user) => normalizeUid(user.uid)).filter(Boolean));
  const settings = await pb
    .collection("app_settings")
    .getList(1, 1, { fields: "account_code_prefix" });
  const prefix = String(settings.items[0]?.account_code_prefix || "HL")
    .trim()
    .toUpperCase();
  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d{6})$`);
  const counterKey = `user:${prefix}`;
  const counter = await pb
    .collection("uid_counters")
    .getFirstListItem(`counter_key="${counterKey.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`, {
      fields: "current_value",
    })
    .catch(() => null);
  let next = Math.max(
    Number(counter?.current_value || 0),
    ...[...allUids].map((uid) => Number(uid.match(pattern)?.[1] || 0)),
  );
  function nextUid() {
    do next += 1;
    while (allUids.has(`${prefix}${String(next).padStart(6, "0")}`));
    const uid = `${prefix}${String(next).padStart(6, "0")}`;
    allUids.add(uid);
    return uid;
  }

  const rows = [];
  for (const [uid, members] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const cccds = new Map(),
      phones = new Map();
    for (const user of members) {
      if (user.cccd) cccds.set(user.cccd, (cccds.get(user.cccd) || 0) + 1);
      if (user.phone) phones.set(user.phone, (phones.get(user.phone) || 0) + 1);
    }
    const ranked = [...members].sort(
      (a, b) =>
        score(b) - score(a) ||
        String(a.created).localeCompare(String(b.created)) ||
        a.id.localeCompare(b.id),
    );
    const keeper = ranked[0];
    const groupRisk =
      members.length >= 5 ||
      [...cccds.values()].some((count) => count > 1) ||
      [...phones.values()].some((count) => count > 1) ||
      ranked.filter((user) => activeUsers.has(user.id)).length > 1;
    for (const user of ranked) {
      const keep = user.id === keeper.id;
      const reasons = [];
      if (activeUsers.has(user.id)) reasons.push("đang làm");
      if (metrics.employment.get(user.id))
        reasons.push(`${metrics.employment.get(user.id)} lịch sử`);
      if (user.cccd && cccds.get(user.cccd) > 1) reasons.push("trùng CCCD trong nhóm");
      if (user.phone && phones.get(user.phone) > 1) reasons.push("trùng SĐT trong nhóm");
      rows.push({
        approved: "NO",
        decision: keep ? "KEEP" : "CHANGE",
        old_uid: uid,
        new_uid: keep ? "" : nextUid(),
        user_id: user.id,
        username: user.username || "",
        full_name: user.full_name || "",
        phone: user.phone || "",
        cccd: user.cccd || "",
        status: user.status || "",
        created: user.created || "",
        last_login: user.last_login || "",
        active_employment: activeUsers.has(user.id) ? "YES" : "NO",
        employment_count: metrics.employment.get(user.id) || 0,
        attendance_count: metrics.attendance.get(user.id) || 0,
        advance_count: metrics.advances.get(user.id) || 0,
        salary_hold_count: metrics.salaryHolds.get(user.id) || 0,
        check_attendance_count: metrics.checkAttendance.get(user.id) || 0,
        check_salary_count: metrics.checkSalary.get(user.id) || 0,
        score: score(user),
        risk: groupRisk ? "REVIEW" : "NORMAL",
        reason: `${keep ? "Đề xuất giữ UID" : "Đề xuất cấp UID mới"}${reasons.length ? `; ${reasons.join("; ")}` : ""}`,
      });
    }
  }

  const filePath = path.resolve(
    args.outputDir,
    `${timestampName("duplicate-user-uids-audit")}.csv`,
  );
  writeCsv(filePath, rows, AUDIT_COLUMNS);
  console.log(
    JSON.stringify(
      {
        duplicateGroups: groups.size,
        affectedUsers: rows.length,
        usersToChange: rows.filter((row) => row.decision === "CHANGE").length,
        output: filePath,
      },
      null,
      2,
    ),
  );
  console.log(
    "Hãy kiểm tra CSV, giữ đúng một dòng KEEP mỗi UID và đổi approved thành YES cho toàn bộ dòng trước khi chạy repair.",
  );

  pb.authStore.clear();
}

await main();
