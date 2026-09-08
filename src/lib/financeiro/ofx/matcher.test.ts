import assert from "node:assert/strict";
import test from "node:test";

import { analisarMovimento, casarComFluxo, casarComTitulos, type CandidatoTransacao } from "./matcher";
import type { OfxMovimento } from "./types";

const BANCO = 7;

function movimento(parcial: Partial<OfxMovimento> = {}): OfxMovimento {
  return {
    sequencia: 1,
    tipoOfx: "DEBIT",
    dataPostagem: "2026-08-04",
    dataDisponivel: null,
    valorCentavos: -583_569,
    fitid: "1",
    checknum: null,
    refnum: null,
    nome: null,
    memo: "PAGAMENTO DE BOLETO",
    ...parcial,
  };
}

function transacao(parcial: Partial<CandidatoTransacao> = {}): CandidatoTransacao {
  return {
    id: 1,
    descricao: "Fornecedor XYZ",
    valor: 5835.69,
    tipo: "DESPESA",
    pendente: false,
    banco_id: BANCO,
    data: "2026-08-04T15:00:00.000Z",
    data_dia: "2026-08-04",
    ...parcial,
  };
}

/* ----------------------------------------------------- Fluxo de Caixa */

test("débito encontra a despesa já liquidada da mesma conta", () => {
  const analise = analisarMovimento(movimento(), [transacao()], BANCO);

  assert.equal(analise.situacao, "MATCH_EXATO");
  assert.equal(analise.score, 100);
  assert.equal(analise.acaoSugerida, "VINCULAR");
  assert.equal(analise.sugestoes[0].origem, "FLUXO");
});

test("crédito encontra a receita, e nunca uma despesa", () => {
  const credito = movimento({ valorCentavos: 97_000, tipoOfx: "CREDIT", memo: "CRED PIX" });
  const receita = transacao({ id: 2, tipo: "RECEITA", valor: 970 });
  const despesa = transacao({ id: 3, tipo: "DESPESA", valor: 970 });

  const analise = analisarMovimento(credito, [receita, despesa], BANCO);
  assert.equal(analise.situacao, "MATCH_EXATO");
  assert.equal(analise.sugestoes[0].transacaoId, 2);
});

test("débito não casa com receita liquidada de mesmo valor", () => {
  const receita = transacao({ tipo: "RECEITA", valor: 5835.69 });
  assert.equal(casarComFluxo(movimento(), [receita], BANCO).length, 0);
});

test("transação de outra conta bancária não é candidata", () => {
  const outra = transacao({ banco_id: 99 });
  assert.equal(casarComFluxo(movimento(), [outra], BANCO).length, 0);
});

test("valor diferente não casa: a comparação é em centavos exatos", () => {
  const quase = transacao({ valor: 5835.7 });
  assert.equal(casarComFluxo(movimento(), [quase], BANCO).length, 0);
});

test("compara o LÍQUIDO movimentado, não o bruto", () => {
  // Venda de R$ 1.000 no cartão, taxa de R$ 30: o extrato mostra R$ 970. É o
  // caso obrigatório — comparar com `valor` faria o usuário criar a receita de
  // novo, em cima da que já existe.
  const credito = movimento({ valorCentavos: 97_000, tipoOfx: "CREDIT", memo: "CRED CARTAO" });
  const venda = transacao({ id: 5, tipo: "RECEITA", valor: 1000, valorLiquido: 970 });

  const analise = analisarMovimento(credito, [venda], BANCO);
  assert.equal(analise.situacao, "MATCH_EXATO");
  assert.equal(analise.sugestoes[0].valorCentavos, 97_000);
});

test("as pernas de uma transferência conciliam como movimento de conta", () => {
  // SAQUE na origem e DEPOSITO no destino movem a conta de verdade; o OFX de
  // cada banco traz uma delas.
  const saida = movimento({ valorCentavos: -250_000, memo: "TRANSFERENCIA ENTRE CONTAS" });
  const perna = transacao({ id: 8, tipo: "SAQUE", valor: 2500, transferencia_id: 3 });

  const analise = analisarMovimento(saida, [perna], BANCO);
  assert.equal(analise.situacao, "MATCH_EXATO");
  assert.equal(analise.sugestoes[0].transacaoId, 8);
});

test("dois movimentos liquidados iguais deixam a linha ambígua", () => {
  const analise = analisarMovimento(
    movimento(),
    [transacao({ id: 1 }), transacao({ id: 2 })],
    BANCO,
  );

  assert.equal(analise.situacao, "AMBIGUO");
  assert.equal(analise.acaoSugerida, null);
  assert.equal(analise.sugestoes.length, 2);
});

test("título abonado ou quitado por crédito do cliente não é movimento de caixa", () => {
  const abonado = transacao({ abonado: true, banco_id: null });
  const antecipado = transacao({ adiantamento_id: 4, banco_id: null, valor_baixado: 0 });

  assert.equal(casarComFluxo(movimento(), [abonado, antecipado], BANCO).length, 0);
});

test("liquidada com mais de três dias de diferença sai da janela", () => {
  const distante = transacao({ data_dia: "2026-08-10", data: "2026-08-10T15:00:00.000Z" });
  assert.equal(casarComFluxo(movimento(), [distante], BANCO).length, 0);
});

/* --------------------------------------------------------- Títulos */

test("título pendente vira sugestão quando não há nada no Fluxo", () => {
  // Boleto que vence dia 05 e foi pago dia 04: data não bate, e é para isso
  // que existe o score.
  const titulo = transacao({
    id: 20,
    pendente: true,
    banco_id: null,
    data_dia: "2026-08-05",
    data: "2026-08-05T15:00:00.000Z",
    metodopagamento: "BOLETO",
  });

  const analise = analisarMovimento(movimento(), [titulo], BANCO);

  assert.equal(analise.situacao, "MATCH_PROVAVEL");
  assert.equal(analise.acaoSugerida, "LIQUIDAR");
  assert.equal(analise.sugestoes[0].origem, "TITULO");
  assert.equal(analise.sugestoes[0].diferencaEmDias, 1);
  // 60 do valor exato, 25 de um dia de diferença, 10 do método compatível.
  assert.equal(analise.sugestoes[0].score, 95);
});

test("crédito não procura conta a pagar, e débito não procura conta a receber", () => {
  const aReceber = transacao({ id: 21, tipo: "RECEITA", pendente: true, banco_id: null });
  assert.equal(casarComTitulos(movimento(), [aReceber]).length, 0);

  const credito = movimento({ valorCentavos: 583_569, tipoOfx: "CREDIT" });
  const aPagar = transacao({ id: 22, tipo: "DESPESA", pendente: true, banco_id: null });
  assert.equal(casarComTitulos(credito, [aPagar]).length, 0);
});

test("três títulos de mesmo valor deixam o PIX ambíguo", () => {
  const pix = movimento({ valorCentavos: -100_000, memo: "DEB PIX ENVIADO", dataPostagem: "2026-08-10" });
  const titulos = [1, 2, 3].map((id) =>
    transacao({
      id: 30 + id,
      valor: 1000,
      pendente: true,
      banco_id: null,
      data_dia: "2026-08-10",
      data: "2026-08-10T15:00:00.000Z",
    }),
  );

  const analise = analisarMovimento(pix, titulos, BANCO);
  assert.equal(analise.situacao, "AMBIGUO");
  assert.equal(analise.sugestoes.length, 3);
});

test("movimento menor que o saldo vira sugestão de baixa parcial", () => {
  const recebimento = movimento({
    valorCentavos: 200_000,
    tipoOfx: "CREDIT",
    memo: "CRED PIX CLIENTE",
    dataPostagem: "2026-08-04",
  });
  const titulo = transacao({
    id: 40,
    tipo: "RECEITA",
    valor: 5000,
    pendente: true,
    banco_id: null,
  });

  const analise = analisarMovimento(recebimento, [titulo], BANCO);
  assert.equal(analise.situacao, "MATCH_PROVAVEL");
  assert.equal(analise.acaoSugerida, "BAIXA_PARCIAL");
  assert.equal(analise.sugestoes[0].parcial, true);
  assert.equal(analise.sugestoes[0].valorCentavos, 500_000);
});

test("o saldo de um título já pago em parte é o que conta", () => {
  const titulo = transacao({
    id: 41,
    tipo: "RECEITA",
    valor: 5000,
    valor_baixado: 3000,
    pendente: true,
    banco_id: null,
  });
  const recebimento = movimento({ valorCentavos: 200_000, tipoOfx: "CREDIT" });

  const sugestoes = casarComTitulos(recebimento, [titulo]);
  assert.equal(sugestoes.length, 1);
  assert.equal(sugestoes[0].parcial, false);
  assert.equal(sugestoes[0].valorCentavos, 200_000);
});

test("movimento maior que o saldo não é candidato a nada", () => {
  const titulo = transacao({ id: 42, pendente: true, banco_id: null, valor: 100 });
  assert.equal(casarComTitulos(movimento(), [titulo]).length, 0);
});

test("título vencido há muito tempo sai da janela", () => {
  const antigo = transacao({
    id: 43,
    pendente: true,
    banco_id: null,
    data_dia: "2026-06-01",
    data: "2026-06-01T15:00:00.000Z",
  });
  assert.equal(casarComTitulos(movimento(), [antigo]).length, 0);
});

test("título de antecipação vai para revisão manual, não para baixa", () => {
  const antecipado = transacao({
    id: 44,
    pendente: true,
    banco_id: null,
    adiantamento_id: 9,
    data_dia: "2026-08-04",
  });

  const analise = analisarMovimento(movimento(), [antecipado], BANCO);
  assert.equal(analise.situacao, "REVISAO_MANUAL");
  assert.equal(analise.acaoSugerida, null);
  assert.ok(analise.observacao);
});

test("sem nada correspondente, a sugestão é criar a transação", () => {
  const iof = movimento({ valorCentavos: -3_157, memo: "DEBITO DE IOF", dataPostagem: "2026-08-03" });

  const analise = analisarMovimento(iof, [], BANCO);
  assert.equal(analise.situacao, "SEM_CORRESPONDENCIA");
  assert.equal(analise.acaoSugerida, "CRIAR");
  assert.equal(analise.sugestoes.length, 0);
});

test("o Fluxo é consultado antes dos títulos, nunca depois", () => {
  // Havendo os dois, a resposta tem que ser o movimento que já existe: baixar o
  // título criaria a segunda despesa que a conciliação existe para impedir.
  const liquidada = transacao({ id: 50 });
  const titulo = transacao({ id: 51, pendente: true, banco_id: null });

  const analise = analisarMovimento(movimento(), [liquidada, titulo], BANCO);
  assert.equal(analise.situacao, "MATCH_EXATO");
  assert.equal(analise.sugestoes[0].transacaoId, 50);
});
