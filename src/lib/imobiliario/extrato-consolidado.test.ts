import assert from "node:assert/strict";
import test from "node:test";
import { consolidarMovimentos } from "./extrato-consolidado";

const pago = "2026-11-09T15:00:00+00:00";

test("ajuste da taxa vira uma linha só, na data e com a descrição do pagamento", () => {
  // Reserva #64: taxa automática de 14% e o ajuste para 20% gravado como diferença.
  const itens = consolidarMovimentos([
    { id: 285, transacao_chave: 286, tipo: "BRUTO_RECEBIDO", valor: 598, data_movimento: pago, descricao: "Reserva #64" },
    { id: 286, transacao_chave: 286, tipo: "TAXA_ADMIN", valor: 83.72, data_movimento: pago, descricao: "Reserva #64" },
    { id: 290, transacao_chave: 286, tipo: "TAXA_ADMIN", valor: 35.88, data_movimento: pago, descricao: "Reserva #64" },
  ]);
  assert.equal(itens.length, 2);
  const taxa = itens.find((item) => item.tipo === "TAXA_ADMIN")!;
  assert.equal(taxa.valor, 119.6);
  assert.equal(taxa.data_movimento, pago);
  // A taxa se distingue do recebimento: diz o percentual efetivo e a base.
  assert.equal(taxa.descricao, "20% sobre R$ 598,00 recebidos · Reserva #64");
  assert.equal(itens.find((item) => item.tipo === "BRUTO_RECEBIDO")!.descricao, "Reserva #64");
});

test("estorno da taxa no reembolso fala em valor reembolsado", () => {
  const taxa = consolidarMovimentos([
    { id: 1, transacao_chave: 50, tipo: "BRUTO_RECEBIDO", valor: -200, data_movimento: pago, descricao: "Reembolso #64" },
    { id: 2, transacao_chave: 50, tipo: "TAXA_ADMIN", valor: -28, data_movimento: pago, descricao: "Reembolso #64" },
  ]).find((item) => item.tipo === "TAXA_ADMIN")!;
  assert.equal(taxa.descricao, "14% sobre R$ 200,00 reembolsados · Reembolso #64");
});

test("redução da taxa mantém a data e a descrição do pagamento, não as do estorno", () => {
  const [taxa] = consolidarMovimentos([
    { id: 1, transacao_chave: 9, tipo: "TAXA_ADMIN", valor: 83.72, data_movimento: pago, descricao: "Reserva #64" },
    { id: 2, transacao_chave: 9, tipo: "TAXA_ADMIN", valor: -23.92, data_movimento: "2026-11-12T18:00:00+00:00", descricao: "Estorno: Reserva #64" },
  ]);
  assert.equal(taxa.valor, 59.8);
  assert.equal(taxa.descricao, "Reserva #64");
  assert.equal(taxa.data_movimento, pago);
});

test("lançamento editado mostra a versão nova; estornado por inteiro some", () => {
  const itens = consolidarMovimentos([
    { id: 10, lancamento_id: 5, tipo: "DESPESA_PROPRIETARIO", valor: 50, data_movimento: "2026-11-12T15:00:00+00:00", descricao: "LIMPEZA" },
    { id: 11, lancamento_id: 5, tipo: "DESPESA_PROPRIETARIO", valor: -50, data_movimento: "2026-11-12T15:00:00+00:00", descricao: "Ajuste: LIMPEZA" },
    { id: 12, lancamento_id: 5, tipo: "DESPESA_PROPRIETARIO", valor: 60, data_movimento: "2026-11-13T15:00:00+00:00", descricao: "Limpeza de saída" },
    { id: 20, transacao_chave: 30, tipo: "BRUTO_RECEBIDO", valor: 100, data_movimento: pago, descricao: "Pagamento excluído" },
    { id: 21, transacao_chave: 30, tipo: "BRUTO_RECEBIDO", valor: -100, data_movimento: pago, descricao: "Estorno: Pagamento excluído" },
  ]);
  assert.deepEqual(itens.map((item) => [item.descricao, item.valor]), [["Limpeza de saída", 60]]);
});

test("repasse ainda não pago aparece como pendente, separado do que já foi pago", () => {
  const itens = consolidarMovimentos([
    // Lançamento 37 antes da regra nova: registrado e depois devolvido ao saldo (soma zero).
    { id: 289, lancamento_id: 37, tipo: "REPASSE", valor: 478.4, data_movimento: pago, descricao: "Repasse da Reserva #64" },
    { id: 300, lancamento_id: 37, tipo: "REPASSE", valor: -478.4, data_movimento: pago, descricao: "Aguardando pagamento: Repasse da Reserva #64" },
    // O que falta pagar, montado a partir do lançamento.
    { id: -37, lancamento_id: 37, tipo: "REPASSE", valor: 478.4, data_movimento: pago, descricao: "Repasse da Reserva #64", repasse_pendente: true },
    // Repasse parcialmente pago: o pago e o pendente em linhas separadas.
    { id: 310, lancamento_id: 38, tipo: "REPASSE", valor: 100, data_movimento: pago, descricao: "Repasse parcial" },
    { id: -38, lancamento_id: 38, tipo: "REPASSE", valor: 50, data_movimento: pago, descricao: "Repasse parcial", repasse_pendente: true },
  ]);
  assert.deepEqual(itens.map((item) => [item.descricao, item.valor]).sort(), [
    ["Repasse da Reserva #64 (pendente)", 478.4],
    ["Repasse parcial (pendente)", 50],
    ["Repasse parcial", 100],
  ]);
});

test("reembolso (só negativos) e movimentos sem vínculo continuam como estão", () => {
  const itens = consolidarMovimentos([
    { id: 1, transacao_chave: 40, tipo: "BRUTO_RECEBIDO", valor: -200, data_movimento: pago, descricao: "Reembolso" },
    { id: 2, tipo: "REPASSE", valor: 300, data_movimento: pago, descricao: "Repasse antigo" },
    { id: 3, tipo: "REPASSE", valor: 300, data_movimento: pago, descricao: "Outro repasse antigo" },
  ]);
  assert.equal(itens.length, 3);
  assert.equal(itens.find((item) => item.id === 1)!.valor, -200);
});
