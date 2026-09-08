import { getPBUpstream } from "@/lib/pocketbase-config";

type AuthUser = {
  id: string;
  username?: string;
  email?: string;
  full_name?: string;
  role?: string;
  tenant_company?: string;
};

type WorkerRecord = {
  id: string;
  full_name?: string;
  uid?: string;
  phone?: string;
  status?: string;
  created?: string;
};

type DependencyDefinition = {
  collection: string;
  label: string;
  filter: (workerId: string) => string;
};

export type WorkerDeleteDependency = {
  collection: string;
  label: string;
  count: number;
};

export type WorkerDeletePreview = {
  workerId: string;
  dependencies: WorkerDeleteDependency[];
  employmentHistoryCount: number;
};

const DEPENDENCIES: DependencyDefinition[] = [
  {
    collection: "advances",
    label: "Yêu cầu ứng lương",
    filter: (id) => `worker="${escapePb(id)}"`,
  },
  {
    collection: "salary_holds",
    label: "Dữ liệu giữ lương",
    filter: (id) => `worker_profile="${escapePb(id)}"`,
  },
  {
    collection: "approval_requests",
    label: "Yêu cầu phê duyệt có số tiền",
    filter: (id) => `creator="${escapePb(id)}" && amount>0`,
  },
];

const EMPLOYMENT_HISTORY_DEPENDENCY: DependencyDefinition = {
  collection: "employment_histories",
  label: "Lịch sử đi làm",
  filter: (id) => `worker="${escapePb(id)}"`,
};

function escapePb(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function getBearerToken(request: Request) {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") || "");
  return match?.[1] || "";
}

async function pbFetch(path: string, init: RequestInit = {}, token?: string) {
  const headers = new Headers(init.headers);
  headers.set("ngrok-skip-browser-warning", "true");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${getPBUpstream()}${path}`, { ...init, headers });
}

async function readJson(response: Response) {
  return response.json().catch(() => null);
}

function errorResponse(message: string, status: number, code: string, extra?: object) {
  return Response.json({ message, code, ...extra }, { status });
}

async function getAuthenticatedAdmin(request: Request) {
  const token = getBearerToken(request);
  if (!token) return null;

  const response = await pbFetch("/api/collections/users/auth-refresh", { method: "POST" }, token);
  if (!response.ok) return null;

  const body = await readJson(response);
  const user = body?.record as AuthUser | undefined;
  if (!user?.id || user.role !== "admin") return null;
  return { token, user };
}

async function verifyAdminPassword(admin: AuthUser, password: string) {
  const identity = admin.username || admin.email;
  if (!identity) return null;

  const response = await pbFetch("/api/collections/users/auth-with-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity, password }),
  });
  const body = await readJson(response);
  if (!response.ok || body?.record?.id !== admin.id || body?.record?.role !== "admin") return null;
  return typeof body?.token === "string" ? body.token : null;
}

async function getWorker(workerId: string, token: string) {
  const response = await pbFetch(
    `/api/collections/workers/records/${encodeURIComponent(workerId)}`,
    { method: "GET" },
    token,
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Không tải được hồ sơ NLĐ từ PocketBase.");
  return (await readJson(response)) as WorkerRecord;
}

async function countDependency(definition: DependencyDefinition, workerId: string, token: string) {
  const query = new URLSearchParams({
    page: "1",
    perPage: "1",
    skipTotal: "0",
    fields: "id",
    filter: definition.filter(workerId),
  });
  const response = await pbFetch(
    `/api/collections/${encodeURIComponent(definition.collection)}/records?${query}`,
    { method: "GET" },
    token,
  );

  if (response.status === 404) return 0;
  if (response.status === 400) return 0; // Collection empty or filter issue, don't block delete
  if (!response.ok) {
    throw new Error(`Không kiểm tra được nhóm dữ liệu “${definition.label}”.`);
  }

  const body = await readJson(response);
  return Number(body?.totalItems || 0);
}

async function findDependencies(workerId: string, token: string) {
  const counts = await Promise.all(
    DEPENDENCIES.map(async (definition) => ({
      definition,
      count: await countDependency(definition, workerId, token),
    })),
  );

  return counts
    .filter((item) => item.count > 0)
    .map<WorkerDeleteDependency>((item) => ({
      collection: item.definition.collection,
      label: item.definition.label,
      count: item.count,
    }));
}

function workerSnapshot(worker: WorkerRecord) {
  return {
    id: worker.id,
    uid: worker.uid || "",
    full_name: worker.full_name || "",
    phone: worker.phone || "",
    status: worker.status || "",
  };
}

// PocketBase chặn xóa workers khi còn employment_histories (required relation) hoặc
// cccd_versions (unique index trên worker). Phải xóa các bản ghi này trong cùng batch.
// Thêm các collection khác có relation đến workers để tránh "required relation reference" error.
const CASCADE_COLLECTIONS = [
  { collection: "employment_histories", field: "worker" },
  { collection: "cccd_versions", field: "worker" },
  { collection: "check_attendance_items", field: "worker" },
  { collection: "check_salary_items", field: "worker" },
  { collection: "group_chat_messages", field: "worker" },
  { collection: "chat_room_members", field: "worker" },
  { collection: "chat_join_requests", field: "worker" },
  { collection: "push_subscriptions", field: "worker" },
  { collection: "notebook_entries", field: "worker_profile" },
  { collection: "staff_action_logs", field: "target_worker" },
] as const;

async function listCascadeRecordIds(
  collection: string,
  field: string,
  workerId: string,
  token: string,
) {
  const query = new URLSearchParams({
    page: "1",
    perPage: "500",
    fields: "id",
    filter: `${field}="${escapePb(workerId)}"`,
  });
  const response = await pbFetch(
    `/api/collections/${encodeURIComponent(collection)}/records?${query}`,
    { method: "GET" },
    token,
  );
  if (!response.ok) return [];
  const body = await readJson(response);
  const items = Array.isArray(body?.items) ? body.items : [];
  return items.map((item: { id?: string }) => item.id).filter(Boolean) as string[];
}

async function deleteWorkerWithLog(
  admin: AuthUser,
  worker: WorkerRecord,
  employmentHistoryCount: number,
  token: string,
) {
  const name = worker.full_name || worker.uid || worker.phone || worker.id;
  const cascadeGroups = await Promise.all(
    CASCADE_COLLECTIONS.map(async (item) => ({
      collection: item.collection,
      ids: await listCascadeRecordIds(item.collection, item.field, worker.id, token),
    })),
  );

  const cascadeRequests = cascadeGroups.flatMap((group) =>
    group.ids.map((id) => ({
      method: "DELETE",
      url: `/api/collections/${group.collection}/records/${encodeURIComponent(id)}`,
      headers: {},
      body: {},
    })),
  );
  const cascadeCounts = Object.fromEntries(
    cascadeGroups.map((group) => [group.collection, group.ids.length]),
  );

  const payload = {
    requests: [
      ...cascadeRequests,
      {
        method: "POST",
        url: "/api/collections/staff_action_logs/records",
        headers: {},
        body: {
          tenant_company: admin.tenant_company,
          actor: admin.id,
          actor_role_snapshot: "admin",
          target_user: "",
          target_collection: "workers",
          target_record: worker.id,
          action: "delete",
          before: {
            ...workerSnapshot(worker),
            employment_history_count: employmentHistoryCount,
            cascade_deleted: cascadeCounts,
          },
          after: null,
          note: `Admin xóa hồ sơ NLĐ ${name} và ${employmentHistoryCount} lịch sử đi làm sau khi xác thực lại mật khẩu`,
        },
      },
      {
        method: "DELETE",
        url: `/api/collections/workers/records/${encodeURIComponent(worker.id)}`,
        headers: {},
        body: {},
      },
    ],
  };
  const formData = new FormData();
  formData.append("@jsonPayload", JSON.stringify(payload));

  const response = await pbFetch("/api/batch", { method: "POST", body: formData }, token);
  if (!response.ok) {
    const body = await readJson(response);
    console.error("[deleteWorkerWithLog] Batch API failed:", {
      status: response.status,
      statusText: response.statusText,
      body,
      workerId: worker.id,
      cascadeCounts,
    });
    const message = body?.message || "PocketBase không thể hoàn tất giao dịch xóa và ghi nhật ký.";
    throw new Error(message);
  }
}

async function getWorkerDeletePreview(
  worker: WorkerRecord,
  token: string,
): Promise<WorkerDeletePreview> {
  const [dependencies, employmentHistoryCount] = await Promise.all([
    findDependencies(worker.id, token),
    countDependency(EMPLOYMENT_HISTORY_DEPENDENCY, worker.id, token),
  ]);

  return {
    workerId: worker.id,
    dependencies,
    employmentHistoryCount,
  };
}

export async function deleteWorkerAccount(request: Request, workerId: string) {
  const auth = await getAuthenticatedAdmin(request);
  if (!auth) {
    return errorResponse("Phiên đăng nhập Admin không hợp lệ.", 401, "UNAUTHORIZED");
  }

  const body = await request.json().catch(() => null);
  const action = body?.action === "preview" ? "preview" : "delete";
  const password = typeof body?.password === "string" ? body.password : "";
  const confirmed = body?.confirmed === true;

  if (!workerId || workerId === auth.user.id) {
    return errorResponse("Không thể xóa hồ sơ NLĐ không hợp lệ.", 400, "INVALID_TARGET");
  }

  try {
    const worker = await getWorker(workerId, auth.token);
    if (!worker) {
      return errorResponse("Hồ sơ NLĐ không còn tồn tại.", 404, "WORKER_NOT_FOUND");
    }
    const preview = await getWorkerDeletePreview(worker, auth.token);
    if (action === "preview") {
      return Response.json({ preview });
    }

    if (!password) {
      return errorResponse("Vui lòng nhập mật khẩu Admin.", 400, "PASSWORD_REQUIRED");
    }
    if (!confirmed) {
      return errorResponse(
        "Vui lòng xác nhận đã đọc và nắm rõ thông tin trước khi xóa.",
        400,
        "CONFIRMATION_REQUIRED",
      );
    }

    const verifiedToken = await verifyAdminPassword(auth.user, password);
    if (!verifiedToken) {
      return errorResponse("Mật khẩu Admin không đúng.", 403, "INVALID_PASSWORD");
    }

    // Re-check dependencies before deletion
    const currentWorker = await getWorker(workerId, verifiedToken);
    if (!currentWorker) {
      return errorResponse("Hồ sơ NLĐ không còn tồn tại.", 404, "WORKER_NOT_FOUND");
    }

    const currentPreview = await getWorkerDeletePreview(currentWorker, verifiedToken);
    if (currentPreview.dependencies.length > 0) {
      return errorResponse(
        "Không thể xóa vì NLĐ đang có nghiệp vụ liên quan tới tiền. Hãy xử lý các nghiệp vụ này trước hoặc chuyển hồ sơ sang ngừng hoạt động.",
        409,
        "WORKER_HAS_DEPENDENCIES",
        { dependencies: currentPreview.dependencies },
      );
    }

    await deleteWorkerWithLog(
      auth.user,
      currentWorker,
      currentPreview.employmentHistoryCount,
      verifiedToken,
    );
    return Response.json({
      deleted: true,
      workerId,
      deletedEmploymentHistoryCount: currentPreview.employmentHistoryCount,
    });
  } catch (error) {
    console.error("[deleteWorkerAccount] Error deleting worker:", {
      workerId,
      adminId: auth.user.id,
      error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
    });
    const message = error instanceof Error ? error.message : "Không thể xóa hồ sơ NLĐ.";
    return errorResponse(message, 500, "WORKER_DELETE_FAILED");
  }
}
