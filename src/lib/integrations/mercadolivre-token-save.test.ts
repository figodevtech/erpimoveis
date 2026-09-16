import { test } from "node:test";
import assert from "node:assert/strict";
import { persistRotatedToken } from "./mercadolivre-token-save";

test("gravação normal não consulta novamente nem espera", async () => {
  await persistRotatedToken(async () => "saved", async () => { throw Error("consulta desnecessária"); }, async () => { throw Error("espera desnecessária"); });
});
test("falha transitória repete somente a persistência", async () => {
  let calls = 0;
  await persistRotatedToken(async () => { if (++calls === 1) throw Error("network"); return "saved"; }, async () => false, async () => {});
  assert.equal(calls, 2);
});
test("resposta perdida reconhece token já salvo", async () => {
  let calls = 0;
  await persistRotatedToken(async () => { if (++calls === 1) throw Error("network"); return "conflict"; }, async () => true, async () => {});
  assert.equal(calls, 2);
});
test("mudança concorrente não sobrescreve conta nem insiste", async () => {
  let calls = 0;
  await assert.rejects(persistRotatedToken(async () => { calls++; return "conflict"; }, async () => false), /mudou durante/);
  assert.equal(calls, 1);
});
test("falha persistente tem limite de três tentativas", async () => {
  let calls = 0;
  await assert.rejects(persistRotatedToken(async () => { calls++; throw Error("offline"); }, async () => false, async () => {}), /persistir/);
  assert.equal(calls, 3);
});
