import { createFileRoute } from "@tanstack/react-router";
import {
  CompanyLimitError,
  assertCompanyLimit,
  createCompanyRecord,
  requireCompanyAdmin,
  type CompanyLimitKind,
} from "@/lib/company-limits-server";
import { pbServerFetch, readPbJson } from "@/lib/tenant-server";

function error(message: string, status = 400) {
  return Response.json({ message }, { status });
}

const allowedKinds = new Set<CompanyLimitKind>([
  "factories",
  "recruitment_entities",
  "staff_accounts",
]);

function cleanPayload(kind: CompanyLimitKind, input: unknown) {
  const body = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  if (kind === "factories") {
    return {
      name: String(body.name || "")
        .trim()
        .slice(0, 200),
      code: String(body.code || "")
        .trim()
        .slice(0, 80),
      address: String(body.address || "")
        .trim()
        .slice(0, 500),
      hotline: String(body.hotline || "")
        .trim()
        .slice(0, 40),
      note: String(body.note || "")
        .trim()
        .slice(0, 1000),
      attendance_cutoff_day: Number(body.attendance_cutoff_day) || 31,
      advance_limit: Math.max(0, Number(body.advance_limit) || 0),
      status: body.status === "inactive" ? "inactive" : "active",
    };
  }
  if (kind === "recruitment_entities") {
    return {
      name: String(body.name || "")
        .trim()
        .slice(0, 200),
      address: String(body.address || "")
        .trim()
        .slice(0, 500),
      hotline: String(body.hotline || "")
        .trim()
        .slice(0, 40),
      note: String(body.note || "")
        .trim()
        .slice(0, 1000),
      status: body.status === "inactive" ? "inactive" : "active",
    };
  }
  return {
    username: String(body.username || "")
      .trim()
      .slice(0, 100),
    login_name: String(body.login_name || "")
      .trim()
      .slice(0, 60),
    uid: String(body.uid || "")
      .trim()
      .slice(0, 40),
    full_name: String(body.full_name || "")
      .trim()
      .slice(0, 120),
    phone: String(body.phone || "")
      .trim()
      .slice(0, 40),
    gender: String(body.gender || "")
      .trim()
      .slice(0, 20),
    cccd: String(body.cccd || "")
      .trim()
      .slice(0, 30),
    date_of_birth: body.date_of_birth || undefined,
    address: String(body.address || "")
      .trim()
      .slice(0, 500),
    bank_name: String(body.bank_name || "")
      .trim()
      .slice(0, 120),
    bank_account_number: String(body.bank_account_number || "")
      .trim()
      .slice(0, 60),
    bank_account_name: String(body.bank_account_name || "")
      .trim()
      .slice(0, 160),
    bank_account_note: String(body.bank_account_note || "")
      .trim()
      .slice(0, 500),
    password: String(body.password || ""),
    passwordConfirm: String(body.passwordConfirm || body.password || ""),
    role: "staff",
    status: "active",
    must_change_password: true,
    emailVisibility: false,
  };
}

export const Route = createFileRoute("/api/admin/company-records")({
  server: {
    handlers: {
      PATCH: async ({ request }) => {
        const context = await requireCompanyAdmin(request);
        if (!context) return error("Bạn không có quyền quản trị công ty.", 403);
        const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
        const userId = String(body?.userId || "").trim();
        const role = String(body?.role || "").trim();
        const status = String(body?.status || "").trim();
        const hasRole = Boolean(role);
        const hasStatus = Boolean(status);
        if (!userId || (!hasRole && !hasStatus))
          return error("Thông tin cập nhật không hợp lệ.");
        if (hasRole && !["user", "staff", "admin"].includes(role))
          return error("Thông tin phân quyền không hợp lệ.");
        if (hasStatus && !["active", "disabled"].includes(status))
          return error("Trạng thái tài khoản không hợp lệ.");
        const currentResponse = await pbServerFetch(
          `/api/collections/users/records/${encodeURIComponent(userId)}?fields=id,tenant_company,role,status`,
          {},
          context.token,
        );
        const current = await readPbJson(currentResponse);
        if (!currentResponse.ok || current?.tenant_company !== context.company.id)
          return error("Tài khoản không thuộc công ty hiện tại.", 403);
        const entersStaffGroup = hasRole && ["staff", "admin"].includes(role);
        const wasInStaffGroup = ["staff", "admin"].includes(String(current.role));
        if (entersStaffGroup && !wasInStaffGroup) {
          try {
            await assertCompanyLimit(context, "staff_accounts");
          } catch (cause) {
            const message =
              cause instanceof Error ? cause.message : "Không kiểm tra được hạn mức nhân viên.";
            return error(message, cause instanceof CompanyLimitError ? cause.status : 502);
          }
        }
        const payload: Record<string, unknown> = {};
        if (hasRole) payload.role = role;
        if (hasStatus) payload.status = status;
        const response = await pbServerFetch(
          `/api/collections/users/records/${encodeURIComponent(userId)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
          context.token,
        );
        const record = await readPbJson(response);
        return response.ok
          ? Response.json(record)
          : error(record?.message || "Không cập nhật được tài khoản.", response.status);
      },
      POST: async ({ request }) => {
        const context = await requireCompanyAdmin(request);
        if (!context) return error("Bạn không có quyền quản trị công ty.", 403);
        const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
        const kind = body?.kind as CompanyLimitKind;
        if (!allowedKinds.has(kind)) return error("Loại dữ liệu không hợp lệ.");
        const payload = cleanPayload(kind, body?.payload);
        if (kind !== "staff_accounts" && !String(payload.name || ""))
          return error("Tên dữ liệu không được để trống.");
        if (
          kind === "staff_accounts" &&
          (!payload.username || !payload.full_name || String(payload.password).length < 8)
        )
          return error("Nhập đủ tên đăng nhập, họ tên và mật khẩu tối thiểu 8 ký tự.");
        try {
          const record = await createCompanyRecord(context, kind, payload);
          return Response.json(record, { status: 201 });
        } catch (cause: unknown) {
          const message = cause instanceof Error ? cause.message : "Không tạo được dữ liệu.";
          return error(message, cause instanceof CompanyLimitError ? cause.status : 400);
        }
      },
    },
  },
});
