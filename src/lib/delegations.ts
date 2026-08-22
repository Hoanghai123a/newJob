import type { UserRecord } from "./pocketbase";
import { accountLoginName } from "./login-identity";

export function escapePb(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function relationInFilter(field: string, ids: string[]) {
  const cleanIds = [...new Set(ids.filter(Boolean))];
  if (!cleanIds.length) return `${field}=""`;
  return cleanIds.map((id) => `${field}="${escapePb(id)}"`).join(" || ");
}

export function userDisplayName(user?: Partial<UserRecord> | null) {
  if (!user) return "Không rõ";
  return user.full_name || accountLoginName(user) || user.phone || user.id;
}
