import test from "node:test";
import assert from "node:assert/strict";
import {
  buildUsernames,
  mapRelationId,
  relationDependencies,
} from "./migrate-jobconnect-to-hl.mjs";

test("buildUsernames tạo username HL ổn định và không trùng", () => {
  const result = buildUsernames([
    { id: "a", username: "NV 01" },
    { id: "b", username: "NV 01" },
  ]);
  assert.equal(result.get("a"), "hl__nv_01");
  assert.equal(result.get("b"), "hl__nv_01_2");
});

test("mapRelationId không trả lại ID nguồn khi thiếu mapping", () => {
  const maps = new Map([["users", new Map([["source-user", "target-user"]])]]);
  assert.equal(mapRelationId("users", "source-user", maps), "target-user");
  assert.equal(mapRelationId("users", "missing-user", maps), "");
});

test("relationDependencies nhận diện collection phụ thuộc", () => {
  const sourceCollections = [
    { id: "users-id", name: "users" },
    { id: "factory-id", name: "factories" },
  ];
  const collection = {
    name: "employment_histories",
    fields: [
      { type: "relation", name: "user", collectionId: "users-id" },
      { type: "relation", name: "factory", collectionId: "factory-id" },
    ],
  };
  assert.deepEqual(relationDependencies(collection, sourceCollections), ["factories"]);
});
