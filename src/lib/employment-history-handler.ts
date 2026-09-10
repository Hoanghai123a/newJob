export type EmploymentHistoryAuth = {
  token: string;
  user: {
    id: string;
    role?: string;
    tenant_company?: string;
  };
};

export type EmploymentHistoryHandlerDeps = {
  getAuth: (request: Request) => Promise<EmploymentHistoryAuth | null>;
  getAdminToken: () => Promise<string>;
  pbFetch: (path: string, init?: RequestInit, token?: string) => Promise<Response>;
  readJson: (response: Response) => Promise<any>;
  escapeFilterValue: (value: string) => string;
};

export type EmploymentHistoryCreateMode = "standard" | "report_join";

function error(message: string, status = 400) {
  return Response.json({ message }, { status });
}

const STANDARD_REQUIRED_FIELDS = [
  ["worker_name_snapshot", "họ tên"],
  ["worker_cccd_snapshot", "CCCD"],
  ["worker_date_of_birth_snapshot", "ngày sinh"],
  ["worker_address_snapshot", "địa chỉ thường trú"],
  ["cccd_issue_date", "ngày cấp CCCD"],
] as const;

function validateStandardPayload(payload: Record<string, unknown>) {
  const missing = STANDARD_REQUIRED_FIELDS.filter(
    ([field]) => !String(payload[field] ?? "").trim(),
  ).map(([, label]) => label);
  if (missing.length) return `Thiếu thông tin cá nhân của lịch sử đi làm: ${missing.join(", ")}.`;
  const cccd = String(payload.worker_cccd_snapshot ?? "").replace(/\D/g, "");
  if (![9, 12].includes(cccd.length)) return "Số CMND/CCCD phải có đúng 9 hoặc 12 chữ số.";
  return "";
}

export async function handleCreateEmploymentHistory(
  request: Request,
  deps: EmploymentHistoryHandlerDeps,
) {
  const auth = await deps.getAuth(request);
  if (!auth) return error("Phiên đăng nhập không hợp lệ.", 401);
  if (auth.user.role !== "admin" && auth.user.role !== "staff") {
    return error("Tài khoản không có quyền tạo lịch sử đi làm.", 403);
  }

  const companyId = auth.user.tenant_company || "";
  if (!companyId) return error("Tài khoản chưa được gán công ty hợp lệ.", 403);

  const body = await request.json().catch(() => null);
  const mode: EmploymentHistoryCreateMode =
    body?.mode === "report_join" ? "report_join" : "standard";
  if (body?.mode && body.mode !== "report_join" && body.mode !== "standard") {
    return error("Chế độ tạo lịch sử lao động không hợp lệ.");
  }
  const payload =
    body?.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
      ? ({ ...body.payload } as Record<string, unknown>)
      : null;
  const workerId = String(payload?.worker || "").trim();
  if (!workerId || !payload) {
    return error("Dữ liệu lịch sử lao động không hợp lệ.");
  }

  const token = await deps.getAdminToken();
  if (!token) return error("Không kết nối được PocketBase.", 502);

  const escapedCompanyId = deps.escapeFilterValue(companyId);
  const [workerResponse, companyResponse, historyResponse] = await Promise.all([
    deps.pbFetch(
      `/api/collections/workers/records/${encodeURIComponent(workerId)}?fields=id,tenant_company,uid,phone,full_name`,
      {},
      token,
    ),
    deps.pbFetch(
      `/api/collections/companies/records/${encodeURIComponent(companyId)}?fields=id,code,max_employment_histories`,
      {},
      token,
    ),
    deps.pbFetch(
      `/api/collections/employment_histories/records?page=1&perPage=1&skipTotal=0&filter=${encodeURIComponent(`tenant_company = "${escapedCompanyId}"`)}&fields=id`,
      {},
      token,
    ),
  ]);
  const [worker, company, histories] = await Promise.all([
    deps.readJson(workerResponse),
    deps.readJson(companyResponse),
    deps.readJson(historyResponse),
  ]);

  if (!workerResponse.ok || worker?.tenant_company !== companyId) {
    return error("Người lao động không thuộc công ty hiện tại.", 403);
  }
  if (!companyResponse.ok || !historyResponse.ok) {
    return error(
      company?.message || histories?.message || "Không kiểm tra được hạn mức lịch sử lao động.",
      502,
    );
  }

  const limit = Math.max(0, Math.trunc(Number(company?.max_employment_histories || 0)));
  const current = Number(histories?.totalItems || 0);
  if (limit > 0 && current >= limit) {
    return error(`Công ty đã đạt giới hạn ${limit} bản ghi lịch sử lao động.`, 409);
  }

  if (mode === "standard") {
    const validationError = validateStandardPayload(payload);
    if (validationError) return error(validationError);
  }

  // Fetch tất cả lịch sử của worker để tính thâm niên tích lũy
  const escapedWorkerId = deps.escapeFilterValue(workerId);
  const workerHistoriesResponse = await deps.pbFetch(
    `/api/collections/employment_histories/records?filter=${encodeURIComponent(`worker = "${escapedWorkerId}"`)}&sort=join_date,created&fields=id,worker,join_date,leave_date`,
    {},
    token,
  );
  const workerHistoriesData = await deps.readJson(workerHistoriesResponse);
  const workerHistories =
    workerHistoriesResponse.ok && Array.isArray(workerHistoriesData?.items)
      ? workerHistoriesData.items
      : [];

  delete payload!.company;
  delete payload!.tenant_company;
  payload!.worker = workerId;
  payload!.tenant_company = companyId;

  // Tính thâm niên tích lũy
  if (payload!.join_date) {
    const { calculateAccumulatedSeniority } = await import("./employment.ts");
    payload!.accumulated_seniority_days = calculateAccumulatedSeniority(
      workerId,
      String(payload!.join_date),
      workerHistories,
    );
  }

  const response = await deps.pbFetch(
    "/api/collections/employment_histories/records",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    token,
  );
  const record = await deps.readJson(response);
  return response.ok
    ? Response.json(record, { status: 201 })
    : error(record?.message || "Không tạo được lịch sử lao động.", response.status);
}
