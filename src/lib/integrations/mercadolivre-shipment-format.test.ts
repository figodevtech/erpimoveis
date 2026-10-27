import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  readShipmentLogistics,
  readShipmentReceiverAddress,
  resolveMercadoLivreInvoiceChannel,
} from "./mercadolivre-shipment-format";

// Recorte do envio Flex do pedido 2000019179097778 (BR Peças, out/2026), como
// a API devolve com `x-format-new`.
const envioFlexFormatoNovo = {
  id: 48352760584,
  status: "ready_to_ship",
  substatus: "printed",
  logistic: { mode: "me2", type: "self_service", direction: "forward" },
  destination: {
    receiver_name: "Comprador Teste",
    receiver_phone: "XXXXXXX",
    shipping_address: {
      street_name: "Rua agenor Lacet",
      street_number: "247",
      city: { name: "João Pessoa" },
      state: { id: "BR-PB", name: "Paraíba" },
      neighborhood: { name: "Estados" },
      zip_code: "58030070",
    },
  },
};

describe("envio do Mercado Livre nos dois formatos", () => {
  it("lê modo e tipo logístico do formato novo — antes ficavam nulos e o Flex virava envio personalizado", () => {
    assert.deepEqual(readShipmentLogistics(envioFlexFormatoNovo), { mode: "me2", logisticType: "self_service" });
  });

  it("continua lendo o formato antigo", () => {
    assert.deepEqual(readShipmentLogistics({ mode: "me2", logistic_type: "drop_off" }), { mode: "me2", logisticType: "drop_off" });
    assert.deepEqual(readShipmentLogistics(null), { mode: null, logisticType: null });
  });

  it("acha o endereço do comprador em destination e traz quem recebe", () => {
    const endereco = readShipmentReceiverAddress(envioFlexFormatoNovo);
    assert.equal(endereco?.street_name, "Rua agenor Lacet");
    assert.equal(endereco?.city?.name, "João Pessoa");
    assert.equal(endereco?.receiver_name, "Comprador Teste");
    assert.equal(readShipmentReceiverAddress({ receiver_address: { zip_code: "01001000" } })?.zip_code, "01001000");
    assert.equal(readShipmentReceiverAddress({}), null);
  });
});

describe("por onde a NF-e entra no Mercado Livre", () => {
  it("Flex gravado com colunas vazias anexa ao pedido, lendo a logística do envio bruto", () => {
    assert.equal(
      resolveMercadoLivreInvoiceChannel({ ml_shipment_id: 48352760584, shipping_mode: null, logistic_type: null, raw_shipment: envioFlexFormatoNovo }),
      "pack",
    );
  });

  it("coleta e agência importam no envio; Full não recebe nota do vendedor", () => {
    for (const tipo of ["drop_off", "xd_drop_off", "cross_docking"]) {
      assert.equal(resolveMercadoLivreInvoiceChannel({ ml_shipment_id: 1, shipping_mode: "me2", logistic_type: tipo }), "shipment");
    }
    assert.equal(resolveMercadoLivreInvoiceChannel({ ml_shipment_id: 1, shipping_mode: "me2", logistic_type: "fulfillment" }), "fulfillment");
  });

  it("ME1, personalizado e pedido sem envio anexam ao pedido", () => {
    assert.equal(resolveMercadoLivreInvoiceChannel({ ml_shipment_id: 1, shipping_mode: "me1", logistic_type: null }), "pack");
    assert.equal(resolveMercadoLivreInvoiceChannel({ ml_shipment_id: 1, shipping_mode: "custom", logistic_type: "custom" }), "pack");
    assert.equal(resolveMercadoLivreInvoiceChannel({ ml_shipment_id: null, shipping_mode: null, logistic_type: null }), "pack");
  });

  it("envio ainda não sincronizado não chuta o caminho", () => {
    assert.equal(resolveMercadoLivreInvoiceChannel({ ml_shipment_id: 1, shipping_mode: null, logistic_type: null, raw_shipment: {} }), "unknown");
    assert.equal(resolveMercadoLivreInvoiceChannel({ ml_shipment_id: 1, shipping_mode: "me2", logistic_type: null }), "unknown");
  });
});
