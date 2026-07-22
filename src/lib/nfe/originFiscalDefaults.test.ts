import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mapSalesChannelToPresence } from "./originFiscalDefaults";

describe("padrões fiscais das origens", () => {
  it("converte o canal da venda para indicador de presença", () => {
    assert.equal(mapSalesChannelToPresence("PDV"), "1");
    assert.equal(mapSalesChannelToPresence("MERCADO_LIVRE"), "2");
    assert.equal(mapSalesChannelToPresence("TELEFONE"), "3");
    assert.equal(mapSalesChannelToPresence(null), "9");
  });

});
