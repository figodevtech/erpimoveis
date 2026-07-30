import assert from "node:assert/strict";
import test from "node:test";
import { usoConsumoItemPatchSchema } from "./schemas";

test("aceita expectedUpdatedAt retornado pelo PostgREST com offset", () => {
  const result = usoConsumoItemPatchSchema.safeParse({
    titulo: "Item atualizado",
    expectedUpdatedAt: "2026-07-29T18:30:00.123+00:00",
  });

  assert.equal(result.success, true);
});

test("continua aceitando expectedUpdatedAt em UTC com sufixo Z", () => {
  const result = usoConsumoItemPatchSchema.safeParse({
    titulo: "Item atualizado",
    expectedUpdatedAt: "2026-07-29T18:30:00.123Z",
  });

  assert.equal(result.success, true);
});

test("rejeita expectedUpdatedAt que não seja uma data válida", () => {
  const result = usoConsumoItemPatchSchema.safeParse({
    titulo: "Item atualizado",
    expectedUpdatedAt: "data-invalida",
  });

  assert.equal(result.success, false);
});
