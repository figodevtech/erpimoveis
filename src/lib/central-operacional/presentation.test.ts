import assert from "node:assert/strict";
import test from "node:test";

import { OPERATIONAL_MODULES } from "./contracts";
import {
  OPERATIONAL_MODULE_PRESENTATION,
  operationalPresentationFor,
} from "./presentation";

test("todas as categorias possuem apresentação, ícone e tom únicos", () => {
  const presentations = OPERATIONAL_MODULES.map((operationalModule) => operationalPresentationFor(operationalModule));

  assert.deepEqual(Object.keys(OPERATIONAL_MODULE_PRESENTATION), [...OPERATIONAL_MODULES]);
  assert.equal(new Set(presentations.map((presentation) => presentation.tone)).size, OPERATIONAL_MODULES.length);
  assert.equal(new Set(presentations.map((presentation) => presentation.icon)).size, OPERATIONAL_MODULES.length);

  for (const presentation of presentations) {
    assert.ok(presentation.label);
    assert.ok(presentation.compactLabel);
  }

  assert.equal(operationalPresentationFor("FINANCEIRO").label, "FLUXO DE CAIXA");
  assert.equal(operationalPresentationFor("CONTAS_RECEBER").label, "CONTAS A RECEBER");
});
