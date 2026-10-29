import assert from "node:assert/strict";
import test from "node:test";
import { civilDate, imovelSchema, proprietarioSchema, reservaSchema, locacaoSchema, vendaImovelSchema } from "./schemas";
import { cotacaoPublica, hojeImobiliario, statusReservaPublico } from "./types";

test("cadastro de proprietário valida documento PF/PJ e descarta campos de autorização", () => {
  const owner = proprietarioSchema.parse({ nomerazaosocial: "Proprietário de teste", tipopessoa: "FISICA", cpfcnpj: "529.982.247-25", user_id: "forjado", perfilid: 1 });
  assert.equal("user_id" in owner, false);
  assert.equal("perfilid" in owner, false);
  assert.throws(() => proprietarioSchema.parse({ ...owner, cpfcnpj: "11111111111" }));
  assert.throws(() => proprietarioSchema.parse({ ...owner, tipopessoa: "JURIDICA" }));
});

test("datas civis recusam dia inexistente e reserva exige saída posterior", () => {
  assert.equal(civilDate.parse("2028-02-29"), "2028-02-29");
  assert.throws(() => civilDate.parse("2027-02-29"));
  const reservation = { imovel_id: 1, cliente_id: 1, inicio: "2027-02-01", fim: "2027-02-02", hospedes: 1, idempotency_key: "request-123" };
  assert.equal(reservaSchema.parse(reservation).origem, "ERP");
  assert.throws(() => reservaSchema.parse({ ...reservation, fim: reservation.inicio }));
  assert.throws(() => reservaSchema.parse({ ...reservation, hospedes: 0 }));
  assert.throws(() => reservaSchema.parse({ ...reservation, expected_total: -10 }));
});

test("modalidades simultâneas e valores por modalidade têm contrato distinto", () => {
  const property = imovelSchema.parse({ proprietario_id: 1, titulo: "Imóvel", codigo: "A1", slug: "imovel-a1", tipo: "CASA", modalidades: ["VENDA", "LOCACAO", "TEMPORADA"], diaria: 200, valor_locacao: 2500, valor_venda: 300000 });
  assert.equal(property.modalidades.length, 3);
  assert.equal(property.valor_locacao, 2500);
  assert.throws(() => imovelSchema.parse({ ...property, modalidades: ["OFICINA"] }));
  assert.throws(() => imovelSchema.parse({ ...property, percentual_admin: 101 }));
  assert.throws(() => imovelSchema.parse({ ...property, min_noites: 10, max_noites: 2 }));
});

test("contratos não aceitam fim anterior e venda recusa comissão fora de faixa", () => {
  const contract = { imovel_id: 1, cliente_id: 1, inicio: "2027-01-01", valor_mensal: 1500, dia_vencimento: 5 };
  assert.equal(locacaoSchema.parse(contract).fim, undefined);
  assert.throws(() => locacaoSchema.parse({ ...contract, fim: "2026-01-01" }));
  assert.throws(() => vendaImovelSchema.parse({ imovel_id: 1, comprador_id: 1, valor_total: 100000, comissao_percentual: 101 }));
});

test("cotação pública expõe preços e confirmação sem vínculos privados", () => {
  const quote = cotacaoPublica({ disponivel: true, diarias: [{ data: "2027-01-01", diaria: "120.50" }], valor_diarias: "120.50", taxa_limpeza: "30", valor_total: "150.50", cotacao_id: "quote", expira_em: "2027-01-01T00:15:00Z", proprietario_id: 1 });
  assert.deepEqual(quote.nightlyBreakdown, [{ date: "2027-01-01", amount: 120.5 }]);
  assert.equal(quote.total, 150.5);
  assert.equal("proprietario_id" in quote, false);
  assert.equal(statusReservaPublico("CONFIRMADA"), "CONFIRMED");
  assert.equal(hojeImobiliario(new Date("2027-01-02T01:00:00Z")), "2027-01-01");
});
