import assert from "node:assert/strict";
import test from "node:test";
import { radioCreateSchema, radioPatchSchema } from "./validation";

test("criacao preserva defaults e exige fonte quando ativa", () => {
  assert.equal(radioCreateSchema.safeParse({ name: "Teste" }).success, false);
  const radio = radioCreateSchema.parse({ name: " Teste ", streamUrl: "https://radio.example/stream" });
  assert.equal(radio.name, "Teste");
  assert.equal(radio.active, true);
  assert.equal(radio.type, "RADIO");
  assert.equal(radio.country, "Brasil");
  assert.equal(radio.city, null);
  assert.deepEqual(radio.genres, []);
  assert.equal(radioCreateSchema.parse({ name: "Teste", active: false }).streamUrl, null);
});

test("PATCH preserva campos ausentes sem defaults ou valores nulos adicionais", () => {
  assert.deepEqual(radioPatchSchema.parse({ name: " Novo nome " }), { name: "Novo nome" });
  assert.deepEqual(radioPatchSchema.parse({ active: false }), { active: false });
  assert.deepEqual(radioPatchSchema.parse({ city: "" }), { city: null });
});

test("PATCH vazio ou apenas com campos desconhecidos continua invalido", () => {
  assert.equal(radioPatchSchema.safeParse({}).success, false);
  assert.equal(radioPatchSchema.safeParse({ desconhecido: true }).success, false);
});

test("radio rejeita fontes fora de HTTP/HTTPS", () => {
  for (const streamUrl of ["javascript:alert(1)", "file:///teste", "url-invalida"]) {
    assert.equal(radioCreateSchema.safeParse({ name: "Teste", streamUrl }).success, false);
  }
});
