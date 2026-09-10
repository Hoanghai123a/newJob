import { allocateUserUids, observeManualUid } from "./uid-counter";
import { pb, type UserRecord } from "./pocketbase";

export async function generateUid(manualUid?: string): Promise<string> {
  if (manualUid?.trim()) {
    const uid = manualUid.trim().toUpperCase();
    await observeManualUid("user", uid);
    return uid;
  }
  const [uid] = await allocateUserUids(1);
  if (!uid) throw new Error("Không cấp được UID tài khoản.");
  return uid;
}

export async function assignUidIfMissing(userId: string, manualUid?: string): Promise<string> {
  const user = await pb.collection("users").getOne<UserRecord>(userId);
  if (user.uid?.trim()) return user.uid;

  const uid = await generateUid(manualUid);
  await pb.collection("users").update(userId, { uid });
  return uid;
}
