const MAX_UID_ATTEMPTS = 20;
const UID_INCREMENT_STEP = 5;

export function isUidUniqueConstraintError(error: unknown) {
  const data =
    typeof error === "object" && error !== null && "data" in error
      ? (error.data as { data?: Record<string, unknown> }).data
      : undefined;
  const uidError = data?.uid;
  const message =
    typeof uidError === "object" && uidError !== null && "message" in uidError
      ? String(uidError.message)
      : String(uidError ?? "");
  return /value must be unique|unique.*constraint/i.test(message);
}

export async function createWithUidRetry<T>(
  initialUid: string,
  create: (uid: string) => Promise<T>,
  allocateNext: (forceScan: boolean) => Promise<string[]>,
): Promise<{ uid: string; record: T }> {
  let uid = initialUid;
  for (let attempt = 0; attempt < MAX_UID_ATTEMPTS; attempt += 1) {
    try {
      return { uid, record: await create(uid) };
    } catch (error) {
      if (!isUidUniqueConstraintError(error) || attempt === MAX_UID_ATTEMPTS - 1) throw error;
      const nextUids = await allocateNext(attempt === 0);
      const nextUid = nextUids[UID_INCREMENT_STEP - 1];
      if (!nextUid) throw new Error("Không cấp được UID tiếp theo để tạo NLĐ.");
      uid = nextUid;
    }
  }
  throw new Error(`Không tạo được NLĐ sau ${MAX_UID_ATTEMPTS} UID.`);
}
