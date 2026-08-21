import { pb, type Role, type UserRecord } from "./pocketbase";

/** Non-authenticated worker profile stored in PocketBase collection `workers`. */
export interface WorkerRecord extends Omit<UserRecord, "role" | "status"> {
  full_name?: string;
  role?: Role;
  status?: "active" | "disabled";
  source_user_id?: string;
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
