import type { UserRecord } from "./pocketbase";

/** Returns true if the user has filled the essential profile fields. */
export function isProfileComplete(user: Partial<UserRecord> | null | undefined): boolean {
  if (!user) return false;
  const required: Array<keyof UserRecord> = [
    "full_name",
    "phone",
    "bank_name",
    "bank_account_number",
    "bank_account_name",
  ];
  return required.every((k) => {
    const v = (user as any)[k];
    return typeof v === "string" ? v.trim().length > 0 : !!v;
  });
}
