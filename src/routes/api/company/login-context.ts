import { createFileRoute } from "@tanstack/react-router";
import { getCompanyForUser, getServerAuthUser } from "@/lib/tenant-server";

export const Route = createFileRoute("/api/company/login-context")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await getServerAuthUser(request);
        if (!auth || auth.user.role === "super_admin") {
          return Response.json({ message: "Tài khoản không thuộc công ty." }, { status: 403 });
        }
        const company = await getCompanyForUser(auth.user);
        if (!company || company.status !== "active" || !company.code) {
          return Response.json(
            { message: "Công ty không hoạt động hoặc chưa có mã." },
            { status: 403 },
          );
        }
        return Response.json({ id: company.id, code: company.code });
      },
    },
  },
});
