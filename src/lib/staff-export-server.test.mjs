import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import * as XLSX from "xlsx";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const vite = await createServer({
  configFile: false,
  root: repoRoot,
  resolve: {
    alias: {
      "@": path.join(repoRoot, "src"),
    },
  },
  server: { middlewareMode: true },
});
const { buildStaffHistoryExportFilename, handleStaffExcelExport } = await vite.ssrLoadModule(
  "/src/lib/staff-export-server.ts",
);

const originalAdminToken = process.env.PB_ADMIN_TOKEN;
process.env.PB_ADMIN_TOKEN = "test-admin-token";

test.after(async () => {
  if (originalAdminToken === undefined) delete process.env.PB_ADMIN_TOKEN;
  else process.env.PB_ADMIN_TOKEN = originalAdminToken;
  await vite.close();
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function exportRequest(mode) {
  return new Request("http://localhost/api/staff/export", {
    method: "POST",
    headers: { Authorization: "Bearer user-token", "Content-Type": "application/json" },
    body: JSON.stringify({
      factoryIds: ["factory-1"],
      mode,
      status: "all",
      historyFromDate: "2026-04-29",
    }),
  });
}

async function runExport(mode, histories) {
  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    requests.push(url);

    if (url.pathname.endsWith("/users/auth-refresh")) {
      return jsonResponse({
        record: { id: "admin-1", role: "admin", tenant_company: "company-1" },
      });
    }

    if (url.pathname.endsWith("/companies/records/company-1")) {
      return jsonResponse({ id: "company-1", code: "abc" });
    }

    if (url.pathname.endsWith("/employment_histories/records")) {
      return jsonResponse({ page: 1, totalPages: 1, items: histories });
    }

    throw new Error(`Unexpected PocketBase request: ${url} ${init?.method || "GET"}`);
  };

  try {
    const response = await handleStaffExcelExport(exportRequest(mode));
    return { response, requests };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function historyFixture(overrides = {}) {
  return {
    id: "history-1",
    worker: "worker-1",
    factory: "factory-1",
    join_date: "2026-05-01T00:00:00.000Z",
    accumulated_seniority_days: 123,
    worker_name_snapshot: "Nguyen Van A",
    expand: {
      worker: { full_name: "Nguyen Van A", uid: "USR-001" },
      factory: { name: "Nha may 1" },
    },
    ...overrides,
  };
}

test("xuat day du chi tai employment_histories mot lan va dung tham nien tu PocketBase", async () => {
  const histories = [
    historyFixture(),
    historyFixture({
      id: "history-2",
      worker: "worker-2",
      accumulated_seniority_days: 456,
      worker_name_snapshot: "Tran Thi B",
      expand: {
        worker: { full_name: "Tran Thi B", uid: "USR-002" },
        factory: { name: "Nha may 1" },
      },
    }),
  ];

  const { response, requests } = await runExport("full", histories);

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-disposition") || "",
    /^attachment; filename="ABC_Lich_su_NLD_\d{8}_\d{6}\.xlsx"$/,
  );
  assert.equal(
    requests.filter((url) => url.pathname.endsWith("/employment_histories/records")).length,
    1,
  );

  const workbook = XLSX.read(await response.arrayBuffer(), { type: "array" });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets["Lao động đầy đủ"]);
  assert.deepEqual(
    rows.map((row) => row["Thâm niên tích luỹ (ngày)"]),
    [123, 456],
  );
});

test("xuat co ban dung tham nien da luu va mac dinh 0 khi PocketBase khong co gia tri", async () => {
  const { response } = await runExport("basic", [
    historyFixture({ accumulated_seniority_days: undefined }),
  ]);

  assert.equal(response.status, 200);
  const workbook = XLSX.read(await response.arrayBuffer(), { type: "array" });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets["Lao động cơ bản"]);
  assert.equal(rows[0]?.["Thâm niên tích luỹ (ngày)"], 0);
});

test("tao dung ten file theo ma cong ty va timestamp", () => {
  const date = new Date(2026, 8, 9, 15, 4, 6);
  assert.equal(
    buildStaffHistoryExportFilename("Công ty A", date),
    "C_NG_TY_A_Lich_su_NLD_20260909_150406.xlsx",
  );
});
