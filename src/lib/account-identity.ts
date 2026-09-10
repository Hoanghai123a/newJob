import { pb, type UserRecord } from "./pocketbase";
import { companyFilter } from "./tenant";
import { accountLoginName, loginNameFromUsername } from "./login-identity";

export function normalizeAccountIdentity(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

export function normalizeAccountUsername(value: unknown) {
  return normalizeAccountIdentity(value);
}

export function accountIdentityKey(value: unknown) {
  return normalizeAccountIdentity(value);
}

export function buildUserIdentityMaps<
  T extends Pick<UserRecord, "uid" | "username" | "login_name">,
>(users: T[]) {
  const userByUid = new Map<string, T>();
  const userByUsername = new Map<string, T>();

  for (const user of users) {
    const uidKey = accountIdentityKey(user.uid);
    const usernameKey = accountIdentityKey(accountLoginName(user));
    if (uidKey) userByUid.set(uidKey, user);
    if (usernameKey) userByUsername.set(usernameKey, user);
  }

  return { userByUid, userByUsername };
}

function escapePb(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export async function findUserByUsernameInsensitive(username: string) {
  const key = accountIdentityKey(loginNameFromUsername(username));
  if (!key) return null;

  const users = await pb
    .collection("users")
    .getFullList<UserRecord>({
      fields: "id,username,uid",
      filter: companyFilter(pb.authStore.record as UserRecord | null, "tenant_company"),
    })
    .catch(() => [] as UserRecord[]);
  return users.find((user) => accountIdentityKey(accountLoginName(user)) === key) || null;
}

export async function findUserByUidInsensitive(uid: string) {
  const key = accountIdentityKey(uid);
  if (!key) return null;

  const exact = await pb
    .collection("users")
    .getList<UserRecord>(1, 1, {
      filter: `${companyFilter(pb.authStore.record as UserRecord | null)} && uid="${escapePb(uid.trim())}"`,
    })
    .catch(() => ({ items: [] as UserRecord[] }));
  const exactMatch = exact.items.find((user) => accountIdentityKey(user.uid) === key);
  if (exactMatch) return exactMatch;

  const loose = await pb
    .collection("users")
    .getList<UserRecord>(1, 25, {
      filter: `${companyFilter(pb.authStore.record as UserRecord | null)} && uid~"${escapePb(uid.trim())}"`,
    })
    .catch(() => ({ items: [] as UserRecord[] }));
  const looseMatch = loose.items.find((user) => accountIdentityKey(user.uid) === key);
  if (looseMatch) return looseMatch;

  const allUsers = await pb
    .collection("users")
    .getFullList<UserRecord>({
      fields: "id,uid",
      filter: companyFilter(pb.authStore.record as UserRecord | null),
    })
    .catch(() => [] as UserRecord[]);
  return allUsers.find((user) => accountIdentityKey(user.uid) === key) || null;
}
