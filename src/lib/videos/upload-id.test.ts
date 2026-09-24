import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createUploadId } from "./upload-id";

test("upload IDs remain UUID v4 without browser randomUUID", () => {
  const source = { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) } as Pick<Crypto, "getRandomValues">;
  const ids = Array.from({ length: 100 }, () => createUploadId(source));
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(new Set(ids).size, ids.length);
});

test("refuses insecure fallback when Web Crypto is unavailable", () => {
  assert.throws(() => createUploadId({} as Crypto), /HTTPS/);
});
