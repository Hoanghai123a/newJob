import JSZip from "jszip";
import {
  escapePb,
  getPocketBaseAdminToken,
  getServerAuthUser,
  pbServerFetch,
  readPbJson,
} from "@/lib/tenant-server";
import {
  buildTechnicalUsername,
  companyCodeKey,
  loginNameFromUsername,
} from "@/lib/login-identity";

const MANIFEST_VERSION = 1;
const MAX_PAGE = 500;
const SYSTEM_COLLECTIONS = new Set([
  "_superusers",
  "uid_counters",
  "tenant_purge_logs",
  "tenant_restore_logs",
]);
const OMIT_FIELDS = new Set(["password", "token", "verified", "emailVisibility"]);
const CONFIRM_TEXT = "XÓA VĨNH VIỄN";
const SKIP_BACKUP_TEXT = "TÔI CHẤP NHẬN XÓA KHÔNG CÓ BẢN SAO LƯU";

type PbField = { name: string; type: string; collectionId?: string; maxSelect?: number };
type PbCollection = {
  id: string;
  name: string;
  type: string;
  system?: boolean;
  fields?: PbField[];
};
type CompanySnapshot = Record<string, unknown> & {
  id: string;
  code: string;
  name: string;
  status?: string;
};
type BackupRecord = Record<string, unknown> & { source_id: string };
type BackupManifest = {
  format: "newapp-tenant-backup";
  manifestVersion: number;
  exportedAt: string;
  company: CompanySnapshot;
  counts: Record<string, number>;
  fileCount: number;
  fileBytes: number;
};

type TransferContext = {
  adminToken: string;
  actor: { id: string; username?: string; email?: string; role?: string };
};

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

function cleanRecord(record: Record<string, unknown>): BackupRecord {
  const result: Record<string, unknown> = { source_id: String(record.id || "") };
  for (const [key, value] of Object.entries(record)) {
    if (key === "id" || key === "collectionId" || key === "collectionName" || key === "expand")
      continue;
    if (OMIT_FIELDS.has(key)) continue;
    result[key] = value;
  }
  return result as BackupRecord;
}

async function sha256(input: Uint8Array | string) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function requireSuperAdmin(request: Request): Promise<TransferContext | null> {
  const auth = await getServerAuthUser(request);
  if (!auth || auth.user.role !== "super_admin") return null;
  const adminToken = await getPocketBaseAdminToken();
  return adminToken ? { adminToken, actor: auth.user } : null;
}

async function verifyPassword(ctx: TransferContext, password: string) {
  const identity = ctx.actor.username || ctx.actor.email;
  if (!identity || !password) return false;
  const response = await pbServerFetch("/api/collections/users/auth-with-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity, password }),
  });
  const body = await readPbJson(response);
  return response.ok && body?.record?.id === ctx.actor.id && body?.record?.role === "super_admin";
}

async function getCollections(token: string) {
  const response = await pbServerFetch("/api/collections?perPage=500", {}, token);
  const body = await readPbJson(response);
  if (!response.ok) throw new Error(body?.message || "Không đọc được cấu trúc PocketBase.");
  return (body?.items || []) as PbCollection[];
}

async function getCompany(token: string, companyId: string) {
  const response = await pbServerFetch(
    `/api/collections/companies/records/${encodeURIComponent(companyId)}`,
    {},
    token,
  );
  const body = await readPbJson(response);
  if (!response.ok || !body?.id) throw new Error("Không tìm thấy công ty.");
  return body as CompanySnapshot;
}

async function listRecords(token: string, collection: string, filter: string) {
  const result: Record<string, unknown>[] = [];
  let page = 1;
  while (true) {
    const query = new URLSearchParams({ page: String(page), perPage: String(MAX_PAGE), filter });
    const response = await pbServerFetch(
      `/api/collections/${encodeURIComponent(collection)}/records?${query}`,
      {},
      token,
    );
    const body = await readPbJson(response);
    if (!response.ok) throw new Error(body?.message || `Không đọc được collection ${collection}.`);
    result.push(...(body?.items || []));
    if (page >= Number(body?.totalPages || 1)) break;
    page++;
  }
  return result;
}

function tenantField(collection: PbCollection, companiesId: string) {
  const fields = collection.fields || [];
  if (collection.name === "users")
    return fields.some((field) => field.name === "tenant_company") ? "tenant_company" : null;
  return (
    fields.find(
      (field) =>
        (field.name === "company" || field.name === "tenant_company") &&
        field.type === "relation" &&
        field.collectionId === companiesId,
    )?.name || null
  );
}

function transferCollections(collections: PbCollection[]) {
  return collections.filter(
    (collection) =>
      !collection.system &&
      !collection.name.startsWith("_") &&
      collection.name !== "companies" &&
      !SYSTEM_COLLECTIONS.has(collection.name),
  );
}

async function collectTenantData(ctx: TransferContext, companyId: string) {
  const [company, collections] = await Promise.all([
    getCompany(ctx.adminToken, companyId),
    getCollections(ctx.adminToken),
  ]);
  const companies = collections.find((collection) => collection.name === "companies");
  if (!companies) throw new Error("PocketBase chưa có collection companies.");

  const records: Record<string, Record<string, unknown>[]> = {};
  const schemas: Record<string, { id: string; fields: PbField[]; tenantField: string }> = {};
  const missingTenant: string[] = [];
  for (const collection of transferCollections(collections)) {
    const field = tenantField(collection, companies.id);
    if (!field) {
      missingTenant.push(collection.name);
      continue;
    }
    const rows = await listRecords(
      ctx.adminToken,
      collection.name,
      `${field} = "${escapePb(companyId)}"`,
    );
    if (rows.length) records[collection.name] = rows;
    schemas[collection.name] = {
      id: collection.id,
      fields: collection.fields || [],
      tenantField: field,
    };
  }
  return { company, collections, records, schemas, missingTenant };
}

function fileNames(value: unknown) {
  if (Array.isArray(value))
    return value.filter((item): item is string => typeof item === "string" && !!item);
  return typeof value === "string" && value ? [value] : [];
}

async function buildBackup(ctx: TransferContext, companyId: string) {
  const data = await collectTenantData(ctx, companyId);
  const zip = new JSZip();
  const checksums: Record<string, string> = {};
  const counts: Record<string, number> = {};
  let fileCount = 0;
  let fileBytes = 0;

  for (const [collectionName, rows] of Object.entries(data.records)) {
    const cleaned = rows.map(cleanRecord);
    counts[collectionName] = cleaned.length;
    const path = `records/${collectionName}.json`;
    const content = JSON.stringify(cleaned, null, 2);
    zip.file(path, content);
    checksums[path] = await sha256(content);

    const schema = data.schemas[collectionName];
    for (const row of rows) {
      for (const field of schema.fields.filter((item) => item.type === "file")) {
        for (const name of fileNames(row[field.name])) {
          const response = await pbServerFetch(
            `/api/files/${encodeURIComponent(schema.id)}/${encodeURIComponent(String(row.id))}/${encodeURIComponent(name)}`,
            {},
            ctx.adminToken,
          );
          if (!response.ok) throw new Error(`Không tải được tệp ${collectionName}/${name}.`);
          const bytes = new Uint8Array(await response.arrayBuffer());
          const filePath = `files/${collectionName}/${row.id}/${name}`;
          zip.file(filePath, bytes);
          checksums[filePath] = await sha256(bytes);
          fileCount++;
          fileBytes += bytes.byteLength;
        }
      }
    }
  }

  const schemaPayload = {
    collections: Object.fromEntries(
      Object.entries(data.schemas).map(([name, schema]) => [
        name,
        {
          source_collection_id: schema.id,
          tenantField: schema.tenantField,
          fields: schema.fields.map((field) => ({
            name: field.name,
            type: field.type,
            relationCollection: field.collectionId
              ? data.collections.find((item) => item.id === field.collectionId)?.name || null
              : null,
            maxSelect: field.maxSelect,
          })),
        },
      ]),
    ),
  };
  const schemaText = JSON.stringify(schemaPayload, null, 2);
  zip.file("schema.json", schemaText);
  checksums["schema.json"] = await sha256(schemaText);

  const manifest: BackupManifest = {
    format: "newapp-tenant-backup",
    manifestVersion: MANIFEST_VERSION,
    exportedAt: new Date().toISOString(),
    company: cleanRecord(data.company) as unknown as CompanySnapshot,
    counts,
    fileCount,
    fileBytes,
  };
  const manifestText = JSON.stringify(manifest, null, 2);
  zip.file("manifest.json", manifestText);
  checksums["manifest.json"] = await sha256(manifestText);
  zip.file("checksums.json", JSON.stringify(checksums, null, 2));
  const bytes = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  return { bytes, manifest, checksum: await sha256(bytes), missingTenant: data.missingTenant };
}

export async function exportTenantBackup(request: Request, companyId: string) {
  const ctx = await requireSuperAdmin(request);
  if (!ctx) return json({ message: "Bạn không có quyền quản trị tối cao." }, 403);
  try {
    const backup = await buildBackup(ctx, companyId);
    if (backup.missingTenant.length) {
      throw new Error(
        `Các collection chưa có tenant rõ ràng: ${backup.missingTenant.join(", ")}. Hãy chạy migration trước khi sao lưu.`,
      );
    }
    const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
    const code = String(backup.manifest.company.code || "cong-ty").replace(/[^a-z0-9_.-]/gi, "-");
    return new Response(backup.bytes, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${code}-backup-${stamp}.zip"`,
        "X-Backup-SHA256": backup.checksum,
        "X-Backup-Warnings": String(backup.missingTenant.length),
      },
    });
  } catch (cause) {
    return json(
      { message: cause instanceof Error ? cause.message : "Không tạo được bản sao lưu." },
      500,
    );
  }
}

async function verifyZip(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const zip = await JSZip.loadAsync(bytes);
  const manifestEntry = zip.file("manifest.json");
  const schemaEntry = zip.file("schema.json");
  const checksumEntry = zip.file("checksums.json");
  if (!manifestEntry || !schemaEntry || !checksumEntry)
    throw new Error("File sao lưu thiếu manifest hoặc schema.");
  const manifestText = await manifestEntry.async("string");
  const schemaText = await schemaEntry.async("string");
  const checksums = JSON.parse(await checksumEntry.async("string")) as Record<string, string>;
  const manifest = JSON.parse(manifestText) as BackupManifest;
  const schema = JSON.parse(schemaText) as { collections: Record<string, any> };
  if (manifest.format !== "newapp-tenant-backup" || manifest.manifestVersion !== MANIFEST_VERSION)
    throw new Error("Phiên bản file sao lưu không được hỗ trợ.");
  for (const [path, expected] of Object.entries(checksums)) {
    const entry = zip.file(path);
    if (!entry) throw new Error(`File sao lưu thiếu ${path}.`);
    const actual = await sha256(await entry.async("uint8array"));
    if (actual !== expected) throw new Error(`Checksum không hợp lệ tại ${path}.`);
  }
  return { zip, manifest, schema, checksum: await sha256(bytes) };
}

async function companyCodeExists(token: string, code: string) {
  const rows = await listRecords(token, "companies", `code = "${escapePb(code)}"`);
  return rows.some((row) => companyCodeKey(row.code) === companyCodeKey(code));
}

export async function previewTenantRestore(request: Request) {
  const ctx = await requireSuperAdmin(request);
  if (!ctx) return json({ message: "Bạn không có quyền quản trị tối cao." }, 403);
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return json({ message: "Vui lòng chọn file ZIP sao lưu." }, 400);
    const parsed = await verifyZip(file);
    const code = String(parsed.manifest.company.code || "");
    if (await companyCodeExists(ctx.adminToken, code))
      return json({ message: "Mã công ty đã tồn tại, không thể import." }, 409);
    return json({ manifest: parsed.manifest, checksum: parsed.checksum });
  } catch (cause) {
    return json(
      { message: cause instanceof Error ? cause.message : "File sao lưu không hợp lệ." },
      400,
    );
  }
}

function randomPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return [...bytes].map((value) => alphabet[value % alphabet.length]).join("");
}

function mapRelation(value: unknown, collection: string, idMap: Map<string, Map<string, string>>) {
  const map = idMap.get(collection);
  if (!map) return value;
  if (Array.isArray(value)) return value.map((item) => map.get(String(item)) || item);
  return map.get(String(value || "")) || value;
}

async function createRecord(
  token: string,
  collection: string,
  payload: Record<string, unknown> | FormData,
) {
  const response = await pbServerFetch(
    `/api/collections/${encodeURIComponent(collection)}/records`,
    {
      method: "POST",
      headers: payload instanceof FormData ? undefined : { "Content-Type": "application/json" },
      body: payload instanceof FormData ? payload : JSON.stringify(payload),
    },
    token,
  );
  const body = await readPbJson(response);
  if (!response.ok) throw new Error(body?.message || `Không tạo được bản ghi ${collection}.`);
  return body as Record<string, unknown>;
}

function sortCollections(names: string[], schemas: Record<string, any>) {
  const pending = new Set(names);
  const result: string[] = [];
  while (pending.size) {
    const ready = [...pending].filter((name) =>
      (schemas[name]?.fields || []).every(
        (field: any) =>
          !field.relationCollection ||
          field.relationCollection === "companies" ||
          !pending.has(field.relationCollection),
      ),
    );
    const batch = ready.length ? ready : [[...pending][0]];
    for (const name of batch) {
      result.push(name);
      pending.delete(name);
    }
  }
  return result;
}

export async function restoreTenantBackup(request: Request) {
  const ctx = await requireSuperAdmin(request);
  if (!ctx) return json({ message: "Bạn không có quyền quản trị tối cao." }, 403);
  const created = new Map<string, string[]>();
  let restoreAuditId = "";
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return json({ message: "Vui lòng chọn file ZIP sao lưu." }, 400);
    const parsed = await verifyZip(file);
    const companyBackup = parsed.manifest.company as any;
    if (await companyCodeExists(ctx.adminToken, companyBackup.code))
      return json({ message: "Mã công ty đã tồn tại, không thể import." }, 409);

    const companyPayload = { ...companyBackup, status: "suspended" };
    delete companyPayload.source_id;
    delete companyPayload.created;
    delete companyPayload.updated;
    const company = await createRecord(ctx.adminToken, "companies", companyPayload);
    created.set("companies", [String(company.id)]);
    const restoreAudit = await createAudit(ctx.adminToken, "tenant_restore_logs", {
      company_id_snapshot: String(company.id),
      company_code_snapshot: String(companyBackup.code || ""),
      company_name_snapshot: String(companyBackup.name || ""),
      actor_super_admin: ctx.actor.id,
      started_at: new Date().toISOString(),
      status: "running",
      preview_counts: parsed.manifest.counts,
      backup_checksum: parsed.checksum,
    });
    restoreAuditId = String(restoreAudit.id || "");
    const idMap = new Map<string, Map<string, string>>([
      ["companies", new Map([[String(companyBackup.source_id), String(company.id)]])],
    ]);
    const credentials: Array<{ username: string; password: string; role: string }> = [];
    const names = Object.keys(parsed.manifest.counts);

    for (const collection of sortCollections(names, parsed.schema.collections)) {
      const entry = parsed.zip.file(`records/${collection}.json`);
      if (!entry) continue;
      const rows = JSON.parse(await entry.async("string")) as BackupRecord[];
      const schema = parsed.schema.collections[collection];
      const collectionMap = new Map<string, string>();
      idMap.set(collection, collectionMap);
      for (const row of rows) {
        const payload: Record<string, unknown> = { ...row };
        const sourceId = String(payload.source_id);
        delete payload.source_id;
        delete payload.created;
        delete payload.updated;
        for (const field of schema.fields || []) {
          if (field.type === "relation" && field.relationCollection && payload[field.name])
            payload[field.name] = mapRelation(payload[field.name], field.relationCollection, idMap);
          if (field.type === "file") delete payload[field.name];
        }
        if (collection === "users") {
          const password = randomPassword();
          const loginName = String(payload.login_name || loginNameFromUsername(payload.username));
          payload.username = buildTechnicalUsername(String(companyBackup.code), loginName);
          payload.login_name = loginName;
          payload.password = password;
          payload.passwordConfirm = password;
          payload.must_change_password = true;
          credentials.push({ username: loginName, password, role: String(payload.role || "user") });
        }
        const record = await createRecord(ctx.adminToken, collection, payload);
        collectionMap.set(sourceId, String(record.id));
        const ids = created.get(collection) || [];
        ids.push(String(record.id));
        created.set(collection, ids);

        const fileFields = (schema.fields || []).filter((field: any) => field.type === "file");
        if (fileFields.length) {
          const update = new FormData();
          let hasFiles = false;
          for (const field of fileFields) {
            for (const oldName of fileNames(row[field.name])) {
              const fileEntry = parsed.zip.file(`files/${collection}/${sourceId}/${oldName}`);
              if (!fileEntry) throw new Error(`Thiếu tệp ${collection}/${sourceId}/${oldName}.`);
              update.append(field.name, new Blob([await fileEntry.async("uint8array")]), oldName);
              hasFiles = true;
            }
          }
          if (hasFiles) {
            const response = await pbServerFetch(
              `/api/collections/${encodeURIComponent(collection)}/records/${record.id}`,
              { method: "PATCH", body: update },
              ctx.adminToken,
            );
            if (!response.ok) throw new Error(`Không khôi phục được tệp của ${collection}.`);
          }
        }
      }
    }

    await pbServerFetch(
      `/api/collections/companies/records/${company.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status:
            companyBackup.status === "closed" ? "suspended" : companyBackup.status || "active",
        }),
      },
      ctx.adminToken,
    );
    if (restoreAuditId) {
      await updateAudit(ctx.adminToken, "tenant_restore_logs", restoreAuditId, {
        completed_at: new Date().toISOString(),
        status: "completed",
        deleted_counts: Object.fromEntries(
          [...created.entries()].map(([name, ids]) => [name, ids.length]),
        ),
      });
    }
    return json({
      companyId: company.id,
      counts: parsed.manifest.counts,
      checksum: parsed.checksum,
      credentials,
    });
  } catch (cause) {
    for (const [collection, ids] of [...created.entries()].reverse()) {
      for (const id of ids.reverse())
        await pbServerFetch(
          `/api/collections/${encodeURIComponent(collection)}/records/${encodeURIComponent(id)}`,
          { method: "DELETE" },
          ctx.adminToken,
        ).catch(() => undefined);
    }
    return json(
      { message: cause instanceof Error ? cause.message : "Không khôi phục được công ty." },
      500,
    );
  }
}

async function deleteRows(token: string, collection: string, rows: Record<string, unknown>[]) {
  let deleted = 0;
  for (const row of rows) {
    const response = await pbServerFetch(
      `/api/collections/${encodeURIComponent(collection)}/records/${encodeURIComponent(String(row.id))}`,
      { method: "DELETE" },
      token,
    );
    if (!response.ok && response.status !== 404)
      throw new Error(`Không xóa được ${collection}/${row.id}.`);
    if (response.ok) deleted++;
  }
  return deleted;
}

async function createAudit(token: string, collection: string, payload: Record<string, unknown>) {
  const response = await pbServerFetch(
    `/api/collections/${collection}/records`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    token,
  );
  const body = await readPbJson(response);
  if (!response.ok) throw new Error(body?.message || `Không ghi được ${collection}.`);
  return body as Record<string, unknown>;
}

async function updateAudit(
  token: string,
  collection: string,
  id: string,
  payload: Record<string, unknown>,
) {
  const response = await pbServerFetch(
    `/api/collections/${collection}/records/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    token,
  );
  if (!response.ok) throw new Error(`Không cập nhật được ${collection}.`);
}

export async function purgeTenant(request: Request, companyId: string) {
  const ctx = await requireSuperAdmin(request);
  if (!ctx) return json({ message: "Bạn không có quyền quản trị tối cao." }, 403);
  const body = await request.json().catch(() => null);
  try {
    const data = await collectTenantData(ctx, companyId);
    const counts = Object.fromEntries(
      Object.entries(data.records).map(([name, rows]) => [name, rows.length]),
    );
    if (data.missingTenant.length) {
      return json(
        {
          message: `Các collection chưa có tenant rõ ràng: ${data.missingTenant.join(", ")}. Hãy chạy migration trước khi tiếp tục.`,
        },
        409,
      );
    }
    if (body?.action === "preview")
      return json({ company: data.company, counts, warnings: data.missingTenant });
    if (body?.action !== "delete") return json({ message: "Thao tác không hợp lệ." }, 400);
    if (!(await verifyPassword(ctx, String(body.password || ""))))
      return json({ message: "Mật khẩu Super Admin không đúng." }, 401);
    if (companyCodeKey(body.companyCode) !== companyCodeKey(data.company.code))
      return json({ message: "Mã công ty xác nhận không đúng." }, 400);
    if (body.confirmationText !== CONFIRM_TEXT)
      return json({ message: `Vui lòng nhập chính xác “${CONFIRM_TEXT}”.` }, 400);
    if (!body.backupChecksum && body.skipBackupText !== SKIP_BACKUP_TEXT)
      return json({ message: "Chưa xác nhận xóa không có bản sao lưu." }, 400);

    await pbServerFetch(
      `/api/collections/companies/records/${encodeURIComponent(companyId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "closed" }),
      },
      ctx.adminToken,
    );
    const audit = {
      company_id_snapshot: companyId,
      company_code_snapshot: data.company.code,
      company_name_snapshot: data.company.name,
      actor_super_admin: ctx.actor.id,
      started_at: new Date().toISOString(),
      status: "running",
      preview_counts: counts,
      backup_checksum: String(body.backupChecksum || ""),
    };
    const auditRecord = await createAudit(ctx.adminToken, "tenant_purge_logs", audit);

    const deleted: Record<string, number> = {};
    const names = sortCollections(
      Object.keys(data.records).filter((name) => name !== "users"),
      data.schemas,
    );
    for (const name of names.reverse())
      deleted[name] = await deleteRows(ctx.adminToken, name, data.records[name]);
    if (data.records.users)
      deleted.users = await deleteRows(ctx.adminToken, "users", data.records.users);
    const companyResponse = await pbServerFetch(
      `/api/collections/companies/records/${encodeURIComponent(companyId)}`,
      { method: "DELETE" },
      ctx.adminToken,
    );
    if (!companyResponse.ok) throw new Error("Không xóa được hồ sơ công ty sau khi dọn dữ liệu.");
    await updateAudit(ctx.adminToken, "tenant_purge_logs", String(auditRecord.id), {
      completed_at: new Date().toISOString(),
      status: "completed",
      deleted_counts: deleted,
    });
    return json({ companyId, deleted });
  } catch (cause) {
    return json(
      { message: cause instanceof Error ? cause.message : "Không xóa được công ty." },
      500,
    );
  }
}
