import { allocateUserUids, isUniqueConstraintError, observeManualUid } from "./uid-counter";
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
  try {
    await pb.collection("users").update(userId, { uid });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    // UID vừa cấp đã tồn tại — bộ đếm bị lệch; quét lại max thực tế rồi thử lại
    const [retryUid] = await allocateUserUids(1, { forceScan: true });
    if (!retryUid) throw new Error("Không cấp được UID tài khoản sau khi đồng bộ bộ đếm.");
    await pb.collection("users").update(userId, { uid: retryUid });
    return retryUid;
  }
  return uid;
}
