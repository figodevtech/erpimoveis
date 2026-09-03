import assert from "node:assert/strict";
import test from "node:test";

import {
  eventosAtivos,
  margemDoLucro,
  ordenarEventosDaOs,
  outrasOrigensDaOs,
  somarEventosDaOs,
  type EventoFinanceiroOs,
} from "./eventos-financeiros";

function evento(valores: Partial<EventoFinanceiroOs> & { id: number }): EventoFinanceiroOs {
  return {
    origem: "PRODUTO",
    natureza: "RECEITA",
    status: "ATIVO",
    valor: 0,
    produtoid: null,
    servicoid: null,
    chave_origem: null,
    ...valores,
  };
}

const chaves = (eventos: EventoFinanceiroOs[]) => eventos.map((item) => item.id);

test("no produto o custo vem antes da venda; no serviço a receita vem antes do custo", () => {
  const eventos = [
    evento({ id: 1, origem: "PRODUTO", natureza: "RECEITA", produtoid: 7 }),
    evento({ id: 2, origem: "PRODUTO", natureza: "DESPESA", produtoid: 7 }),
    evento({ id: 3, origem: "SERVICO", natureza: "DESPESA", servicoid: 4 }),
    evento({ id: 4, origem: "SERVICO", natureza: "RECEITA", servicoid: 4 }),
  ];

  assert.deepEqual(chaves(ordenarEventosDaOs(eventos)), [2, 1, 4, 3]);
});

test("produto vem antes de serviço, e o avulso fecha a lista", () => {
  const eventos = [
    evento({ id: 9, origem: "FRETE", natureza: "RECEITA" }),
    evento({ id: 5, origem: "SERVICO", natureza: "RECEITA", servicoid: 1 }),
    evento({ id: 3, origem: "PRODUTO", natureza: "DESPESA", produtoid: 2 }),
  ];

  assert.deepEqual(chaves(ordenarEventosDaOs(eventos)), [3, 5, 9]);
});

test("a comissão fecha o grupo do serviço a que pertence", () => {
  const eventos = [
    evento({ id: 1, origem: "COMISSAO", natureza: "DESPESA", servicoid: 4, chave_origem: "4:abc" }),
    evento({ id: 2, origem: "SERVICO", natureza: "RECEITA", servicoid: 4 }),
    evento({ id: 3, origem: "SERVICO", natureza: "DESPESA", servicoid: 4 }),
  ];

  assert.deepEqual(chaves(ordenarEventosDaOs(eventos)), [2, 3, 1]);
});

test("despesa manual de serviço cai sob o serviço dela, e não num grupo à parte", () => {
  const eventos = [
    evento({ id: 1, origem: "SERVICO", natureza: "RECEITA", servicoid: 4 }),
    // A chave é MANUAL:<uuid>, mas o vínculo que vale é o servicoid.
    evento({ id: 2, origem: "SERVICO", natureza: "DESPESA", servicoid: 4, chave_origem: "MANUAL:9f1c" }),
    evento({ id: 3, origem: "SERVICO", natureza: "RECEITA", servicoid: 5 }),
  ];

  assert.deepEqual(chaves(ordenarEventosDaOs(eventos)), [1, 2, 3]);
});

test("serviços são agrupados por número, e não pela ordem alfabética do id", () => {
  const eventos = [
    evento({ id: 1, origem: "SERVICO", natureza: "RECEITA", servicoid: 10 }),
    evento({ id: 2, origem: "SERVICO", natureza: "RECEITA", servicoid: 2 }),
  ];

  assert.deepEqual(chaves(ordenarEventosDaOs(eventos)), [2, 1]);
});

test("ordenar não altera o array recebido", () => {
  const eventos = [
    evento({ id: 1, origem: "PRODUTO", natureza: "RECEITA", produtoid: 7 }),
    evento({ id: 2, origem: "PRODUTO", natureza: "DESPESA", produtoid: 7 }),
  ];

  ordenarEventosDaOs(eventos);
  assert.deepEqual(chaves(eventos), [1, 2]);
});

test("evento cancelado não conta; convertido conta", () => {
  const eventos = [
    evento({ id: 1, natureza: "RECEITA", valor: 100, status: "CANCELADO" }),
    evento({ id: 2, natureza: "RECEITA", valor: 40, status: "CONVERTIDO" }),
  ];

  assert.deepEqual(chaves(eventosAtivos(eventos)), [2]);
  assert.equal(somarEventosDaOs(eventos).receita, 40);
});

test("os quatro subtotais não somam o lucro quando há comissão e frete", () => {
  const eventos = [
    evento({ id: 1, origem: "PRODUTO", natureza: "RECEITA", produtoid: 1, valor: 1000 }),
    evento({ id: 2, origem: "PRODUTO", natureza: "DESPESA", produtoid: 1, valor: 600 }),
    evento({ id: 3, origem: "SERVICO", natureza: "RECEITA", servicoid: 1, valor: 500 }),
    evento({ id: 4, origem: "COMISSAO", natureza: "DESPESA", servicoid: 1, valor: 100 }),
    evento({ id: 5, origem: "FRETE", natureza: "RECEITA", valor: 50 }),
  ];

  const totais = somarEventosDaOs(eventos);

  assert.equal(totais.receitaProdutos, 1000);
  assert.equal(totais.despesaProdutos, 600);
  assert.equal(totais.receitaServicos, 500);
  // A comissão é despesa de serviço no sentido comum, mas o painel conta só
  // `origem = SERVICO` — é a assimetria que o relatório também reproduz.
  assert.equal(totais.despesaServicos, 0);

  assert.equal(totais.receita, 1550);
  assert.equal(totais.despesa, 700);
  assert.equal(totais.lucroReal, 850);

  const somaDosQuatro = 1000 + 500 - 600 - 0;
  assert.equal(somaDosQuatro, 900);
  assert.notEqual(somaDosQuatro, totais.lucroReal);
});

test("margem é zero sem receita, e não uma divisão por zero", () => {
  assert.equal(margemDoLucro({ receita: 0, lucroReal: -300 }), 0);
  assert.equal(margemDoLucro({ receita: 1000, lucroReal: 250 }), 25);
});

test("as outras origens decompõem exatamente a diferença dos quatro para o lucro", () => {
  const eventos = [
    evento({ id: 1, origem: "PRODUTO", natureza: "RECEITA", produtoid: 1, valor: 1000 }),
    evento({ id: 2, origem: "PRODUTO", natureza: "DESPESA", produtoid: 1, valor: 600 }),
    evento({ id: 3, origem: "SERVICO", natureza: "RECEITA", servicoid: 1, valor: 500 }),
    evento({ id: 4, origem: "COMISSAO", natureza: "DESPESA", servicoid: 1, valor: 100 }),
    evento({ id: 5, origem: "DESCONTO", natureza: "DESPESA", valor: 250 }),
    evento({ id: 6, origem: "FRETE", natureza: "RECEITA", valor: 50 }),
    evento({ id: 7, origem: "DESCONTO", natureza: "DESPESA", valor: 30, status: "CANCELADO" }),
  ];

  const outras = outrasOrigensDaOs(eventos);
  // Da maior para a menor, e sem o cancelado.
  assert.deepEqual(
    outras.map((o) => [o.origem, o.natureza, o.total]),
    [["DESCONTO", "DESPESA", 250], ["COMISSAO", "DESPESA", 100], ["FRETE", "RECEITA", 50]],
  );

  const totais = somarEventosDaOs(eventos);
  const quatro = totais.receitaProdutos + totais.receitaServicos - totais.despesaProdutos - totais.despesaServicos;
  const efeito = outras.reduce((soma, o) => soma + (o.natureza === "RECEITA" ? -o.total : o.total), 0);
  // É a promessa do painel: com estes cards, a conta fecha no lucro real.
  assert.equal(quatro - efeito, totais.lucroReal);
});

test("origem nova aparece sozinha em vez de sumir na conta", () => {
  const outras = outrasOrigensDaOs([
    evento({ id: 1, origem: "ENTRADA_FISCAL", natureza: "DESPESA", valor: 90 }),
  ]);
  assert.deepEqual(outras, [{ origem: "ENTRADA_FISCAL", natureza: "DESPESA", total: 90 }]);
});

test("consumo entra nas deduções — a regressão que a OS #72 revelou", () => {
  // Espelha a OS #72 do banco de demonstração: dois consumos, um vindo de baixa
  // de estoque (CONSUMO:7) e um lançado à mão (MANUAL:...), somando R$ 3,00.
  const eventos = [
    evento({ id: 1312, origem: "PRODUTO", natureza: "RECEITA", produtoid: 102, valor: 5 }),
    evento({ id: 1313, origem: "PRODUTO", natureza: "DESPESA", produtoid: 102, valor: 2 }),
    evento({ id: 1314, origem: "SERVICO", natureza: "RECEITA", servicoid: 2, valor: 350 }),
    evento({ id: 1318, origem: "COMISSAO", natureza: "DESPESA", servicoid: 2, valor: 17.5 }),
    evento({ id: 1319, origem: "COMISSAO", natureza: "DESPESA", servicoid: 2, valor: 17.5 }),
    evento({ id: 1320, origem: "CONSUMO", natureza: "DESPESA", chave_origem: "CONSUMO:7", valor: 1 }),
    evento({ id: 1324, origem: "SERVICO", natureza: "RECEITA", servicoid: 9, valor: 190 }),
    evento({ id: 1327, origem: "CONSUMO", natureza: "DESPESA", chave_origem: "MANUAL:0d11", valor: 2 }),
  ];

  const totais = somarEventosDaOs(eventos);
  assert.equal(totais.lucroReal, 505);

  const outras = outrasOrigensDaOs(eventos);
  const consumo = outras.find((o) => o.origem === "CONSUMO");
  assert.ok(consumo, "consumo tem que aparecer entre as deduções");
  // Os dois consumos somam num único par origem/natureza, apesar das chaves
  // diferentes: para o resultado, baixa de estoque e lançamento à mão custam igual.
  assert.equal(consumo.total, 3);

  // Sem a dedução de consumo a conta errava por R$ 3,00 — era o bug.
  const quatro = totais.receitaProdutos + totais.receitaServicos - totais.despesaProdutos - totais.despesaServicos;
  const semConsumo = outras.filter((o) => o.origem !== "CONSUMO");
  const efeito = (lista: typeof outras) =>
    lista.reduce((soma, o) => soma + (o.natureza === "RECEITA" ? -o.total : o.total), 0);

  assert.equal(quatro - efeito(semConsumo), 508);
  assert.equal(quatro - efeito(outras), totais.lucroReal);
});
