import assert from "node:assert/strict";
import test from "node:test";
import { civilDate, imovelSchema, prazoDoServico, proprietarioSchema, reservaSchema, solicitacaoServicoSchema } from "./schemas";
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

test("imóvel é só de temporada e descarta valores de locação e venda", () => {
  const property = imovelSchema.parse({ proprietario_id: 1, titulo: "Imóvel", codigo: "A1", slug: "imovel-a1", tipo: "CASA", diaria: 200, valor_locacao: 2500, valor_venda: 300000 });
  assert.deepEqual(property.modalidades, ["TEMPORADA"]);
  assert.equal("valor_locacao" in property, false);
  assert.equal("valor_venda" in property, false);
  assert.throws(() => imovelSchema.parse({ ...property, modalidades: ["TEMPORADA", "LOCACAO"] }));
  assert.throws(() => imovelSchema.parse({ ...property, modalidades: ["VENDA"] }));
  assert.throws(() => imovelSchema.parse({ ...property, percentual_admin: 101 }));
  assert.throws(() => imovelSchema.parse({ ...property, min_noites: 10, max_noites: 2 }));
});

test("cotação pública expõe preços e confirmação sem vínculos privados", () => {
  const quote = cotacaoPublica({ disponivel: true, diarias: [{ data: "2027-01-01", diaria: "120.50" }], valor_diarias: "120.50", taxa_limpeza: "30", valor_total: "150.50", cotacao_id: "quote", expira_em: "2027-01-01T00:15:00Z", proprietario_id: 1 });
  assert.deepEqual(quote.nightlyBreakdown, [{ date: "2027-01-01", amount: 120.5 }]);
  assert.equal(quote.total, 150.5);
  assert.equal("proprietario_id" in quote, false);
  assert.equal(statusReservaPublico("CONFIRMADA"), "CONFIRMED");
  assert.equal(hojeImobiliario(new Date("2027-01-02T01:00:00Z")), "2027-01-01");
});

test("pedido de serviço: vazio vira nulo, descrição tem limite e hora do prazo pede o dia", () => {
  const pedido = solicitacaoServicoSchema.parse({ servico_id: "3", responsavel_id: "", descricao: "  Trocar chuveiro  ", prazo_data: "", prazo_hora: null });
  assert.deepEqual(pedido, { servico_id: 3, responsavel_id: null, descricao: "Trocar chuveiro", prazo_data: null, prazo_hora: null });
  assert.equal(solicitacaoServicoSchema.parse({ servico_id: 1, prazo_data: "2027-03-10" }).prazo_hora, null);
  assert.throws(() => solicitacaoServicoSchema.parse({ servico_id: 1, prazo_hora: "10:00" }));
  assert.throws(() => solicitacaoServicoSchema.parse({ servico_id: 1, descricao: "x".repeat(501) }));
  assert.throws(() => solicitacaoServicoSchema.parse({ servico_id: 1, responsavel_id: "não-é-uuid" }));
  assert.throws(() => solicitacaoServicoSchema.parse({ servico_id: 1, prazo_data: "2027-02-30" }));
  assert.throws(() => solicitacaoServicoSchema.parse({ servico_id: 1, prazo_data: "2027-03-10", prazo_hora: "24:00" }));
  assert.throws(() => solicitacaoServicoSchema.parse({ servico_id: 0 }));
});

test("prazo do serviço é lido no fuso do imobiliário (UTC−3) e sem hora vale até o fim do dia", () => {
  assert.equal(prazoDoServico("2027-03-10", "10:00"), "2027-03-10T13:00:00.000Z");
  assert.equal(prazoDoServico("2027-03-10", null), "2027-03-11T02:59:00.000Z");
  assert.equal(prazoDoServico(null, "10:00"), null);
  assert.equal(prazoDoServico("", ""), null);
});
