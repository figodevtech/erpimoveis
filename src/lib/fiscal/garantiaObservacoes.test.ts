import assert from "node:assert/strict";
import test from "node:test";

import { comporObservacoesComGarantia } from "./garantiaObservacoes";

test("mantém as observações quando a opção está desligada", () => {
  assert.equal(
    comporObservacoesComGarantia({
      observacoes: "Entregar no período da manhã.",
      garantia: "90 dias",
      incluir: false,
    }),
    "Entregar no período da manhã.",
  );
});

test("ignora garantia vazia", () => {
  assert.equal(
    comporObservacoesComGarantia({ observacoes: "Observação", garantia: "   ", incluir: true }),
    "Observação",
  );
});

test("cria o bloco de garantia quando não há observação", () => {
  assert.equal(
    comporObservacoesComGarantia({ observacoes: null, garantia: "90 dias", incluir: true }),
    "Garantia: 90 dias",
  );
});

test("preserva as observações antes da garantia", () => {
  assert.equal(
    comporObservacoesComGarantia({
      observacoes: "Entregar no período da manhã.",
      garantia: "90 dias para peças e serviços",
      incluir: true,
    }),
    "Entregar no período da manhã.\nGarantia: 90 dias para peças e serviços",
  );
});

test("não duplica um bloco de garantia já composto", () => {
  const composto = "Observação\nGarantia: 90 dias";
  assert.equal(
    comporObservacoesComGarantia({ observacoes: composto, garantia: "90 dias", incluir: true }),
    composto,
  );
});

test("não corta um texto que ultrapassa o limite do emissor", () => {
  const observacoes = "x".repeat(490);
  const composto = comporObservacoesComGarantia({
    observacoes,
    garantia: "90 dias para peças e serviços",
    incluir: true,
  });
  assert.ok(composto.length > 500);
  assert.ok(composto.endsWith("Garantia: 90 dias para peças e serviços"));
});
