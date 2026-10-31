import { createFileRoute } from "@tanstack/react-router";
import {
  buildEmployeeHoursRanking,
  buildEmployeeSeniorityRanking,
  normalizeImportIdentity,
  parseEmployeeMonthlyHoursImport,
  type EmployeeMonthlyHoursRecord,
  type RankingHistory,
} from "@/lib/employee-monthly-hours";
import {
  companyTenant,
  requireCompanyAdmin,
} from "@/lib/company-limits-server";
import { escapePb, pbServerFetch, readPbJson } from "@/lib/tenant-server";

const MAX_IMPORT_ROWS = 5_000;
const MAX_PAGE_SIZE = 100;
const PB_PAGE_SIZE = 500;
const IMPORT_QUERY_CHUNK_SIZE = 50;

type ImportError = { rowNumber: number; reason: string };
type PreparedRow = {
  source: ReturnType<typeof parseEmployeeMonthlyHoursImport>["rows"][number];
  history: RankingHistory;
  existing?: EmployeeMonthlyHoursRecord;
};

function responseError(message: string, status = 400) {
  return Response.json({ message }, { status });
}

function isMonth(value: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function isIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return (
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3])
  );
}

function pageParams(url: URL) {
  const page = Math.max(1, Math.trunc(Number(url.searchParams.get("page")) || 1));
  const perPage = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.trunc(Number(url.searchParams.get("perPage")) || 50)),
  );
  return { page, perPage };
}

async function listAll<T>(
  token: string,
  collection: string,
  filter: string,
  options: { sort?: string; expand?: string } = {},
) {
  const items: T[] = [];
  let page = 1;
  while (true) {
    const query = new URLSearchParams({
      page: String(page),
      perPage: String(PB_PAGE_SIZE),
      filter,
      ...(options.sort ? { sort: options.sort } : {}),
      ...(options.expand ? { expand: options.expand } : {}),
    });
    const response = await pbServerFetch(
      `/api/collections/${encodeURIComponent(collection)}/records?${query}`,
      {},
      token,
    );
    const body = await readPbJson(response);
    if (!response.ok) throw new Error(body?.message || `Không đọc được dữ liệu ${collection}.`);
    items.push(...((body?.items || []) as T[]));
    const totalPages = Math.max(1, Number(body?.totalPages) || 1);
    if (page >= totalPages) break;
    page += 1;
  }
  return items;
}

async function createOrUpdate(
  token: string,
  id: string | undefined,
  payload: Record<string, unknown>,
) {
  const response = await pbServerFetch(
    `/api/collections/employee_monthly_hours/records${id ? `/${encodeURIComponent(id)}` : ""}`,
    {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    token,
  );
  const body = await readPbJson(response);
  if (!response.ok) {
    const fieldErrors = Object.entries(body?.data || {})
      .map(([field, detail]) => {
        const message = (detail as { message?: unknown })?.message;
        return message ? `${field}: ${String(message)}` : "";
      })
      .filter(Boolean)
      .join("; ");
    throw new Error(
      [body?.message || "Không lưu được số giờ của NLĐ.", fieldErrors]
        .filter(Boolean)
        .join(" "),
    );
  }
  if (!body?.id) throw new Error("PocketBase không trả về bản ghi đã lưu.");

  const verifyResponse = await pbServerFetch(
    `/api/collections/employee_monthly_hours/records/${encodeURIComponent(body.id)}`,
    {},
    token,
  );
  const verified = await readPbJson(verifyResponse);
  if (!verifyResponse.ok || verified?.id !== body.id) {
    throw new Error("PocketBase chưa xác nhận bản ghi số giờ đã được lưu.");
  }
  return body as EmployeeMonthlyHoursRecord;
}

function companyFilter(companyId: string) {
  return `tenant_company = "${escapePb(companyId)}"`;
}

function historyFactoryName(history: Record<string, any>) {
  return String(history.expand?.factory?.name || "").trim();
}

async function loadHistories(token: string, companyId: string) {
  const rows = await listAll<RankingHistory & { expand?: RankingHistory["expand"] }>(
    token,
    "employment_histories",
    companyFilter(companyId),
    { sort: "-join_date,-created", expand: "factory" },
  );
  return rows.map((history) => ({ ...history, factory_name: historyFactoryName(history) }));
}

function factoryOptions(histories: RankingHistory[]) {
  const byId = new Map<string, string>();
  for (const history of histories) {
    if (history.factory) byId.set(history.factory, history.factory_name || "Chưa rõ nhà máy");
  }
  return [...byId.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "vi", { sensitivity: "base" }));
}

async function getRanking(request: Request, token: string, companyId: string) {
  const url = new URL(request.url);
  const { page, perPage } = pageParams(url);
  const view = url.searchParams.get("view") || "hours";
  const histories = await loadHistories(token, companyId);
  let rows;

  if (view === "seniority") {
    const joinDateFrom = url.searchParams.get("joinDateFrom") || "";
    const joinDateTo = url.searchParams.get("joinDateTo") || "";
    if (joinDateFrom && !isIsoDate(joinDateFrom)) return responseError("Ngày bắt đầu không hợp lệ.");
    if (joinDateTo && !isIsoDate(joinDateTo)) return responseError("Ngày kết thúc không hợp lệ.");
    if (joinDateFrom && joinDateTo && joinDateFrom > joinDateTo) {
      return responseError("Ngày bắt đầu không thể sau ngày kết thúc.");
    }
    rows = buildEmployeeSeniorityRanking(histories, {
      factoryId: url.searchParams.get("factoryId") || "",
      joinDateFrom,
      joinDateTo,
    });
  } else {
    const monthFrom = url.searchParams.get("monthFrom") || "";
    const monthTo = url.searchParams.get("monthTo") || "";
    if (!isMonth(monthFrom) || !isMonth(monthTo)) {
      return responseError("Vui lòng chọn khoảng tháng hợp lệ.");
    }
    if (monthFrom > monthTo) return responseError("Tháng bắt đầu không thể sau tháng kết thúc.");
    const monthFilter = [
      companyFilter(companyId),
      `month >= "${monthFrom}"`,
      `month <= "${monthTo}"`,
    ].join(" && ");
    const records = await listAll<EmployeeMonthlyHoursRecord>(
      token,
      "employee_monthly_hours",
      monthFilter,
      { sort: "month" },
    );
    const metric = url.searchParams.get("metric");
    const status = url.searchParams.get("status");
    rows = buildEmployeeHoursRanking(records, histories, {
      monthFrom,
      monthTo,
      factoryId: url.searchParams.get("factoryId") || "",
      employeeCode: url.searchParams.get("employeeCode") || "",
      workerName: url.searchParams.get("workerName") || "",
      metric: metric === "hc" || metric === "tc" ? metric : "both",
      status: status === "working" || status === "left" ? status : "all",
    });
  }

  const totalItems = rows.length;
  return Response.json({
    items: rows.slice((page - 1) * perPage, page * perPage),
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / perPage)),
    page,
    perPage,
    factories: factoryOptions(histories),
  });
}

async function previewImport(
  inputRows: unknown,
  token: string,
  companyId: string,
  commit: boolean,
) {
  if (!Array.isArray(inputRows) || inputRows.length > MAX_IMPORT_ROWS) {
    return responseError(`File chỉ được có tối đa ${MAX_IMPORT_ROWS.toLocaleString("vi-VN")} dòng.`);
  }
  const parsed = parseEmployeeMonthlyHoursImport(inputRows as Record<string, unknown>[]);
  const errors: ImportError[] = [...parsed.errors];
  if (!parsed.rows.length) {
    return Response.json({ rows: [], errors, created: 0, updated: 0, failed: errors.length });
  }

  const uids = [...new Set(parsed.rows.map((row) => row.historyUid))];
  const historyMatches = new Map<string, RankingHistory[]>();
  for (let index = 0; index < uids.length; index += 100) {
    const chunk = uids.slice(index, index + 100);
    const uidFilter = chunk.map((uid) => `uid = "${escapePb(uid)}"`).join(" || ");
    const rows = await listAll<RankingHistory & { expand?: RankingHistory["expand"] }>(
      token,
      "employment_histories",
      `${companyFilter(companyId)} && (${uidFilter})`,
      { sort: "-join_date,-created", expand: "factory" },
    );
    for (const history of rows) {
      const key = String(history.uid || "");
      const matches = historyMatches.get(key) || [];
      matches.push({ ...history, factory_name: historyFactoryName(history) });
      historyMatches.set(key, matches);
    }
  }

  const candidates: PreparedRow[] = [];
  for (const row of parsed.rows) {
    const matches = historyMatches.get(row.historyUid) || [];
    if (matches.length !== 1) {
      errors.push({
        rowNumber: row.rowNumber,
        reason: matches.length
          ? `UID lịch sử "${row.historyUid}" không duy nhất trong công ty.`
          : `Không tìm thấy UID lịch sử "${row.historyUid}" trong công ty.`,
      });
      continue;
    }
    const history = matches[0];
    if (normalizeImportIdentity(row.employeeCode) !== normalizeImportIdentity(history.employee_code)) {
      errors.push({
        rowNumber: row.rowNumber,
        reason: `Mã NV không khớp với lịch sử ${row.historyUid}.`,
      });
      continue;
    }
    candidates.push({ source: row, history });
  }

  const historyIds = [...new Set(candidates.map((candidate) => candidate.history.id))];
  const months = candidates.map((candidate) => candidate.source.month).sort();
  const existingByKey = new Map<string, EmployeeMonthlyHoursRecord>();
  for (let index = 0; index < historyIds.length; index += IMPORT_QUERY_CHUNK_SIZE) {
    const chunk = historyIds.slice(index, index + IMPORT_QUERY_CHUNK_SIZE);
    const relationFilter = chunk
      .map((id) => `employment_history = "${escapePb(id)}"`)
      .join(" || ");
    const records = await listAll<EmployeeMonthlyHoursRecord>(
      token,
      "employee_monthly_hours",
      `${companyFilter(companyId)} && (${relationFilter}) && month >= "${months[0]}" && month <= "${months[months.length - 1]}"`,
    );
    for (const record of records) {
      existingByKey.set(`${record.employment_history}\u0000${record.month}`, record);
    }
  }

  for (const candidate of candidates) {
    candidate.existing = existingByKey.get(
      `${candidate.history.id}\u0000${candidate.source.month}`,
    );
  }

  if (!commit) {
    return Response.json({
      rows: candidates.map(({ source, existing }) => ({
        rowNumber: source.rowNumber,
        action: existing ? "update" : "create",
        previous: existing
          ? { regularHours: existing.regular_hours, overtimeHours: existing.overtime_hours }
          : undefined,
      })),
      errors,
      created: candidates.filter((candidate) => !candidate.existing).length,
      updated: candidates.filter((candidate) => Boolean(candidate.existing)).length,
      failed: errors.length,
    });
  }

  let created = 0;
  let updated = 0;
  for (const candidate of candidates) {
    const { source, history, existing } = candidate;
    try {
      await createOrUpdate(
        token,
        existing?.id,
        {
          tenant_company: companyId,
          employment_history: history.id,
          month: source.month,
          regular_hours: source.regularHours,
          overtime_hours: source.overtimeHours,
        },
      );
      if (existing) updated += 1;
      else created += 1;
    } catch (cause) {
      errors.push({
        rowNumber: source.rowNumber,
        reason: cause instanceof Error ? cause.message : "Không lưu được dòng dữ liệu.",
      });
    }
  }

  return Response.json({ rows: [], errors, created, updated, failed: errors.length });
}

export const Route = createFileRoute("/api/admin/employee-monthly-hours")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const context = await requireCompanyAdmin(request);
        if (!context) return responseError("Bạn không có quyền quản trị công ty.", 403);
        try {
          return await getRanking(request, context.token, companyTenant(context));
        } catch (cause) {
          return responseError(
            cause instanceof Error ? cause.message : "Không tải được bảng xếp hạng.",
            502,
          );
        }
      },
      POST: async ({ request }) => {
        try {
          const context = await requireCompanyAdmin(request);
          if (!context) return responseError("Bạn không có quyền quản trị công ty.", 403);
          const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
          if (body?.action !== "preview" && body?.action !== "commit") {
            return responseError("Yêu cầu nhập Excel không hợp lệ.");
          }
          return await previewImport(
            body.rows,
            context.token,
            companyTenant(context),
            body.action === "commit",
          );
        } catch (cause) {
          return responseError(
            cause instanceof Error ? cause.message : "Không thể xử lý file Excel.",
            502,
          );
        }
      },
    },
  },
});
