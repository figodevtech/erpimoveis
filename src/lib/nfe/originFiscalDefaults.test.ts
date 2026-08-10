import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mapPaymentMethodToNFe, mapSalesChannelToPresence } from "./originFiscalDefaults";

describe("padrões fiscais das origens", () => {
  it("converte o canal da venda para indicador de presença", () => {
    assert.equal(mapSalesChannelToPresence("PDV"), "1");
    assert.equal(mapSalesChannelToPresence("MERCADO_LIVRE"), "2");
    assert.equal(mapSalesChannelToPresence("TELEFONE"), "3");
    assert.equal(mapSalesChannelToPresence(null), "9");
  });

  it("converte as formas de pagamento da OS para tPag", () => {
    assert.equal(mapPaymentMethodToNFe("DINHEIRO"), "01");
    assert.equal(mapPaymentMethodToNFe("CREDITO"), "03");
    assert.equal(mapPaymentMethodToNFe("CARTAO_DE_DEBITO"), "04");
    assert.equal(mapPaymentMethodToNFe("BOLETO"), "15");
    assert.equal(mapPaymentMethodToNFe("PIX"), "17");
    assert.equal(mapPaymentMethodToNFe("TRANSFERENCIA"), "18");
    assert.equal(mapPaymentMethodToNFe("CONVENIO_INTERNO"), "99");
  });

});
