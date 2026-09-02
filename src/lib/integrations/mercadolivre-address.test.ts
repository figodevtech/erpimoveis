import assert from "node:assert/strict";
import test from "node:test";
import { selectMercadoLivreShippingAddress, selectMercadoLivreShippingAddressSummary } from "./mercadolivre-address";

test("prioriza o endereço ativo marcado para envio", () => {
  const selected = selectMercadoLivreShippingAddress([
    { id: 1, address_line: "Rua Venda, 10", zip_code: "58000000", city: { name: "João Pessoa" }, state: { name: "Paraíba" }, types: ["default_selling_address"], status: "active" },
    { id: 2, address_line: "Rua Expedição, 20", zip_code: "58088000", city: { id: "CITY", name: "João Pessoa" }, state: { id: "BR-PB", name: "Paraíba" }, types: ["shipping"], status: "active", normalized: true },
  ]);

  assert.equal(selected?.id, "2");
  assert.equal(selected?.zipCode, "58088000");
  assert.equal(selected?.cityId, "CITY");
  assert.equal(selected?.stateId, "BR-PB");
});

test("ignora endereço de envio inativo e usa o endereço padrão de venda", () => {
  const selected = selectMercadoLivreShippingAddress({ addresses: [
    { id: 1, types: ["shipping"], status: "inactive" },
    { id: 2, address_line: "Rua Principal, 30", types: ["default_selling_address"], status: "active" },
  ] });

  assert.equal(selected?.id, "2");
  assert.equal(selected?.addressLine, "Rua Principal, 30");
});

test("usa a localizaÃ§Ã£o pÃºblica do anÃºncio quando o endereÃ§o completo Ã© protegido", () => {
  const selected = selectMercadoLivreShippingAddressSummary({
    seller_address: {
      city: { id: "TUxCQ0pPQU8x", name: "JoÃ£o Pessoa" },
      state: { id: "BR-PB", name: "ParaÃ­ba" },
      country: { id: "BR", name: "Brasil" },
    },
  }, "listing");

  assert.equal(selected?.city, "JoÃ£o Pessoa");
  assert.equal(selected?.stateId, "BR-PB");
  assert.equal(selected?.source, "listing");
  assert.equal(selected?.partial, true);
});

test("normaliza cidade e estado em texto retornados pelo perfil", () => {
  const selected = selectMercadoLivreShippingAddressSummary({
    address: { city: "JoÃ£o Pessoa", state: "BR-PB" },
  }, "seller_profile");

  assert.equal(selected?.city, "JoÃ£o Pessoa");
  assert.equal(selected?.state, "BR-PB");
});
