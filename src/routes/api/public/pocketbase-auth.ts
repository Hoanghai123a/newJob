import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { buildTechnicalUsername, companyCodeKey, normalizeLoginName } from "@/lib/login-identity";
import { getPBUpstream } from "@/lib/pocketbase-config";
import { escapePb, getPocketBaseAdminToken, pbServerFetch, readPbJson } from "@/lib/tenant-server";

const LoginSchema = z.object({
  identity: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(200),
  companyCode: z.string().max(40).optional(),
  superAdmin: z.boolean().optional(),
});

const LOGIN_ROLES = new Set(["super_admin", "admin", "staff"]);

async function readPocketBaseAuthResponse(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  return contentType.includes("application/json")
    ? await response.json().catch(() => ({ message: "Backend trả về dữ liệu không hợp lệ." }))
    : {
        message:
          response.status >= 500
            ? "Backend chấm công đang offline. Vui lòng thử lại."
            : "Backend trả về dữ liệu không hợp lệ.",
      };
}

async function findActiveCompany(code: string) {
  const adminToken = await getPocketBaseAdminToken();
  if (!adminToken)
    return { error: { status: 424, message: "Máy chủ chưa cấu hình quản lý công ty." } };
  const response = await pbServerFetch(
    "/api/collections/companies/records?perPage=200&fields=id,code,name,status",
    {},
    adminToken,
  );
  const body = await readPbJson(response);
  if (!response.ok) return { error: { status: 502, message: "Không thể kiểm tra mã công ty." } };
  const codeKey = companyCodeKey(code);
  const company = (body?.items || []).find((item: any) => companyCodeKey(item?.code) === codeKey);
  if (!company || company.status !== "active")
    return {
      error: { status: 403, message: "Mã công ty không hợp lệ hoặc công ty không hoạt động." },
    };
  return { company };
}

async function authWithPassword(identity: string, password: string) {
  const response = await fetch(`${getPBUpstream()}/api/collections/users/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "true" },
    body: JSON.stringify({ identity, password }),
  });
  return { response, body: await readPocketBaseAuthResponse(response) };
}

function updateLastLogin(token: string, recordId: string) {
  fetch(`${getPBUpstream()}/api/collections/users/records/${recordId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "ngrok-skip-browser-warning": "true",
    },
    body: JSON.stringify({ last_login: new Date().toISOString() }),
  }).catch(() => {});
}

function deny(message: string, status = 403) {
  return Response.json({ message }, { status });
}

export const Route = createFileRoute("/api/public/pocketbase-auth")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = LoginSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return deny("Thiếu thông tin đăng nhập.", 400);

        try {
          const { identity, password, superAdmin } = parsed.data;
          let authIdentity: string;
          let companyId = "";

          if (superAdmin) {
            authIdentity = identity;
          } else {
            const companyCode = parsed.data.companyCode;
            if (!companyCode) return deny("Vui lòng nhập mã công ty.", 400);
            const result = await findActiveCompany(companyCode);
            if ("error" in result) return deny(result.error.message, result.error.status);
            companyId = result.company.id;
            authIdentity = buildTechnicalUsername(
              result.company.code,
              normalizeLoginName(identity),
            );
          }

          const result = await authWithPassword(authIdentity, password);
          if (!result.response.ok)
            return Response.json(result.body, { status: result.response.status });
          const record = result.body?.record;
          if (!LOGIN_ROLES.has(String(record?.role || "")))
            return deny("Tài khoản này không được phép đăng nhập hệ thống quản trị.");
          if (superAdmin ? record?.role !== "super_admin" : record?.role === "super_admin")
            return deny(
              superAdmin
                ? "Tài khoản này không phải Quản trị hệ thống."
                : "Hãy chọn mục Quản trị hệ thống để đăng nhập.",
            );
          if (!superAdmin && record?.tenant_company !== companyId)
            return deny("Tài khoản không thuộc công ty đã chọn.");
          if (record?.status === "disabled")
            return deny("Tài khoản đã bị khóa và không thể đăng nhập.");
          if (result.body?.token && record?.id) updateLastLogin(result.body.token, record.id);
          return Response.json(result.body);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Không kết nối được máy chủ backend.";
          return deny(message, 502);
        }
      },
    },
  },
});
