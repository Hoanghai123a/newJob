import { createFileRoute } from "@tanstack/react-router";
import {
  buildTechnicalUsername,
  companyCodeKey,
  isSupportedCompanyCode,
  loginNameFromUsername,
  normalizeCompanyCode,
  normalizeLoginName,
} from "@/lib/login-identity";
import {
  escapePb,
  getPocketBaseAdminToken,
  getServerAuthUser,
  pbServerFetch,
  readPbJson,
} from "@/lib/tenant-server";

function error(message: string, status = 400) {
  return Response.json({ message }, { status });
}

async function context(request: Request) {
  const auth = await getServerAuthUser(request);
  if (!auth || auth.user.role !== "super_admin") return null;
  const adminToken = await getPocketBaseAdminToken();
  return adminToken ? { adminToken } : null;
}

async function historyCount(adminToken: string, companyId: string) {
  const response = await pbServerFetch(
    `/api/collections/employment_histories/records?page=1&perPage=1&skipTotal=0&filter=${encodeURIComponent(`tenant_company = "${escapePb(companyId)}"`)}&fields=id`,
    {},
    adminToken,
  );
  const body = await readPbJson(response);
  if (!response.ok) throw new Error(body?.message || "Không kiểm tra được lịch sử lao động.");
  return Number(body?.totalItems || 0);
}

async function companyUsage(adminToken: string, companyId: string) {
  const tenant = escapePb(companyId);
  const [staffAccounts, factories, recruitmentEntities, workers, accounts] = await Promise.all([
    count(
      adminToken,
      "users",
      `tenant_company = "${tenant}" && (role = "staff" || role = "admin")`,
    ),
    count(adminToken, "factories", `tenant_company = "${tenant}"`),
    count(adminToken, "recruitment_entities", `tenant_company = "${tenant}"`),
    count(adminToken, "users", `tenant_company = "${tenant}" && role = "user"`),
    count(adminToken, "users", `tenant_company = "${tenant}"`),
  ]);
  return { staffAccounts, factories, recruitmentEntities, workers, accounts };
}

async function count(adminToken: string, collection: string, filter: string) {
  const response = await pbServerFetch(
    `/api/collections/${collection}/records?page=1&perPage=1&skipTotal=0&filter=${encodeURIComponent(filter)}&fields=id`,
    {},
    adminToken,
  );
  const body = await readPbJson(response);
  if (!response.ok) throw new Error(body?.message || `Không kiểm tra được dữ liệu ${collection}.`);
  return Number(body?.totalItems || 0);
}

async function updateCompanyIdentity(
  adminToken: string,
  companyId: string,
  name: string | undefined,
  code: string,
) {
  const [companiesResponse, usersResponse] = await Promise.all([
    pbServerFetch("/api/collections/companies/records?perPage=200&fields=id,code", {}, adminToken),
    pbServerFetch(
      `/api/collections/users/records?perPage=500&filter=${encodeURIComponent(`tenant_company = "${escapePb(companyId)}"`)}&fields=id,username,login_name,role`,
      {},
      adminToken,
    ),
  ]);
  const companies = await readPbJson(companiesResponse);
  const users = await readPbJson(usersResponse);
  if (!companiesResponse.ok || !usersResponse.ok) {
    throw new Error("Không thể kiểm tra dữ liệu trước khi đổi mã công ty.");
  }

  const codeKey = companyCodeKey(code);
  if (
    (companies?.items || []).some(
      (item: any) => item.id !== companyId && companyCodeKey(item.code) === codeKey,
    )
  ) {
    throw new Error("Mã công ty đã tồn tại.");
  }

  const accountChanges = (users?.items || [])
    .filter((user: any) => user.role !== "super_admin")
    .map((user: any) => {
      const loginName = normalizeLoginName(user.login_name || loginNameFromUsername(user.username));
      if (!/^[a-z0-9_.]{4,30}$/.test(loginName)) {
        throw new Error(`Tài khoản ${user.username || user.id} chưa có tên đăng nhập hợp lệ.`);
      }
      return {
        id: user.id,
        username: buildTechnicalUsername(code, loginName),
        login_name: loginName,
      };
    });

  const changeIds = new Set(accountChanges.map((item: any) => item.id));
  const usernames = new Set(accountChanges.map((item: any) => item.username));
  if (usernames.size !== accountChanges.length)
    throw new Error("Mã công ty mới tạo username bị trùng.");

  const allUsersResponse = await pbServerFetch(
    "/api/collections/users/records?perPage=500&fields=id,username",
    {},
    adminToken,
  );
  const allUsers = await readPbJson(allUsersResponse);
  if (!allUsersResponse.ok) throw new Error("Không thể kiểm tra trùng tên đăng nhập.");
  const conflicts = (allUsers?.items || []).find(
    (user: any) => !changeIds.has(user.id) && usernames.has(normalizeLoginName(user.username)),
  );
  if (conflicts)
    throw new Error("Mã công ty mới làm trùng tên đăng nhập kỹ thuật với công ty khác.");

  const requests = [
    ...accountChanges.map((item: any) => ({
      method: "PATCH",
      url: `/api/collections/users/records/${item.id}`,
      body: { username: item.username, login_name: item.login_name },
    })),
    {
      method: "PATCH",
      url: `/api/collections/companies/records/${companyId}`,
      body: { ...(name !== undefined ? { name } : {}), code },
    },
  ];
  const response = await pbServerFetch(
    "/api/batch",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requests }),
    },
    adminToken,
  );
  const body = await readPbJson(response);
  if (!response.ok) throw new Error(body?.message || "Không thể cập nhật mã công ty và tài khoản.");
  return body?.[body.length - 1]?.body || { id: companyId, name, code };
}

export const Route = createFileRoute("/api/super-admin/companies/$companyId")({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        const ctx = await context(request);
        if (!ctx) return error("Bạn không có quyền quản trị tối cao.", 403);
        const body = await request.json().catch(() => null);
        const allowed = [
          "name",
          "code",
          "status",
          "address",
          "hotline",
          "email",
          "max_accounts",
          "max_workers",
          "max_factories",
          "max_file_bytes",
          "max_employment_histories",
          "max_recruitment_entities",
          "max_staff_accounts",
        ];
        const payload = Object.fromEntries(
          Object.entries(body || {}).filter(([key]) => allowed.includes(key)),
        );
        if (payload.status && !["active", "suspended", "closed"].includes(String(payload.status)))
          return error("Trạng thái công ty không hợp lệ.");
        if (payload.name !== undefined) {
          payload.name = String(payload.name).trim().slice(0, 200);
          if (!payload.name) return error("Tên công ty không được để trống.");
        }
        if (payload.code !== undefined) {
          payload.code = normalizeCompanyCode(String(payload.code));
          if (!payload.code || !isSupportedCompanyCode(String(payload.code)))
            return error("Mã công ty chỉ gồm chữ, số, dấu chấm hoặc gạch dưới.");
          try {
            const record = await updateCompanyIdentity(
              ctx.adminToken,
              params.companyId,
              payload.name as string | undefined,
              payload.code as string,
            );
            return Response.json(record);
          } catch (cause) {
            return error(
              cause instanceof Error ? cause.message : "Không cập nhật được công ty.",
              409,
            );
          }
        }
        const limitSpecs = [
          ["max_accounts", "tài khoản", "accounts"],
          ["max_workers", "lao động", "workers"],
          ["max_factories", "nhà máy", "factories"],
          ["max_recruitment_entities", "Nhà chính/Đối tác", "recruitment_entities"],
          ["max_staff_accounts", "nhân viên quản lý", "staff_accounts"],
          ["max_employment_histories", "lịch sử lao động", "employment_histories"],
          ["max_file_bytes", "dung lượng tệp", "file_bytes"],
        ] as const;
        const hasLimitUpdate = limitSpecs.some(([field]) => payload[field] !== undefined);
        if (hasLimitUpdate) {
          try {
            const usage = await companyUsage(ctx.adminToken, params.companyId);
            for (const [field, label, usageKey] of limitSpecs) {
              if (payload[field] === undefined) continue;
              const limit = Number(payload[field]);
              if (!Number.isSafeInteger(limit) || limit < 0)
                return error(`Giới hạn ${label} phải là số nguyên không âm.`);
              const actual =
                usageKey === "employment_histories"
                  ? await historyCount(ctx.adminToken, params.companyId)
                  : usageKey === "file_bytes"
                    ? 0
                    : usageKey === "staff_accounts"
                      ? usage.staffAccounts
                      : usageKey === "recruitment_entities"
                        ? usage.recruitmentEntities
                        : usage[usageKey];
              if (limit > 0 && limit < actual)
                return error(`Giới hạn ${label} không được thấp hơn ${actual} bản ghi hiện có.`);
              payload[field] = limit;
            }
          } catch (cause) {
            return error(
              cause instanceof Error ? cause.message : "Không kiểm tra được hạn mức.",
              502,
            );
          }
        }
        const response = await pbServerFetch(
          `/api/collections/companies/records/${encodeURIComponent(params.companyId)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
          ctx.adminToken,
        );
        const record = await readPbJson(response);
        return response.ok
          ? Response.json(record)
          : error(record?.message || "Không cập nhật được công ty.", response.status);
      },
    },
  },
});
