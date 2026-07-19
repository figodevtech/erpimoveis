import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeCode128C } from "./code128";

describe("encodeCode128C", () => {
  it("codifica uma chave de acesso numérica em Code 128 C", () => {
    const key = "25260712345678000123550030000000051000000010";
    const encoded = encodeCode128C(key);
    assert.ok(encoded);
    assert.equal(encoded.digits, key);
    assert.ok(encoded.bars.length > 30);
    assert.ok(encoded.width > 250);
    assert.equal(encoded.checksum, 35);
  });

  it("recusa valores com quantidade ímpar de dígitos", () => {
    assert.equal(encodeCode128C("123"), null);
  });
});
