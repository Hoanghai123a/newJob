import { createFileRoute } from "@tanstack/react-router";

import { getPBUpstream } from "@/lib/pocketbase-config";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
  "Access-Control-Max-Age": "86400",
};

const WRITE_METHODS = new Set(["POST", "PATCH", "PUT"]);
const COMPACT_FIELDS = new Set([
  "employee_code",
  "phone",
  "cccd",
  "cccd_number",
  "worker_cccd_snapshot",
  "bank_account_number",
]);
const NAME_FIELDS = new Set(["full_name", "worker_name_snapshot"]);

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, "");
}

function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeBankAccountName(value: string) {
  return normalizeName(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u0111\u0110]/g, "D")
    .toUpperCase();
}

function normalizeFieldValue(field: string, value: unknown) {
  if (typeof value !== "string") return value;
  if (COMPACT_FIELDS.has(field)) return compactWhitespace(value);
  if (NAME_FIELDS.has(field)) return normalizeName(value);
  if (field === "bank_account_name") return normalizeBankAccountName(value);
  return value;
}

function normalizeRecordPayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;

  return Object.fromEntries(
    Object.entries(payload).map(([field, value]) => [field, normalizeFieldValue(field, value)]),
  );
}

function normalizeFormData(formData: FormData) {
  const normalized = new FormData();
  for (const [field, value] of formData.entries()) {
    normalized.append(field, normalizeFieldValue(field, value) as FormDataEntryValue);
  }
  return normalized;
}

async function prepareRequestBody(
  request: Request,
  headers: Headers,
): Promise<BodyInit | undefined> {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return undefined;

  const contentType = request.headers.get("content-type")?.toLowerCase() || "";
  if (WRITE_METHODS.has(request.method) && contentType.includes("application/json")) {
    try {
      const payload = await request.clone().json();
      return JSON.stringify(normalizeRecordPayload(payload));
    } catch {
      // Keep invalid JSON untouched so PocketBase can return its original validation error.
    }
  }

  if (WRITE_METHODS.has(request.method) && contentType.includes("multipart/form-data")) {
    try {
      const formData = await request.clone().formData();
      headers.delete("Content-Type");
      return normalizeFormData(formData);
    } catch {
      // Keep unsupported multipart payloads untouched.
    }
  }

  return request.arrayBuffer();
}

async function proxy(request: Request, splat: string | undefined) {
  const incoming = new URL(request.url);
  const target = `${getPBUpstream()}/${splat ?? ""}${incoming.search}`;

  const headers = new Headers();
  const auth = request.headers.get("authorization");
  if (auth) headers.set("Authorization", auth);
  const ct = request.headers.get("content-type");
  if (ct) headers.set("Content-Type", ct);
  headers.set("ngrok-skip-browser-warning", "true");

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: "manual",
  };
  init.body = await prepareRequestBody(request, headers);

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ code: 502, message: `Upstream fetch failed: ${message}`, data: {} }),
      { status: 502, headers: { "Content-Type": "application/json", ...CORS } },
    );
  }

  const respHeaders = new Headers(upstream.headers);
  for (const [k, v] of Object.entries(CORS)) respHeaders.set(k, v);
  respHeaders.delete("content-encoding");
  respHeaders.delete("content-length");

  const contentType = upstream.headers.get("content-type") || "";
  if (contentType.includes("text/event-stream")) {
    respHeaders.set("Cache-Control", "no-cache, no-transform");
    respHeaders.set("X-Accel-Buffering", "no");
    respHeaders.delete("connection");
  }
  if (upstream.status >= 500 && !contentType.includes("application/json")) {
    return new Response(
      JSON.stringify({
        code: 502,
        message:
          "Backend ch\u1ea5m c\u00f4ng \u0111ang offline. Vui l\u00f2ng b\u1eadt l\u1ea1i PocketBase/ngrok r\u1ed3i th\u1eed l\u1ea1i.",
        data: {},
      }),
      { status: 502, headers: { "Content-Type": "application/json", ...CORS } },
    );
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}

export const Route = createFileRoute("/api/public/pb/$")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request, params }) => proxy(request, params._splat),
      POST: async ({ request, params }) => proxy(request, params._splat),
      PATCH: async ({ request, params }) => proxy(request, params._splat),
      PUT: async ({ request, params }) => proxy(request, params._splat),
      DELETE: async ({ request, params }) => proxy(request, params._splat),
    },
  },
});
