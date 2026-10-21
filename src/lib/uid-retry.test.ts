import assert from "node:assert/strict";
import test from "node:test";
import { createWithUidRetry, isUidUniqueConstraintError } from "./uid-retry.ts";

function uidError(field = "uid", message = "Value must be unique") {
  return Object.assign(new Error(message), {
    data: { data: { [field]: { message } } },
  });
}

test("retries UID collisions and forces one counter rescan", async () => {
  const attempted: string[] = [];
  const forceScans: boolean[] = [];
  const result = await createWithUidRetry(
    "UID1",
    async (uid) => {
      attempted.push(uid);
      if (uid !== "UID11") throw uidError();
      return `worker:${uid}`;
    },
    async (forceScan) => {
      forceScans.push(forceScan);
      const start = forceScans.length === 1 ? 2 : 7;
      return Array.from({ length: 5 }, (_, index) => `UID${start + index}`);
    },
  );

  assert.deepEqual(attempted, ["UID1", "UID6", "UID11"]);
  assert.deepEqual(forceScans, [true, false]);
  assert.deepEqual(result, { uid: "UID11", record: "worker:UID11" });
  assert.equal(isUidUniqueConstraintError(uidError("phone")), false);
  assert.equal(isUidUniqueConstraintError(uidError("uid", "Required")), false);
});

test("stops after at most 20 UID candidates", async () => {
  let createCalls = 0;
  let allocationCalls = 0;
  let nextUidValue = 2;
  const collision = uidError();

  await assert.rejects(
    createWithUidRetry(
      "UID1",
      async () => {
        createCalls += 1;
        throw collision;
      },
      async () => {
        allocationCalls += 1;
        return Array.from({ length: 5 }, () => `UID${nextUidValue++}`);
      },
    ),
    (error) => error === collision,
  );

  assert.equal(createCalls, 20);
  assert.equal(allocationCalls, 19);
});
