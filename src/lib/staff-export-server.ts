import * as XLSX from "xlsx";

import { relationInFilter } from "./delegations";
import { isCurrentlyWorking, type EmploymentHistoryRecord } from "./employment";
import { getPBUpstream } from "./pocketbase-config";
import type { UserRecord } from "./pocketbase";
import { getRecruiterDisplay } from "./recruiters";
import { resolveBankCode } from "./vn-banks";

type ExportMode = "basic" | "full";
type ExportStatus = "all" | "working" | "left";

type ExportRequestBody = {
  factoryIds?: unknown;
  mode?: unknown;
  status?: unknown;
  historyFromDate?: unknown;
};

type FactoryManagerRecord = {
  factory: string;
  status?: string;
  active_from?: string;
  active_to?: string;
};

type PocketBaseList<T> = {
  page: number;
  totalPages: number;
  items: T[];
};

class PocketBaseExportError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly responseBody?: unknown,
  ) {
    super(message);
    this.name = "PocketBaseExportError";
  }
}

function escapePb(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function isManagerActive(record: FactoryManagerRecord, referenceDate = new Date()) {
  if (record.status === "inactive") return false;
  const now = referenceDate.getTime();
  const from = record.active_from ? Date.parse(record.active_from) : Number.NEGATIVE_INFINITY;
  const to = record.active_to ? Date.parse(record.active_to) : Number.POSITIVE_INFINITY;
  return (Number.isNaN(from) || from <= now) && (Number.isNaN(to) || to >= now);
}

async function fetchManagedFactoryIds(staffId: string, token: string) {
  const query = new URLSearchParams({
    page: "1",
    perPage: "500",
    filter: `staff="${escapePb(staffId)}"`,
    fields: "factory,status,active_from,active_to",
  });
  const response = await pbFetch(
    `/api/collections/factory_managers/records?${query}`,
    { method: "GET" },
    token,
  );
  if (!response.ok) {
    const body = await readJson(response);
    console.error("[staff-export] factory_managers request failed", {
      status: response.status,
      staffId,
      body,
    });
    throw new PocketBaseExportError(
      response.status === 403
        ? "Tài khoản Staff không có quyền đọc phạm vi nhà máy được phân công trong PocketBase."
        : "Không tải được phạm vi nhà máy được quản lý từ PocketBase.",
      response.status,
      body,
    );
  }
  const body = (await readJson(response)) as PocketBaseList<FactoryManagerRecord> | null;
  return new Set(
    (body?.items || []).filter((record) => isManagerActive(record)).map((record) => record.factory),
  );
}

function dateOnly(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isValidIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function buildHistoryFilter(
  user: UserRecord,
  factoryIds: string[],
  status: ExportStatus,
  historyFromDate: string,
  managedFactoryIds: Set<string>,
) {
  const selectedFactoryFilter = `(${relationInFilter("factory", factoryIds)})`;
  const parts = [selectedFactoryFilter, `(leave_date="" || leave_date>="${historyFromDate}")`];

  if (user.role === "staff") {
    const permissionParts = [`recruiter_staff="${escapePb(user.id)}"`];
    if (managedFactoryIds.size) {
      permissionParts.unshift(`(${relationInFilter("factory", [...managedFactoryIds])})`);
    }
    parts.push(`(${permissionParts.join(" || ")})`);
  }

  const today = dateOnly(new Date());
  if (status === "working") parts.push(`(leave_date="" || leave_date>"${today}")`);
  if (status === "left") parts.push(`(leave_date!="" && leave_date<="${today}")`);
  return parts.join(" && ");
}

async function fetchAllHistories(filter: string, token: string) {
  const histories: EmploymentHistoryRecord[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const query = new URLSearchParams({
      page: String(page),
      perPage: "500",
      filter,
      sort: "-join_date,-created",
      expand: "user,factory,recruiter_staff,recruiter_partner,main_house",
    });
    const response = await pbFetch(
      `/api/collections/employment_histories/records?${query}`,
      { method: "GET" },
      token,
    );
    if (!response.ok) {
      const body = await readJson(response);
      console.error("[staff-export] employment_histories request failed", {
        status: response.status,
        filter,
        body,
      });
      throw new PocketBaseExportError(
        response.status === 403
          ? "Tài khoản Staff không có quyền đọc lịch sử đi làm trong PocketBase."
          : "Không tải được lịch sử đi làm từ PocketBase.",
        response.status,
        body,
      );
    }

    const body = (await readJson(response)) as PocketBaseList<EmploymentHistoryRecord> | null;
    histories.push(...(body?.items || []));
    totalPages = Math.max(1, Number(body?.totalPages || 1));
    page += 1;
  } while (page <= totalPages);

  return histories;
}

function formatDateOnly(value?: string) {
  if (!value) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function computeTenureDays(histories: EmploymentHistoryRecord[], referenceDate = new Date()) {
  const refTime = referenceDate.getTime();
  let totalMs = 0;
  for (const history of histories) {
    if (!history.join_date) continue;
    const joinTime = Date.parse(history.join_date);
    if (Number.isNaN(joinTime)) continue;
    const leaveTime = history.leave_date ? Date.parse(history.leave_date) : refTime;
    const endTime = Number.isNaN(leaveTime) ? refTime : leaveTime;
    if (endTime > joinTime) totalMs += endTime - joinTime;
  }
  return Math.floor(totalMs / 86_400_000);
}

function tenureByUserId(histories: EmploymentHistoryRecord[]) {
  const grouped = new Map<string, EmploymentHistoryRecord[]>();
  for (const history of histories) {
    const rows = grouped.get(history.user) || [];
    rows.push(history);
    grouped.set(history.user, rows);
  }
  return new Map([...grouped].map(([userId, rows]) => [userId, computeTenureDays(rows)]));
}

function buildBasicRows(histories: EmploymentHistoryRecord[]) {
  const tenure = tenureByUserId(histories);
  return histories.map((history, index) => {
    const recruiter = getRecruiterDisplay(history);
    return {
      STT: index + 1,
      "Mã lịch sử": history.uid || "",
      "Mã nhân viên": history.employee_code || "",
      "Họ tên tại thời điểm đi làm": history.worker_name_snapshot || "",
      "CCCD tại thời điểm đi làm": history.worker_cccd_snapshot || "",
      "Ngày sinh tại thời điểm đi làm": formatDateOnly(history.worker_date_of_birth_snapshot),
      "Địa chỉ thường trú tại thời điểm đi làm":
        history.worker_address_snapshot || history.hometown_snapshot || "",
      "Ngày cấp CCCD tại thời điểm đi làm": formatDateOnly(history.cccd_issue_date),
      "Mã số thuế": history.worker_tax_code_snapshot || "",
      "Người tuyển": recruiter?.name || "",
      "Loại người tuyển": recruiter?.label || "",
      "Nhà máy": history.expand?.factory?.name || "",
      "Nhà chính": history.expand?.main_house?.name || "",
      "Ngày vào": formatDateOnly(history.join_date),
      "Ngày nghỉ": formatDateOnly(history.leave_date),
      "Trạng thái": isCurrentlyWorking(history) ? "Đang làm" : "Đã nghỉ",
      "Thâm niên tích luỹ (ngày)": tenure.get(history.user) ?? 0,
      "Tài khoản gốc": history.expand?.user?.full_name || history.expand?.user?.username || "",
      "Số điện thoại": history.expand?.user?.phone || "",
    };
  });
}

function buildFullRows(histories: EmploymentHistoryRecord[]) {
  const tenure = tenureByUserId(histories);
  return histories.map((history, index) => {
    const user = history.expand?.user;
    const recruiter = getRecruiterDisplay(history);
    return {
      STT: index + 1,
      "Mã tài khoản (UID)": user?.uid || "",
      "Mã lịch sử": history.uid || "",
      "Mã nhân viên": history.employee_code || "",
      "Họ tên tại thời điểm đi làm": history.worker_name_snapshot || "",
      "CCCD tại thời điểm đi làm": history.worker_cccd_snapshot || "",
      "Số điện thoại": user?.phone || "",
      "Ngày sinh tại thời điểm đi làm": formatDateOnly(history.worker_date_of_birth_snapshot),
      "Địa chỉ thường trú tại thời điểm đi làm":
        history.worker_address_snapshot || history.hometown_snapshot || "",
      "Nhà máy": history.expand?.factory?.name || "",
      "Nhà chính": history.expand?.main_house?.name || "",
      "Ngày vào": formatDateOnly(history.join_date),
      "Ngày nghỉ": formatDateOnly(history.leave_date),
      "Người tuyển": recruiter?.name || "",
      "Loại người tuyển": recruiter?.label || "",
      "Ngày cấp CCCD tại thời điểm đi làm": formatDateOnly(history.cccd_issue_date),
      "Thâm niên tích luỹ (ngày)": tenure.get(history.user) ?? 0,
      "Mã số thuế": history.worker_tax_code_snapshot || "",
      "Trạng thái lịch sử": isCurrentlyWorking(history) ? "Đang làm" : "Đã nghỉ",
      "Ghi chú": history.note || "",
      "Ngân hàng": resolveBankCode(user?.bank_name || ""),
      "Số tài khoản": user?.bank_account_number || "",
      "Tên chủ tài khoản": user?.bank_account_name || "",
      "Ghi chú STK": user?.bank_account_note || "",
      "Tên đăng nhập": user?.username || "",
      "Vai trò": user?.role || "",
      "Trạng thái tài khoản": user?.status || "",
    };
  });
}

function createWorkbook(rows: Record<string, unknown>[], mode: ExportMode) {
  const workbook = XLSX.utils.book_new();
  const sheetName = mode === "basic" ? "Lao động cơ bản" : "Lao động đầy đủ";
  const worksheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }) as Uint8Array;
}

export async function handleStaffExcelExport(request: Request) {
  if (request.method !== "POST") return jsonError("Phương thức không được hỗ trợ.", 405);

  const auth = await getAuthenticatedStaff(request);
  if (!auth)
    return jsonError("Phiên đăng nhập không hợp lệ hoặc không có quyền xuất dữ liệu.", 401);

  const body = (await request.json().catch(() => null)) as ExportRequestBody | null;
  const factoryIds = Array.isArray(body?.factoryIds)
    ? [
        ...new Set(
          body.factoryIds.filter((value): value is string => typeof value === "string" && value),
        ),
      ]
    : [];
  const mode: ExportMode = body?.mode === "basic" ? "basic" : "full";
  const status: ExportStatus =
    body?.status === "working" || body?.status === "left" ? body.status : "all";
  const historyFromDate =
    typeof body?.historyFromDate === "string" ? body.historyFromDate.trim() : "";

  if (!factoryIds.length) return jsonError("Vui lòng chọn ít nhất một nhà máy.");
  if (!isValidIsoDate(historyFromDate)) {
    return jsonError("Vui lòng chọn ngày bắt đầu lịch sử hợp lệ.");
  }
  if (factoryIds.length > 200) return jsonError("Số lượng nhà máy được chọn vượt quá giới hạn.");

  try {
    const managedFactoryIds =
      auth.user.role === "staff"
        ? await fetchManagedFactoryIds(auth.user.id, auth.token)
        : new Set<string>();
    const filter = buildHistoryFilter(
      auth.user,
      factoryIds,
      status,
      historyFromDate,
      managedFactoryIds,
    );
    const histories = await fetchAllHistories(filter, auth.token);
    if (!histories.length) return jsonError("Không có dữ liệu phù hợp để xuất.", 404);

    const rows = mode === "basic" ? buildBasicRows(histories) : buildFullRows(histories);
    const file = createWorkbook(rows, mode);
    const filename = `jobconnect_${mode === "basic" ? "co_ban" : "day_du"}_${dateOnly(new Date())}.xlsx`;

    return new Response(file, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
        "X-Export-Row-Count": String(rows.length),
      },
    });
  } catch (error) {
    console.error("[staff-export]", error);
    if (error instanceof PocketBaseExportError) {
      const status = error.status === 403 ? 403 : error.status >= 500 ? 502 : 400;
      return jsonError(error.message, status);
    }
    return jsonError(error instanceof Error ? error.message : "Không thể tạo file Excel.", 500);
  }
}
