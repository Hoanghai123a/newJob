import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { pb, fileUrl } from "./pocketbase";
import { useAuth } from "./auth";
import { companyIdOf } from "./tenant";
import { rememberCompanyBrand } from "./company-brand";

export interface AppSettings {
  id?: string;
  company_name?: string;
  address?: string;
  hotline?: string;
  advance_rules?: string;
  allow_advance_after_leave?: boolean;
  advance_reporting_enabled?: boolean;
  staff_employment_factory_scope?: "assigned" | "all";
  account_code_prefix?: string;
  logo?: string;
  updated?: string;
  collectionId?: string;
  collectionName?: string;
  tenant_company?: string;
}

const DEFAULTS: AppSettings = {
  company_name: "Tuyển dụng 4.0",
  address: "",
  hotline: "",
  advance_rules: "",
  allow_advance_after_leave: false,
  advance_reporting_enabled: true,
  staff_employment_factory_scope: "assigned",
};
function escapePb(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export async function fetchAppSettingsStrict(companyId?: string): Promise<AppSettings> {
  const res = await pb
    .collection("app_settings")
    .getList(1, 1, { filter: companyId ? `tenant_company = "${escapePb(companyId)}"` : "" });
  return { ...DEFAULTS, ...((res.items[0] as AppSettings | undefined) || {}) };
}
export async function fetchAppSettings(companyId?: string): Promise<AppSettings> {
  try {
    return await fetchAppSettingsStrict(companyId);
  } catch {
    return DEFAULTS;
  }
}

export function useAppSettings() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const companyId = companyIdOf(user);
  const q = useQuery({
    queryKey: ["app_settings", companyId],
    queryFn: () => fetchAppSettings(companyId),
    enabled: Boolean(companyId),
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    if (!companyId) return;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    pb.collection("app_settings")
      .subscribe("*", () => {
        void queryClient.invalidateQueries({ queryKey: ["app_settings", companyId] });
      })
      .then((stop) => {
        if (active) unsubscribe = stop;
        else stop();
      })
      .catch(() => {});
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [companyId, queryClient]);
  const data = q.data || DEFAULTS;
  const logoUrl = data.logo ? fileUrl(data, data.logo) : "";

  useEffect(() => {
    if (!companyId || !data.company_name) return;
    rememberCompanyBrand({
      companyId,
      companyName: data.company_name,
      logoUrl,
      updated: data.updated || data.id || "",
    });
  }, [companyId, data.company_name, data.id, data.updated, logoUrl]);

  return { ...q, data, logoUrl };
}
