import assert from "node:assert/strict";
import test from "node:test";

import {
  deducoesDaOs,
  eventosAtivos,
  margemDoLucro,
  ordenarEventosDaOs,
  outrasOrigensDaOs,
  somaOrigemNatureza,
  somarEventosDaOs,
  somarLucroRealPorStatus,
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

test("lucro real por status reparte exatamente o total geral", () => {
  const ordens = [
    {
      status: "CONCLUIDO",
      eventos: [
        evento({ id: 1, natureza: "RECEITA", valor: 1000 }),
        evento({ id: 2, natureza: "DESPESA", valor: 600 }),
      ],
    },
    {
      status: "CONCLUIDO",
      eventos: [
        evento({ id: 3, natureza: "RECEITA", valor: 500 }),
        evento({ id: 4, natureza: "DESPESA", valor: 100, status: "CANCELADO" }),
      ],
    },
    {
      status: "PAGAMENTO",
      eventos: [
        evento({ id: 5, natureza: "RECEITA", valor: 300 }),
        evento({ id: 6, natureza: "DESPESA", valor: 80 }),
      ],
    },
    { status: "SEM_COBRANCA", eventos: [] },
  ];

  const porStatus = somarLucroRealPorStatus(ordens);
  assert.deepEqual(porStatus, [
    { status: "CONCLUIDO", quantidadeOrdens: 2, lucroReal: 900 },
    { status: "PAGAMENTO", quantidadeOrdens: 1, lucroReal: 220 },
    { status: "SEM_COBRANCA", quantidadeOrdens: 1, lucroReal: 0 },
  ]);

  const lucroGeral = somarEventosDaOs(ordens.flatMap((ordem) => ordem.eventos)).lucroReal;
  assert.equal(
    porStatus.reduce((soma, grupo) => soma + grupo.lucroReal, 0),
    lucroGeral,
  );
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

test("receita e despesas de frete ficam juntas, com a receita primeiro", () => {
  const ordenados = ordenarEventosDaOs([
    evento({ id: 30, origem: "CONSUMO", natureza: "DESPESA", valor: 5 }),
    evento({ id: 22, origem: "FRETE", natureza: "DESPESA", chave_origem: "MANUAL:b", valor: 20 }),
    evento({ id: 20, origem: "FRETE", natureza: "RECEITA", chave_origem: "FRETE", valor: 50 }),
    evento({ id: 21, origem: "FRETE", natureza: "DESPESA", chave_origem: "MANUAL:a", valor: 10 }),
  ]);

  assert.deepEqual(ordenados.map((item) => item.id), [20, 21, 22, 30]);
  const totais = somarEventosDaOs(ordenados);
  assert.equal(totais.receita, 50);
  assert.equal(totais.despesa, 35);
  assert.equal(totais.lucroReal, 15);
});

test("frete com receita e despesa: a dedução é líquida, não um sinal fixo", () => {
  // A OS #72 real (recorte EM_ANDAMENTO) mais uma despesa simulada de frete
  // terceirizado, que ainda não existia nos dados quando o relatório foi
  // escrito. Um sinal fixo positivo por origem somaria a despesa como receita.
  const eventos = [
    evento({ id: 1312, origem: "PRODUTO", natureza: "RECEITA", produtoid: 102, valor: 5 }),
    evento({ id: 1313, origem: "PRODUTO", natureza: "DESPESA", produtoid: 102, valor: 2 }),
    evento({ id: 1314, origem: "SERVICO", natureza: "RECEITA", servicoid: 2, valor: 350 }),
    evento({ id: 1324, origem: "SERVICO", natureza: "RECEITA", servicoid: 9, valor: 190 }),
    evento({ id: 1318, origem: "COMISSAO", natureza: "DESPESA", servicoid: 2, valor: 27 }),
    evento({ id: 1320, origem: "CONSUMO", natureza: "DESPESA", chave_origem: "CONSUMO:7", valor: 3 }),
    evento({ id: 1370, origem: "FRETE", natureza: "RECEITA", chave_origem: "FRETE", valor: 150 }),
    evento({ id: 99999, origem: "FRETE", natureza: "DESPESA", chave_origem: "MANUAL:sim", valor: 30 }),
  ];

  const totais = somarEventosDaOs(eventos);
  assert.equal(totais.lucroReal, 633); // (5-2) + (350+190) - 27 - 3 + (150-30)

  const deducoes = deducoesDaOs(eventos);
  const frete = deducoes.find((d) => d.origem === "FRETE");
  assert.ok(frete);
  // Líquido: 150 de receita menos 30 de despesa — nunca 180.
  assert.equal(frete.valor, 120);

  const quatro = totais.receitaProdutos + totais.receitaServicos - totais.despesaProdutos - totais.despesaServicos;
  const somaDasDeducoes = deducoes.reduce((soma, d) => soma + d.valor, 0);
  assert.equal(quatro + somaDasDeducoes, totais.lucroReal);
});

test("deducoesDaOs mantém as quatro origens conhecidas mesmo zeradas, na ordem fixa", () => {
  const deducoes = deducoesDaOs([evento({ id: 1, origem: "PRODUTO", natureza: "RECEITA", produtoid: 1, valor: 100 })]);
  assert.deepEqual(
    deducoes.map((d) => d.origem),
    ["DESCONTO", "COMISSAO", "CONSUMO", "FRETE"],
  );
  assert.ok(deducoes.every((d) => d.valor === 0));
});

test("origem desconhecida na dedução também é líquida, e vem depois das conhecidas", () => {
  const deducoes = deducoesDaOs([
    evento({ id: 1, origem: "ENTRADA_FISCAL", natureza: "DESPESA", valor: 50 }),
    evento({ id: 2, origem: "ENTRADA_FISCAL", natureza: "RECEITA", valor: 20 }),
  ]);
  const extra = deducoes.find((d) => d.origem === "ENTRADA_FISCAL");
  assert.ok(extra);
  assert.equal(extra.valor, -30);
  assert.equal(deducoes.indexOf(extra), 4);
});

test("somaOrigemNatureza soma só o par pedido, zero quando não há evento nenhum", () => {
  const eventos = [
    evento({ id: 1, origem: "FRETE", natureza: "RECEITA", valor: 150 }),
    evento({ id: 2, origem: "FRETE", natureza: "DESPESA", valor: 30 }),
    evento({ id: 3, origem: "FRETE", natureza: "DESPESA", valor: 5, status: "CANCELADO" }),
  ];

  assert.equal(somaOrigemNatureza(eventos, "FRETE", "RECEITA"), 150);
  assert.equal(somaOrigemNatureza(eventos, "FRETE", "DESPESA"), 30);
  assert.equal(somaOrigemNatureza(eventos, "COMISSAO", "DESPESA"), 0);
});

test("mover comissão para o bloco de serviços e separar o frete em bruto continua fechando no lucro real", () => {
  // A conta do painel do cabeçalho, como a folha monta hoje: liquidoProdutos +
  // liquidoServicos (já com a comissão dentro) + as demais deduções + frete
  // bruto (receita menos despesa, exibidos em cards separados).
  const eventos = [
    evento({ id: 1, origem: "PRODUTO", natureza: "RECEITA", produtoid: 1, valor: 1000 }),
    evento({ id: 2, origem: "PRODUTO", natureza: "DESPESA", produtoid: 1, valor: 600 }),
    evento({ id: 3, origem: "SERVICO", natureza: "RECEITA", servicoid: 1, valor: 500 }),
    evento({ id: 4, origem: "SERVICO", natureza: "DESPESA", servicoid: 1, valor: 40 }),
    evento({ id: 5, origem: "COMISSAO", natureza: "DESPESA", servicoid: 1, valor: 100 }),
    evento({ id: 6, origem: "DESCONTO", natureza: "DESPESA", valor: 25 }),
    evento({ id: 7, origem: "CONSUMO", natureza: "DESPESA", valor: 10 }),
    evento({ id: 8, origem: "FRETE", natureza: "RECEITA", valor: 150 }),
    evento({ id: 9, origem: "FRETE", natureza: "DESPESA", valor: 30 }),
  ];

  const totais = somarEventosDaOs(eventos);
  const deducoes = deducoesDaOs(eventos);
  const comissoes = deducoes.find((d) => d.origem === "COMISSAO")?.valor ?? 0;
  const outras = deducoes.filter((d) => d.origem !== "COMISSAO" && d.origem !== "FRETE");

  const liquidoProdutos = totais.receitaProdutos - totais.despesaProdutos;
  const liquidoServicos = totais.receitaServicos - totais.despesaServicos + comissoes;
  const freteReceita = somaOrigemNatureza(eventos, "FRETE", "RECEITA");
  const freteDespesa = somaOrigemNatureza(eventos, "FRETE", "DESPESA");

  assert.equal(comissoes, -100);
  assert.equal(liquidoServicos, 500 - 40 - 100); // 360: receita, custo e comissão do bloco
  assert.equal(freteReceita, 150);
  assert.equal(freteDespesa, 30);

  const somaDoPainel =
    liquidoProdutos +
    liquidoServicos +
    outras.reduce((soma, d) => soma + d.valor, 0) +
    freteReceita -
    freteDespesa;

  assert.equal(somaDoPainel, totais.lucroReal);
});
