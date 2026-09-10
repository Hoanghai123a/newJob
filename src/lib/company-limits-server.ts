import {
  getPocketBaseAdminToken,
  getServerAuthUser,
  pbServerFetch,
  readPbJson,
  escapePb,
} from "./tenant-server";

export type CompanyLimitKind = "factories" | "recruitment_entities" | "staff_accounts";

type LimitContext = {
  token: string;
  company: Record<string, any>;
  user: { id: string; role?: string; tenant_company?: string };
};

const LIMITS: Record<
  CompanyLimitKind,
  { collection: string; field: string; label: string; filter: string }
> = {
  factories: { collection: "factories", field: "max_factories", label: "nhà máy", filter: "" },
  recruitment_entities: {
    collection: "recruitment_entities",
    field: "max_recruitment_entities",
    label: "Nhà chính/Đối tác",
    filter: "",
  },
  staff_accounts: {
    collection: "users",
    field: "max_staff_accounts",
    label: "nhân viên quản lý",
    filter: '(role = "staff" || role = "admin")',
  },
};

export class CompanyLimitError extends Error {
  status = 409;
  constructor(message: string) {
    super(message);
    this.name = "CompanyLimitError";
  }
}

async function count(token: string, collection: string, filter: string) {
  const response = await pbServerFetch(
    `/api/collections/${collection}/records?page=1&perPage=1&skipTotal=0&filter=${encodeURIComponent(filter)}&fields=id`,
    {},
    token,
  );
  const body = await readPbJson(response);
  if (!response.ok) throw new Error(body?.message || "Không kiểm tra được số lượng dữ liệu.");
  return Number(body?.totalItems || 0);
}

export async function requireCompanyAdmin(request: Request): Promise<LimitContext | null> {
  const auth = await getServerAuthUser(request);
  if (!auth || auth.user.role !== "admin" || !auth.user.tenant_company) return null;
  const token = await getPocketBaseAdminToken();
  if (!token) return null;
  const response = await pbServerFetch(
    `/api/collections/companies/records/${encodeURIComponent(auth.user.tenant_company)}?fields=id,status,max_factories,max_recruitment_entities,max_staff_accounts`,
    {},
    token,
  );
  const company = await readPbJson(response);
  if (!response.ok || !company?.id) return null;
  return { token, company, user: auth.user };
}

export async function assertCompanyLimit(
  context: LimitContext,
  kind: CompanyLimitKind,
  adding = 1,
) {
  const spec = LIMITS[kind];
  const limit = Math.max(0, Math.trunc(Number(context.company[spec.field] || 0)));
  if (limit === 0) return;
  const tenant = escapePb(String(context.company.id));
  const filter = [`tenant_company = "${tenant}"`, spec.filter].filter(Boolean).join(" && ");
  const current = await count(context.token, spec.collection, filter);
  if (current + adding > limit) {
    throw new CompanyLimitError(
      `Đã đạt hạn mức ${spec.label} (${current}/${limit}). Không thể tạo thêm dữ liệu.`,
    );
  }
}

export function companyTenant(context: LimitContext) {
  return String(context.company.id);
}

export async function createCompanyRecord(
  context: LimitContext,
  kind: CompanyLimitKind,
  payload: Record<string, unknown>,
) {
  await assertCompanyLimit(context, kind);
  const spec = LIMITS[kind];
  const response = await pbServerFetch(
    `/api/collections/${spec.collection}/records`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, tenant_company: companyTenant(context) }),
    },
    context.token,
  );
  const body = await readPbJson(response);
  if (!response.ok) throw new Error(body?.message || `Không tạo được ${spec.label}.`);
  return body;
}
