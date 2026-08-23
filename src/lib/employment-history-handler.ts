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

function error(message: string, status = 400) {
  return Response.json({ message }, { status });
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
  const ensureWorkerAccount = body?.action === "ensure_worker_account";
  const payload =
    body?.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
      ? ({ ...body.payload } as Record<string, unknown>)
      : null;
  const workerId = String(ensureWorkerAccount ? body?.worker : payload?.worker || payload?.user || "").trim();
  if (!workerId || (!ensureWorkerAccount && !payload)) {
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

  if (ensureWorkerAccount) {
    return Response.json({ worker: workerId });
  }

  const limit = Math.max(0, Math.trunc(Number(company?.max_employment_histories || 0)));
  const current = Number(histories?.totalItems || 0);
  if (limit > 0 && current >= limit) {
    return error(`Công ty đã đạt giới hạn ${limit} bản ghi lịch sử lao động.`, 409);
  }

  delete payload!.company;
  delete payload!.tenant_company;
  payload!.worker = workerId;
  delete payload!.user;
  payload!.tenant_company = companyId;

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
