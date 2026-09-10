import assert from "node:assert/strict";
import test from "node:test";

const { handleCreateEmploymentHistory } = await import("./employment-history-handler.ts");

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeDeps(overrides: Partial<Parameters<typeof handleCreateEmploymentHistory>[1]> = {}) {
  const calls: Array<{ path: string; init?: RequestInit; token?: string }> = [];
  const deps = {
    getAuth: async () => ({
      token: "user-token",
      user: { id: "staff-1", role: "staff", tenant_company: "company-1" },
    }),
    getAdminToken: async () => "admin-token",
    pbFetch: async (path: string, init?: RequestInit, token?: string) => {
      calls.push({ path, init, token });
      if (path.includes("/workers/records/"))
        return jsonResponse({
          id: "worker-1",
          auth_user: "auth-worker-1",
          tenant_company: "company-1",
        });
      if (path.includes("/companies/records/"))
        return jsonResponse({ id: "company-1", max_employment_histories: 0 });
      if (path.includes("employment_histories/records?page="))
        return jsonResponse({ totalItems: 0 });
      return jsonResponse({ id: "history-1" }, 201);
    },
    readJson: async (response: Response) => response.json(),
    escapeFilterValue: (value: string) => value.replace(/"/g, '\\"'),
    ...overrides,
  };
  return { deps, calls };
}

function request(payload: unknown) {
  return new Request("http://localhost/api/employment-histories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

test("từ chối khi thiếu phiên đăng nhập", async () => {
  const { deps } = makeDeps({ getAuth: async () => null });
  const response = await handleCreateEmploymentHistory(
    request({ payload: { worker: "worker-1" } }),
    deps,
  );
  assert.equal(response.status, 401);
});

test("từ chối khi tài khoản chưa thuộc công ty", async () => {
  const { deps } = makeDeps({
    getAuth: async () => ({ token: "token", user: { id: "staff-1", role: "staff" } }),
  });
  const response = await handleCreateEmploymentHistory(
    request({ payload: { worker: "worker-1" } }),
    deps,
  );
  assert.equal(response.status, 403);
});

test("từ chối NLĐ thuộc công ty khác", async () => {
  const { deps } = makeDeps({
    pbFetch: async (path: string) => {
      if (path.includes("/workers/records/"))
        return jsonResponse({
          id: "worker-1",
          auth_user: "auth-worker-1",
          tenant_company: "company-2",
        });
      return jsonResponse({});
    },
  });
  const response = await handleCreateEmploymentHistory(
    request({ payload: { worker: "worker-1" } }),
    deps,
  );
  assert.equal(response.status, 403);
});

test("bỏ tenant giả mạo và luôn gán tenant từ phiên đăng nhập", async () => {
  const { deps, calls } = makeDeps();
  const response = await handleCreateEmploymentHistory(
    request({
      payload: {
        worker: "worker-1",
        tenant_company: "forged",
        company: "forged",
        factory: "factory-1",
        worker_name_snapshot: "Nguyễn Văn A",
        worker_cccd_snapshot: "001234567890",
        worker_date_of_birth_snapshot: "1990-01-01",
        worker_address_snapshot: "Hà Nội",
        cccd_issue_date: "2020-01-01",
      },
    }),
    deps,
  );
  assert.equal(response.status, 201);
  const create = calls.find(
    (call) => call.path === "/api/collections/employment_histories/records",
  );
  assert.ok(create?.init?.body);
  assert.deepEqual(JSON.parse(String(create.init.body)), {
    worker: "worker-1",
    factory: "factory-1",
    worker_name_snapshot: "Nguyễn Văn A",
    worker_cccd_snapshot: "001234567890",
    worker_date_of_birth_snapshot: "1990-01-01",
    worker_address_snapshot: "Hà Nội",
    cccd_issue_date: "2020-01-01",
    tenant_company: "company-1",
  });
});

test("report_join chấp nhận snapshot và CCCD bị thiếu", async () => {
  const { deps, calls } = makeDeps();
  const response = await handleCreateEmploymentHistory(
    request({ mode: "report_join", payload: { worker: "worker-1", factory: "factory-1" } }),
    deps,
  );
  assert.equal(response.status, 201);
  const create = calls.find(
    (call) => call.path === "/api/collections/employment_histories/records",
  );
  assert.deepEqual(JSON.parse(String(create?.init?.body)), {
    worker: "worker-1",
    factory: "factory-1",
    tenant_company: "company-1",
  });
});

test("mode chuẩn vẫn từ chối snapshot thiếu", async () => {
  const { deps } = makeDeps();
  const response = await handleCreateEmploymentHistory(
    request({ payload: { worker: "worker-1", factory: "factory-1" } }),
    deps,
  );
  assert.equal(response.status, 400);
});
