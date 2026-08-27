import {
  getPocketBaseAdminToken,
  getServerAuthUser,
  pbServerFetch,
  readPbJson,
  type ServerAuthUser,
} from "@/lib/tenant-server";

type StaffRecord = {
  id: string;
  full_name?: string;
  username?: string;
  login_name?: string;
  role?: string;
  status?: string;
  tenant_company?: string;
};

function errorResponse(message: string, status: number, code: string) {
  return Response.json({ message, code }, { status });
}

async function getUser(userId: string, token: string) {
  const response = await pbServerFetch(
    `/api/collections/users/records/${encodeURIComponent(userId)}`,
    { method: "GET" },
    token,
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Không tải được tài khoản từ PocketBase.");
  return (await readPbJson(response)) as StaffRecord;
}

async function verifyAdminPassword(admin: ServerAuthUser, password: string) {
  const identity = admin.username || admin.email;
  if (!identity) return null;

  const response = await pbServerFetch("/api/collections/users/auth-with-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity, password }),
  });
  const body = await readPbJson(response);
  if (!response.ok || body?.record?.id !== admin.id || body?.record?.role !== "admin") return null;
  return typeof body?.token === "string" ? body.token : null;
}

function validateTarget(admin: ServerAuthUser, staff: StaffRecord) {
  if (!staff.tenant_company || staff.tenant_company !== admin.tenant_company) {
    return errorResponse("Tài khoản không thuộc công ty của bạn.", 403, "CROSS_TENANT");
  }
  if (staff.role === "admin") {
    return errorResponse("Tài khoản này đã là Admin.", 409, "ALREADY_ADMIN");
  }
  if (staff.role !== "staff") {
    return errorResponse("Chỉ có thể nâng quyền tài khoản Staff.", 400, "INVALID_TARGET");
  }
  if (staff.status === "disabled") {
    return errorResponse("Tài khoản đang bị khóa, không thể nâng quyền.", 409, "STAFF_DISABLED");
  }
  return null;
}

async function promoteWithLog(admin: ServerAuthUser, staff: StaffRecord, token: string) {
  const name = staff.full_name || staff.username || staff.id;
  const payload = {
    requests: [
      {
        method: "POST",
        url: "/api/collections/staff_action_logs/records",
        headers: {},
        body: {
          tenant_company: admin.tenant_company,
          actor: admin.id,
          actor_role_snapshot: "admin",
          target_user: staff.id,
          target_collection: "users",
          target_record: staff.id,
          action: "update",
          before: { role: "staff" },
          after: { role: "admin" },
          note: `Admin ủy quyền ${name} từ Staff lên Admin sau khi xác thực lại mật khẩu`,
        },
      },
      {
        method: "PATCH",
        url: `/api/collections/users/records/${encodeURIComponent(staff.id)}`,
        headers: {},
        body: { role: "admin" },
      },
    ],
  };
  const formData = new FormData();
  formData.append("@jsonPayload", JSON.stringify(payload));

  const response = await pbServerFetch("/api/batch", { method: "POST", body: formData }, token);
  if (!response.ok) {
    const body = await readPbJson(response);
    throw new Error(body?.message || "PocketBase không thể hoàn tất giao dịch nâng quyền.");
  }
}

export async function promoteStaffToAdmin(request: Request, staffId: string) {
  const auth = await getServerAuthUser(request);
  if (!auth || auth.user.role !== "admin") {
    return errorResponse("Phiên đăng nhập Admin không hợp lệ.", 401, "UNAUTHORIZED");
  }
  if (!staffId || staffId === auth.user.id) {
    return errorResponse("Không thể nâng quyền tài khoản không hợp lệ.", 400, "INVALID_TARGET");
  }

  const body = await request.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";

  try {
    const staff = await getUser(staffId, auth.token);
    if (!staff) {
      return errorResponse("Tài khoản không còn tồn tại.", 404, "STAFF_NOT_FOUND");
    }
    const invalid = validateTarget(auth.user, staff);
    if (invalid) return invalid;

    if (!password) {
      return errorResponse("Vui lòng nhập mật khẩu Admin.", 400, "PASSWORD_REQUIRED");
    }
    const verifiedToken = await verifyAdminPassword(auth.user, password);
    if (!verifiedToken) {
      return errorResponse("Mật khẩu Admin không đúng.", 403, "INVALID_PASSWORD");
    }

    // Re-read ngay trước khi ghi để chống việc để dialog mở lâu, trạng thái đã đổi.
    const currentStaff = await getUser(staffId, verifiedToken);
    if (!currentStaff) {
      return errorResponse("Tài khoản không còn tồn tại.", 404, "STAFF_NOT_FOUND");
    }
    const stillInvalid = validateTarget(auth.user, currentStaff);
    if (stillInvalid) return stillInvalid;

    // updateRule của users chỉ cho admin đặt role về user/staff, nên phải ghi bằng token superuser.
    const adminToken = await getPocketBaseAdminToken();
    if (!adminToken) {
      return errorResponse(
        "Máy chủ chưa cấu hình quyền quản trị PocketBase để nâng quyền.",
        424,
        "ADMIN_TOKEN_UNAVAILABLE",
      );
    }

    await promoteWithLog(auth.user, currentStaff, adminToken);
    return Response.json({ promoted: true, userId: staffId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không thể nâng quyền tài khoản.";
    return errorResponse(message, 502, "STAFF_PROMOTE_FAILED");
  }
}
