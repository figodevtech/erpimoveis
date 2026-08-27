import assert from "node:assert/strict";
import test from "node:test";

import { OPERATIONAL_EVENT_TYPES } from "./contracts";
import { operationalVisualFor } from "./event-mapping";

test("cada evento conhecido possui modulo, estado, direcao e prioridade", () => {
  for (const type of OPERATIONAL_EVENT_TYPES) {
    const mapping = operationalVisualFor(type);
    assert.ok(mapping.modulo);
    assert.ok(mapping.estado);
    assert.ok(["PARA_NUCLEO", "DO_NUCLEO"].includes(mapping.direcao));
    assert.ok(["INFO", "ATENCAO", "CRITICO"].includes(mapping.prioridade));
  }
});

test("eventos de estoque saem do nucleo e rejeicoes fiscais sao criticas", () => {
  assert.equal(operationalVisualFor("ESTOQUE_SAIDA").direcao, "DO_NUCLEO");
  assert.equal(operationalVisualFor("NFE_REJEITADA").prioridade, "CRITICO");
  assert.equal(operationalVisualFor("NFSE_REJEITADA").modulo, "FISCAL");
});
