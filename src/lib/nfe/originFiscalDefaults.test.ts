import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NFE_PAYMENT_OPTIONS, mapPaymentMethodToNFe, mapSalesChannelToPresence, paymentOptionsForModel } from "./originFiscalDefaults";

describe("padrões fiscais das origens", () => {
  it("oferece Duplicata Mercantil como método fiscal separado do boleto", () => {
    const duplicata = NFE_PAYMENT_OPTIONS.find((option) => option.value === "14");
    assert.equal(duplicata?.label, "Duplicata Mercantil");
    assert.ok(NFE_PAYMENT_OPTIONS.findIndex((option) => option.value === "14") < NFE_PAYMENT_OPTIONS.findIndex((option) => option.value === "15"));
    assert.equal(mapPaymentMethodToNFe("BOLETO"), "15");
    assert.ok(paymentOptionsForModel(55).some((option) => option.value === "14"));
    assert.ok(!paymentOptionsForModel(65).some((option) => option.value === "14"));
  });
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
