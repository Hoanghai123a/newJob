import { pb, type UserRecord } from "./pocketbase";
import type { AdvanceRecord } from "./advances";
import { companyPayload, joinTenantFilters } from "./tenant";
import { getWorker } from "./workers";

export type StaffActionType =
  | "create"
  | "update"
  | "delete"
  | "export"
  | "import"
  | "report_advance"
  | "report_leave"
  | "report_join"
  | "update_bank"
  | "check_payroll";

export interface StaffActionLogInput {
  actor?: Partial<UserRecord> | null;
  targetUserId?: string;
  targetCollection: string;
  targetRecord?: string;
  action: StaffActionType;
  before?: unknown;
  after?: unknown;
  note?: string;
}

export interface StaffActionLogRecord {
  id: string;
  tenant_company: string;
  actor: string;
  actor_role_snapshot: string;
  target_user?: string;
  target_worker?: string;
  target_collection: string;
  target_record?: string;
  action: StaffActionType;
  before?: unknown;
  after?: unknown;
  note?: string;
  created?: string;
  updated?: string;
  expand?: {
    actor?: UserRecord;
    target_user?: UserRecord;
  };
}

export type WorkerActionHistoryRecord = StaffActionLogRecord & {
  source?: "staff_log" | "advance_snapshot";
};

export type WorkerActionKind =
  | "advance_report"
  | "advance_withdraw"
  | "advance_approved"
  | "advance_rejected"
  | "advance_amount"
  | "advance_disbursement"
  | "default";

export type StaffActionLogChange = {
  field: string;
  label: string;
  before: string;
  after: string;
};

const ACTION_LABELS: Record<string, string> = {
  create: "Tạo mới",
  update: "Cập nhật",
  delete: "Xóa",
  export: "Xuất dữ liệu",
  import: "Nhập dữ liệu",
  report_advance: "Báo ứng lương",
  report_leave: "Báo nghỉ",
  report_join: "Báo đi làm mới",
  update_bank: "Cập nhật tài khoản ngân hàng",
  check_payroll: "Kiểm tra công lương",
};

const COLLECTION_LABELS: Record<string, string> = {
  users: "Hồ sơ NLĐ",
  employment_histories: "Lịch sử đi làm",
  advances: "Yêu cầu ứng lương",
  cccd_versions: "CCCD",
  salary_holds: "Giữ lương",
};

const FIELD_LABELS: Record<string, string> = {
  uid: "Mã tài khoản",
  username: "Tên đăng nhập",
  full_name: "Họ và tên",
  phone: "Số điện thoại",
  cccd: "CCCD",
  cccd_version: "Phiên bản CCCD",
  cccd_issue_date: "Ngày cấp CCCD",
  front_image: "Ảnh CCCD mặt trước",
  back_image: "Ảnh CCCD mặt sau",
  bank_name: "Ngân hàng",
  bank_account_number: "Số tài khoản",
  bank_account_name: "Tên chủ tài khoản",
  bank_account_note: "Ghi chú STK",
  factory: "Nhà máy",
  main_house: "Nhà chính",
  employee_code: "Mã nhân viên",
  worker_name_snapshot: "Họ tên tại thời điểm đi làm",
  worker_cccd_snapshot: "CCCD tại thời điểm đi làm",
  worker_date_of_birth_snapshot: "Ngày sinh tại thời điểm đi làm",
  worker_address_snapshot: "Địa chỉ tại thời điểm đi làm",
  hometown_snapshot: "Quê quán/địa chỉ",
  worker_tax_code_snapshot: "Mã số thuế",
  recruiter_staff: "Người tuyển",
  join_date: "Ngày vào làm",
  leave_date: "Ngày nghỉ",
  status: "Trạng thái",
  note: "Ghi chú",
  amount: "Số tiền",
  original_amount: "Số tiền ban đầu",
  reason: "Lý do",
  payout_method: "Phương thức chi",
  recovery_status: "Trạng thái thu hồi",
  requested_by: "Người gửi yêu cầu",
  recruiter_id: "Người tuyển",
  company: "Nhà máy",
  resolved_at: "Thời gian xử lý",
  recovered_at: "Thời gian thu hồi",
  disbursed: "Đã giải ngân",
  disbursed_at: "Thời gian giải ngân",
  admin_note: "Ghi chú admin",
  recruiter_note: "Ghi chú người tuyển",
  recovery_note: "Ghi chú thu hồi",
};

const HIDDEN_FIELDS = new Set(["id", "created", "updated", "expand", "collectionId"]);
const SENSITIVE_FIELD_PATTERN = /(password|token|secret|cccd|bank_account_number|account_number)/i;
const MONEY_FIELDS = new Set(["amount", "original_amount"]);
const DATE_ONLY_FIELDS = new Set([
  "join_date",
  "leave_date",
  "worker_date_of_birth_snapshot",
  "cccd_issue_date",
]);
const DATE_TIME_FIELDS = new Set(["resolved_at", "recovered_at", "disbursed_at"]);
const ADMIN_ADVANCE_WORKFLOW_FIELDS = new Set([
  "status",
  "resolved_at",
  "recovery_status",
  "recovered_at",
  "admin_note",
  "recovery_note",
]);
const ADVANCE_MATCH_WINDOW_MS = 2 * 60 * 1000;
const LOG_PAGE_SIZE = 50;
const MAX_LOG_PAGES = 5;

const STATUS_VALUE_LABELS: Record<string, string> = {
  pending: "Chờ người tuyển duyệt",
  recruiter_approved: "Chờ admin duyệt",
  accepted: "Đã tiếp nhận",
  rejected: "Đã từ chối",
  working: "Đang làm",
  left: "Đã nghỉ",
  received: "Đã tiếp nhận",
  approved: "Đã duyệt",
  disbursed: "Đã giải ngân",
  cancelled: "Đã hủy",
};

const RECOVERY_VALUE_LABELS: Record<string, string> = {
  none: "Chờ thu hồi",
  recovered: "Đã thu hồi",
  unrecoverable: "Không thể thu hồi",
};

const PAYOUT_METHOD_LABELS: Record<string, string> = {
  bank_transfer: "Chuyển khoản",
  cash: "Tiền mặt",
};

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function comparableValue(value: unknown) {
  if (value === undefined) return "__undefined__";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function changedFieldNames(log: Pick<StaffActionLogRecord, "before" | "after">) {
  const before = toRecord(log.before);
  const after = toRecord(log.after);
  if (!before && !after) return [] as string[];

  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  return [...keys]
    .filter((field) => !HIDDEN_FIELDS.has(field))
    .filter((field) => comparableValue(before?.[field]) !== comparableValue(after?.[field]));
}

function formatDateValue(value: string, includeTime: boolean) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return includeTime ? date.toLocaleString("vi-VN") : date.toLocaleDateString("vi-VN");
}

function numericValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function maskDigits(value: string, prefix: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "Đã che";
  return `${prefix}${digits.slice(-4)}`;
}

export function getStaffActionLabel(action?: string) {
  return ACTION_LABELS[action || ""] || "Thao tác khác";
}

export function getStaffActionCollectionLabel(collection?: string) {
  return COLLECTION_LABELS[collection || ""] || collection || "Bản ghi liên quan";
}

export function getStaffActionFieldLabel(field: string) {
  return FIELD_LABELS[field] || field.replace(/_/g, " ");
}

export function formatStaffActionValue(field: string, value: unknown) {
  if (value === undefined || value === null || value === "") return "—";
  if (SENSITIVE_FIELD_PATTERN.test(field)) {
    if (/password|token|secret/i.test(field)) return "Đã che";
    return maskDigits(String(value), /cccd/i.test(field) ? "********" : "•••• ");
  }
  if (typeof value === "boolean") return value ? "Có" : "Không";
  if (MONEY_FIELDS.has(field)) {
    return `${new Intl.NumberFormat("vi-VN").format(numericValue(value))} đ`;
  }
  if (typeof value === "number") return new Intl.NumberFormat("vi-VN").format(value);
  if (typeof value === "string") {
    if (field === "status") return STATUS_VALUE_LABELS[value] || value;
    if (field === "recovery_status") return RECOVERY_VALUE_LABELS[value] || value;
    if (field === "payout_method") return PAYOUT_METHOD_LABELS[value] || value;
    if (DATE_ONLY_FIELDS.has(field)) return formatDateValue(value, false);
    if (DATE_TIME_FIELDS.has(field)) return formatDateValue(value, true);
    return value;
  }
  return "Đã cập nhật";
}

export function getStaffActionLogChanges(log: Pick<StaffActionLogRecord, "before" | "after">) {
  const before = toRecord(log.before);
  const after = toRecord(log.after);
  if (!before && !after) return [] as StaffActionLogChange[];

  return changedFieldNames(log).map((field) => ({
    field,
    label: getStaffActionFieldLabel(field),
    before: formatStaffActionValue(field, before?.[field]),
    after: formatStaffActionValue(field, after?.[field]),
  }));
}

export function formatStaffActionDateTime(value?: string) {
  if (!value) return "Không rõ thời gian";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

export function shouldDisplayWorkerActionLog(log: StaffActionLogRecord) {
  if (
    log.target_collection !== "advances" ||
    log.actor_role_snapshot !== "admin" ||
    log.action !== "update"
  ) {
    return true;
  }

  const changedFields = changedFieldNames(log);
  if (changedFields.length > 0) {
    return changedFields.some((field) => !ADMIN_ADVANCE_WORKFLOW_FIELDS.has(field));
  }

  return /số tiền|giải ngân|phương thức|ngân hàng/i.test(log.note || "");
}

export function getWorkerActionKind(log: StaffActionLogRecord): WorkerActionKind {
  if (log.target_collection !== "advances") return "default";
  if (log.action === "report_advance") return "advance_report";
  if (log.action === "delete") return "advance_withdraw";

  const after = toRecord(log.after);
  const changedFields = new Set(changedFieldNames(log));
  if (changedFields.has("amount") || changedFields.has("original_amount")) {
    return "advance_amount";
  }
  if (changedFields.has("disbursed") || changedFields.has("disbursed_at")) {
    return "advance_disbursement";
  }
  if (after?.status === "recruiter_approved") return "advance_approved";
  if (after?.status === "rejected") return "advance_rejected";
  return "default";
}

export function getWorkerActionLabel(log: StaffActionLogRecord) {
  const labels: Record<WorkerActionKind, string> = {
    advance_report: "Báo ứng lương",
    advance_withdraw: "Thu hồi báo ứng",
    advance_approved: "Chấp nhận báo ứng",
    advance_rejected: "Từ chối báo ứng",
    advance_amount: "Điều chỉnh số tiền ứng",
    advance_disbursement: "Cập nhật giải ngân",
    default: getStaffActionLabel(log.action),
  };
  return labels[getWorkerActionKind(log)];
}

function summarizeChangedFields(log: StaffActionLogRecord) {
  const fields = changedFieldNames(log).map(getStaffActionFieldLabel);

  if (!fields.length) return "";

  if (fields.length <= 2) return `Đã cập nhật ${fields.join(" và ")}`;

  return `Đã cập nhật ${fields.slice(0, 2).join(", ")} và ${fields.length - 2} trường khác`;
}

function compactText(value: string, maxLength = 96) {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

export function getWorkerActionSummary(log: StaffActionLogRecord) {
  const kind = getWorkerActionKind(log);

  if (kind === "advance_report" || kind === "advance_withdraw") {
    const snapshot = toRecord(kind === "advance_withdraw" ? log.before : log.after);

    const amount = numericValue(snapshot?.amount);

    const reason = textValue(snapshot?.reason);

    const payoutMethod = textValue(snapshot?.payout_method);

    const parts: string[] = [];

    if (amount > 0) parts.push(`${new Intl.NumberFormat("vi-VN").format(amount)} đ`);

    if (payoutMethod) parts.push(PAYOUT_METHOD_LABELS[payoutMethod] || payoutMethod);

    if (reason) parts.push(`Lý do: ${reason}`);

    return (
      compactText(parts.join(" · ") || log.note || "") ||
      getStaffActionCollectionLabel(log.target_collection)
    );
  }

  const changedSummary = summarizeChangedFields(log);

  if (log.action === "update" && changedSummary) return changedSummary;

  return compactText(
    log.note || changedSummary || getStaffActionCollectionLabel(log.target_collection),
  );
}

function timestamp(value?: string) {
  const time = new Date(value || 0).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function advanceReportAmount(advance: AdvanceRecord) {
  return numericValue(advance.original_amount || advance.amount);
}

function logMatchesAdvance(log: StaffActionLogRecord, advance: AdvanceRecord) {
  if (log.action !== "report_advance" || log.target_collection !== "advances") return false;
  if (log.target_record && log.target_record === advance.id) return true;
  if (log.actor && advance.requested_by && log.actor !== advance.requested_by) return false;
  if (Math.abs(timestamp(log.created) - timestamp(advance.created)) > ADVANCE_MATCH_WINDOW_MS) {
    return false;
  }

  const after = toRecord(log.after);
  if (!after) return true;
  const loggedAmount = numericValue(after.amount);
  if (loggedAmount > 0 && loggedAmount !== advanceReportAmount(advance)) return false;
  const loggedReason = textValue(after.reason);
  if (loggedReason && loggedReason !== textValue(advance.reason)) return false;
  return true;
}

function syntheticAdvanceLog(advance: AdvanceRecord): WorkerActionHistoryRecord {
  const requestedBy = advance.requested_by || advance.user || "";
  const requester = advance.expand?.requested_by;
  const isSelfReport = Boolean(advance.user && requestedBy === advance.user);
  return {
    id: `advance:${advance.id}`,
    actor: requestedBy,
    actor_role_snapshot: requester?.role || (isSelfReport ? "user" : "staff"),
    target_user: advance.user,
    target_collection: "advances",
    target_record: advance.id,
    action: "report_advance",
    after: {
      employee_code: advance.employee_code || "",
      company: advance.company || "",
      join_date: advance.join_date || "",
      amount: advanceReportAmount(advance),
      reason: advance.reason || "",
      payout_method: advance.payout_method || "bank_transfer",
    },
    note: isSelfReport ? "NLĐ tự báo ứng" : "Báo ứng cho NLĐ",
    created: advance.created,
    expand: requester ? { actor: requester } : undefined,
    source: "advance_snapshot",
  };
}

async function fetchVisibleStaffActionLogs(userId: string, limit: number) {
  const visible: StaffActionLogRecord[] = [];
  for (let page = 1; page <= MAX_LOG_PAGES && visible.length < limit; page += 1) {
    const result = await pb
      .collection("staff_action_logs")
      .getList<StaffActionLogRecord>(page, LOG_PAGE_SIZE, {
        filter: joinTenantFilters(
          pb.authStore.record as UserRecord | null,
          `target_user="${userId}"`,
        ),
        sort: "-created",
        expand: "actor",
      });
    visible.push(...result.items.filter(shouldDisplayWorkerActionLog));
    if (page >= result.totalPages) break;
  }
  return visible.slice(0, limit);
}

export async function fetchStaffActionLogsForUser(userId: string, limit = 50) {
  if (!userId) return [] as StaffActionLogRecord[];
  return fetchVisibleStaffActionLogs(userId, limit);
}

export async function fetchWorkerActionHistory(userId: string, limit = 50) {
  if (!userId) return [] as WorkerActionHistoryRecord[];
  const logs = await fetchVisibleStaffActionLogs(userId, limit);
  let advances: AdvanceRecord[] = [];
  try {
    const result = await pb.collection("advances").getList<AdvanceRecord>(1, limit, {
      filter: joinTenantFilters(pb.authStore.record as UserRecord | null, `user="${userId}"`),
      sort: "-created",
      expand: "requested_by",
    });
    advances = result.items;
  } catch (error) {
    console.warn("[staff-log] Không tải được báo ứng cũ, tiếp tục dùng nhật ký thao tác", error);
  }

  const matchedLogIds = new Set<string>();
  const syntheticLogs = advances.flatMap((advance) => {
    const matchingLog = logs.find(
      (log) => !matchedLogIds.has(log.id) && logMatchesAdvance(log, advance),
    );
    if (matchingLog) {
      matchedLogIds.add(matchingLog.id);
      return [];
    }
    return [syntheticAdvanceLog(advance)];
  });

  return [...logs, ...syntheticLogs]
    .sort((a, b) => timestamp(b.created) - timestamp(a.created))
    .slice(0, limit);
}

export async function createStaffActionLog(input: StaffActionLogInput) {
  if (!input.actor?.id) return;

  let targetUserId = input.targetUserId || "";
  if (targetUserId) {
    const worker = await getWorker(targetUserId).catch(() => null);
    if (worker) targetUserId = worker.id;
  }

  await pb.collection("staff_action_logs").create({
    ...companyPayload(input.actor as UserRecord),
    actor: input.actor.id,
    actor_role_snapshot: input.actor.role || "user",
    target_worker: targetUserId,
    target_collection: input.targetCollection,
    target_record: input.targetRecord || "",
    action: input.action,
    before: input.before ?? null,
    after: input.after ?? null,
    note: input.note || "",
  });
}
