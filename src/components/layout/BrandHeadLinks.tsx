import { useEffect, useState } from "react";

import { COMPANY_BRAND_CHANGED_EVENT, getRememberedCompanyBrand } from "@/lib/company-brand";
import { useAppSettings } from "@/lib/app-settings";
import { useAuth } from "@/lib/auth";
import { companyIdOf } from "@/lib/tenant";

function versionParam(version?: string) {
  const value = version?.trim();
  return value ? `?v=${encodeURIComponent(value)}` : "";
}

function upsertHeadLink(rel: string, href: string) {
  const selector = rel === "icon" ? 'link[rel="icon"]' : `link[rel="${rel}"]`;
  let link = document.head.querySelector<HTMLLinkElement>(selector);

  if (!link) {
    link = document.createElement("link");
    link.rel = rel;
    document.head.appendChild(link);
  }

  if (link.href !== new URL(href, window.location.origin).href) link.href = href;
}

export function BrandHeadLinks() {
  const { data: settings } = useAppSettings();
  const { user } = useAuth();
  const companyId = companyIdOf(user);
  const [rememberedBrand, setRememberedBrand] = useState(getRememberedCompanyBrand);

  useEffect(() => {
    const syncRememberedBrand = () => setRememberedBrand(getRememberedCompanyBrand());
    window.addEventListener(COMPANY_BRAND_CHANGED_EVENT, syncRememberedBrand);
    return () => window.removeEventListener(COMPANY_BRAND_CHANGED_EVENT, syncRememberedBrand);
  }, []);

  useEffect(() => {
    const remembered = rememberedBrand;
    const hasCurrentCompany = Boolean(companyId);
    const brandName = hasCurrentCompany
      ? settings.company_name?.trim()
      : remembered?.companyName?.trim() || settings.company_name?.trim();
    const brandLogo = hasCurrentCompany ? Boolean(settings.logo) : Boolean(remembered?.logoUrl);
    const brandVersion = hasCurrentCompany
      ? settings.updated || settings.id
      : remembered?.updated;
    const brandCompanyId = hasCurrentCompany ? companyId : remembered?.companyId;
    const version = versionParam(brandVersion);
    const companyParam = brandCompanyId ? `${version ? "&" : "?"}company=${encodeURIComponent(brandCompanyId)}` : "";
    const iconHref = brandLogo ? `/api/public/app-icon${version}${companyParam}` : "/icons/app-icon.svg";
    const manifestHref = brandCompanyId
      ? `/api/public/manifest/webmanifest?company=${encodeURIComponent(brandCompanyId)}${version ? `&v=${encodeURIComponent(brandVersion || "")}` : ""}`
      : "/manifest.webmanifest";

    upsertHeadLink("icon", iconHref);
    upsertHeadLink("apple-touch-icon", iconHref);
    upsertHeadLink("manifest", manifestHref);
    document.title = brandName || "Chấm công";
  }, [companyId, rememberedBrand, settings.company_name, settings.id, settings.logo, settings.updated]);

  return null;
}
