export function normalizeLoginName(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

export function normalizeCompanyCode(value: unknown) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

export function companyCodeKey(value: unknown) {
  return normalizeCompanyCode(value).toLowerCase();
}

export function isSupportedCompanyCode(value: string) {
  return /^[A-Za-z0-9_.]+$/.test(value);
}

export function loginNameFromUsername(value: unknown) {
  const username = normalizeLoginName(value);
  const separator = username.indexOf("__");
  return separator >= 0 ? username.slice(separator + 2) : username;
}

export function buildTechnicalUsername(companyCode: string, loginName: string) {
  const normalizedCompanyCode = normalizeCompanyCode(companyCode).toLowerCase();
  const normalizedLoginName = normalizeLoginName(loginName);
  if (!isSupportedCompanyCode(normalizedCompanyCode) || !normalizedLoginName) {
    throw new Error("Mã công ty hoặc tên đăng nhập không hợp lệ.");
  }
  return `${normalizedCompanyCode}__${normalizedLoginName}`;
}
