export type RememberedCompanyBrand = {
  companyId: string;
  companyCode?: string;
  companyName: string;
  slogan?: string;
  logoUrl?: string;
  updated?: string;
};

const STORAGE_KEY = "jobconnect:last-company-brand";
export const COMPANY_BRAND_CHANGED_EVENT = "jobconnect:company-brand-changed";

export function getRememberedCompanyBrand(): RememberedCompanyBrand | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null");
    if (!value?.companyId || !value?.companyName) return null;
    return value as RememberedCompanyBrand;
  } catch {
    return null;
  }
}

export function rememberCompanyBrand(brand: RememberedCompanyBrand) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(brand));
  window.dispatchEvent(new Event(COMPANY_BRAND_CHANGED_EVENT));
}