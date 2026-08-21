import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { pb, fileUrl } from "./pocketbase";
import { useAuth } from "./auth";

export interface AppSettings {
  id?: string;
  company_name?: string;
  slogan?: string;
  address?: string;
  hotline?: string;
  email?: string;
  about?: string;
  advance_limit?: number;
  advance_rules?: string;
  allow_advance_after_leave?: boolean;
  advance_reporting_enabled?: boolean;
  staff_employment_factory_scope?: "assigned" | "all";
  account_code_prefix?: string;
  logo?: string;
  updated?: string;
  install_guide_images?: string[];
  collectionId?: string;
  collectionName?: string;
  company?: string;
}

const DEFAULTS: AppSettings = {
  company_name: "Chấm công",
  slogan: "Kết nối nhà tuyển dụng & người lao động",
  address: "",
  hotline: "",
  email: "",
  about: "",
  advance_limit: 0,
  advance_rules: "",
  allow_advance_after_leave: false,
  advance_reporting_enabled: true,
  staff_employment_factory_scope: "assigned",
  install_guide_images: [],
};
function escapePb(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export async function fetchAppSettingsStrict(companyId?: string): Promise<AppSettings> {
  const res = await pb
    .collection("app_settings")
    .getList(1, 1, { filter: companyId ? `company = "${escapePb(companyId)}"` : "" });
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
  const companyId = user?.company || "";
  const q = useQuery({
    queryKey: ["app_settings", companyId],
    queryFn: () => fetchAppSettings(companyId),
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
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
  return { ...q, data, logoUrl: data.logo ? fileUrl(data, data.logo) : "" };
}
