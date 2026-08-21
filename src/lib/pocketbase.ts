import PocketBase from "pocketbase";
import { PB_URL } from "./pocketbase-config";

export const pb = new PocketBase(PB_URL);
pb.autoCancellation(false);

export type Role = "super_admin" | "admin" | "user" | "staff";

export interface UserRecord {
  id: string;
  username?: string;
  login_name?: string;
  email?: string;
  phone?: string;
  full_name?: string;
  cccd?: string;
  cccd_issue_date?: string;
  uid?: string;
  role?: Role;
  company?: string;
  tenant_company?: string;
  approved?: boolean | string;
  approvalStatus?: "pending" | "approved" | "rejected";
  status?: "active" | "disabled";
  bank_name?: string;
  bank_account_number?: string;
  bank_account_name?: string;
  bank_account_note?: string;
  collectionId?: string;
  collectionName?: string;
  avatar?: string;
  gender?: string;
  date_of_birth?: string;
  address?: string;
  must_change_password?: boolean;
  last_login?: string;
}

/** Convert base64 dataURL to File (per HRJob skill rule #1) */
export function dataUrlToFile(dataUrl: string, filename: string): File {
  const [meta, b64] = dataUrl.split(",");
  const mime = /data:(.*?);base64/.exec(meta)?.[1] || "image/png";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new File([arr], filename, { type: mime });
}

export function fileUrl(record: any, filename?: string) {
  if (!record || !filename) return "";
  return pb.files.getURL(record, filename);
}
