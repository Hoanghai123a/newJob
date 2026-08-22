import { pb } from "./pocketbase";

/** Non-authenticated worker profile stored in PocketBase collection `workers`. */
export interface WorkerRecord {
  id: string;
  full_name?: string;
  phone?: string;
  uid?: string;
  cccd?: string;
  cccd_issue_date?: string;
  gender?: string;
  date_of_birth?: string;
  address?: string;
  bank_name?: string;
  bank_account_number?: string;
  bank_account_name?: string;
  bank_account_note?: string;
  employee_code?: string;
  tenant_company?: string;
  company?: string;
  status?: "active" | "inactive";
  source_user_id?: string;
  created?: string;
  updated?: string;
}

export function workerDisplayName(worker: Pick<WorkerRecord, "full_name" | "phone" | "uid">) {
  return worker.full_name?.trim() || worker.phone?.trim() || worker.uid?.trim() || "Thiếu thông tin";
}

export async function getWorker(workerId: string) {
  return (await pb.collection("workers").getOne(workerId)) as unknown as WorkerRecord;
}

export async function updateWorker(
  workerId: string,
  payload: Partial<Omit<WorkerRecord, "id" | "created" | "updated">> | FormData,
) {
  return (await pb.collection("workers").update(workerId, payload)) as unknown as WorkerRecord;
}

export type StaffAccountRecord = UserRecord;
