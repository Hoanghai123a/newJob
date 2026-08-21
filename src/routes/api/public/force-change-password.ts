import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  getPocketBaseAdminToken,
  getServerAuthUser,
  pbServerFetch,
  readPbJson,
} from "@/lib/tenant-server";

const DEFAULT_PASSWORD = "12345678";
const PasswordSchema = z
  .object({
    password: z.string().min(8, "Mật khẩu mới tối thiểu 8 ký tự.").max(200),
    passwordConfirm: z.string().max(200),
  })
  .refine((value) => value.password === value.passwordConfirm, {
    message: "Mật khẩu xác nhận không khớp.",
    path: ["passwordConfirm"],
  })
  .refine((value) => value.password !== DEFAULT_PASSWORD, {
    message: "Mật khẩu mới không được trùng mật khẩu mặc định.",
    path: ["password"],
  });

function error(message: string, status = 400) {
  return Response.json({ message }, { status });
}

async function authenticate(identity: string, password: string) {
  const response = await pbServerFetch("/api/collections/users/auth-with-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity, password }),
  });
  return { response, body: await readPbJson(response) };
}

export const Route = createFileRoute("/api/public/force-change-password")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await getServerAuthUser(request);
        if (!auth?.user.id || !auth.user.username)
          return error("Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại.", 401);

        const parsed = PasswordSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success)
          return error(parsed.error.issues[0]?.message || "Dữ liệu không hợp lệ.");

        const defaultLogin = await authenticate(auth.user.username, DEFAULT_PASSWORD);
        if (!defaultLogin.response.ok || defaultLogin.body?.record?.id !== auth.user.id)
          return error("Mật khẩu mặc định không còn hợp lệ. Vui lòng liên hệ quản trị viên.", 403);

        const adminToken = await getPocketBaseAdminToken();
        if (!adminToken) return error("Không kết nối được PocketBase.", 502);

        const update = await pbServerFetch(
          `/api/collections/users/records/${encodeURIComponent(auth.user.id)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              password: parsed.data.password,
              passwordConfirm: parsed.data.passwordConfirm,
              must_change_password: false,
            }),
          },
          adminToken,
        );
        const updated = await readPbJson(update);
        if (!update.ok) return error(updated?.message || "Không thể đổi mật khẩu.", update.status);

        const renewedLogin = await authenticate(auth.user.username, parsed.data.password);
        if (!renewedLogin.response.ok || !renewedLogin.body?.token || !renewedLogin.body?.record)
          return error("Đổi mật khẩu thành công nhưng không thể làm mới phiên đăng nhập.", 502);

        return Response.json({ token: renewedLogin.body.token, record: renewedLogin.body.record });
      },
    },
  },
});
