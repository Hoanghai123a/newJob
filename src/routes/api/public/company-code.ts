import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { companyCodeKey } from "@/lib/login-identity";
import {
  escapePb,
  getPocketBaseAdminToken,
  pbServerFetch,
  readPbJson,
} from "@/lib/tenant-server";

const QuerySchema = z.object({ code: z.string().min(1).max(40) });

export const Route = createFileRoute("/api/public/company-code")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const parsed = QuerySchema.safeParse({ code: url.searchParams.get("code") ?? "" });
        if (!parsed.success)
          return Response.json({ message: "Mã công ty không hợp lệ." }, { status: 400 });

        const adminToken = await getPocketBaseAdminToken();
        if (!adminToken)
          return Response.json(
            { message: "Máy chủ chưa cấu hình quản lý công ty." },
            { status: 424 },
          );

        const response = await pbServerFetch(
          "/api/collections/companies/records?perPage=200&fields=id,code,name,status",
          {},
          adminToken,
        );
        const body = await readPbJson(response);
        if (!response.ok)
          return Response.json(
            { message: body?.message || "Không thể kiểm tra mã công ty." },
            { status: 502 },
          );

        const codeKey = companyCodeKey(parsed.data.code);
        const company = (body?.items || []).find(
          (item: any) => companyCodeKey(item?.code) === codeKey,
        );
        if (!company || company.status !== "active")
          return Response.json(
            { message: "Mã công ty không hợp lệ hoặc công ty không hoạt động." },
            { status: 404 },
          );

        const brandFilter = encodeURIComponent(`tenant_company = "${escapePb(company.id)}"`);
        const brandResponse = await pbServerFetch(
          `/api/collections/app_settings/records?perPage=1&sort=-updated&filter=${brandFilter}&fields=id,company_name,slogan,logo,updated`,
          {},
          adminToken,
        );
        const brandBody = await readPbJson(brandResponse);
        const brand = brandResponse.ok ? brandBody?.items?.[0] : null;
        const brandVersion = brand?.updated || brand?.id || "";
        const logoUrl = brand?.logo
          ? `/api/public/app-icon?company=${encodeURIComponent(company.id)}${brandVersion ? `&v=${encodeURIComponent(brandVersion)}` : ""}`
          : "";

        return Response.json({
          id: company.id,
          code: company.code,
          name: company.name,
          company_name: brand?.company_name?.trim() || company.name,
          slogan: brand?.slogan?.trim() || "",
          logo_url: logoUrl,
          brand_updated: brandVersion,
        });
      },
    },
  },
});
