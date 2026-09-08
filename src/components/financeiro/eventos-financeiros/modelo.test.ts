import assert from "node:assert/strict";
import { test } from "node:test";

import {
  agruparPorOrdem,
  eventoSelecionavel,
  montarLinhas,
  motivoNaoSelecionavel,
  podeSincronizar,
  type EventoFinanceiroBruto,
} from "./modelo";

function evento(parcial: Partial<EventoFinanceiroBruto> = {}): EventoFinanceiroBruto {
  return {
    id: 1,
    ordemservicoid: 10,
    origem: "SERVICO",
    natureza: "DESPESA",
    status: "ATIVO",
    descricao: "Serviço terceirizado",
    valor: 100,
    pode_gerar_transacao: true,
    ...parcial,
  };
}

test("uma despesa ativa que gera transação é selecionável", () => {
  const [linha] = montarLinhas([evento()]);
  assert.equal(eventoSelecionavel(linha), true);
  assert.equal(motivoNaoSelecionavel(linha), undefined);
});

test("receita não entra num boleto de despesas", () => {
  const [linha] = montarLinhas([evento({ natureza: "RECEITA" })]);
  assert.equal(eventoSelecionavel(linha), false);
  assert.equal(motivoNaoSelecionavel(linha), "Só despesas podem ser agrupadas num pagamento.");
});

test("despesa já lançada sai da fila", () => {
  const [linha] = montarLinhas([evento({ status: "CONVERTIDO", lancamento_id: 7 })]);
  assert.equal(eventoSelecionavel(linha), false);
  assert.equal(motivoNaoSelecionavel(linha), "Esta despesa já foi lançada no financeiro.");
});

test("evento automático não vira transação e não é selecionável", () => {
  const [linha] = montarLinhas([evento({ origem: "PRODUTO", pode_gerar_transacao: false })]);
  assert.equal(eventoSelecionavel(linha), false);
  assert.equal(motivoNaoSelecionavel(linha), "Lançamento automático não gera transação.");
});

test("evento cancelado não aparece na lista", () => {
  const linhas = montarLinhas([evento({ status: "CANCELADO" }), evento({ id: 2 })]);
  assert.deepEqual(linhas.map((linha) => linha.id), [2]);
});

test("sincronizar só vale para snapshot de produto ainda não lançado", () => {
  const [comProduto] = montarLinhas([evento({ origem: "PRODUTO", produtoid: 5 })]);
  assert.equal(podeSincronizar(comProduto), true);

  const [semProduto] = montarLinhas([evento({ origem: "PRODUTO", produtoid: null })]);
  assert.equal(podeSincronizar(semProduto), false);

  const [lancado] = montarLinhas([
    evento({ origem: "PRODUTO", produtoid: 5, status: "CONVERTIDO" }),
  ]);
  assert.equal(podeSincronizar(lancado), false);
});

test("comissão corrigida à mão é marcada na linha", () => {
  const [linha] = montarLinhas([
    evento({ origem: "COMISSAO", dados_snapshot: { comissao_ajustada_a_mao: true } }),
  ]);
  assert.equal(linha.comissaoAjustada, true);
});

test("o agrupamento por OS soma só as despesas de cada ordem", () => {
  const grupos = agruparPorOrdem(
    montarLinhas([
      evento({ id: 1, ordemservicoid: 10, valor: 100 }),
      evento({ id: 2, ordemservicoid: 10, valor: 50 }),
      // Receita da mesma OS: entra na lista, fica fora do total do cabeçalho —
      // quem lê a fila está decidindo quanto vai pagar.
      evento({ id: 3, ordemservicoid: 10, natureza: "RECEITA", valor: 900 }),
      evento({ id: 4, ordemservicoid: 20, valor: 70 }),
    ]),
  );

  assert.deepEqual(
    grupos.map((grupo) => [grupo.osId, grupo.linhas.length, grupo.total]),
    [
      [10, 3, 150],
      [20, 1, 70],
    ],
  );
});

test("a OS vem do vínculo embutido quando a coluna não veio", () => {
  const [linha] = montarLinhas([
    evento({
      ordemservicoid: null,
      ordem: { id: 42, status: "EM_ANDAMENTO", cliente: { id: 3, nomerazaosocial: "Fulano" } },
    }),
  ]);
  assert.equal(linha.osId, 42);
});

test("a lista plana preserva a ordem cronológica recebida da API", () => {
  const linhas = montarLinhas(
    [
      evento({ id: 9, data_evento: "2026-09-02T12:00:00.000Z" }),
      evento({ id: 3, data_evento: "2026-09-01T12:00:00.000Z" }),
    ],
    { preservarOrdem: true },
  );

  assert.deepEqual(linhas.map((linha) => linha.id), [9, 3]);
  assert.equal(linhas[0].dataEvento, "2026-09-02T12:00:00.000Z");
});

test("o agrupamento preserva a ordem das OS e organiza os itens dentro de cada bloco", () => {
  const grupos = agruparPorOrdem(
    montarLinhas(
      [
        evento({ id: 30, ordemservicoid: 20, origem: "COMISSAO", servicoid: 5 }),
        evento({ id: 10, ordemservicoid: 20, natureza: "RECEITA", servicoid: 5 }),
        evento({ id: 40, ordemservicoid: 10 }),
      ],
      { preservarOrdem: true },
    ),
  );

  assert.deepEqual(grupos.map((grupo) => grupo.osId), [20, 10]);
  assert.deepEqual(grupos[0].linhas.map((linha) => linha.id), [10, 30]);
});

test("OS e venda com o mesmo número permanecem em grupos distintos e lançáveis", () => {
  const common = { origem: "COMISSAO", natureza: "DESPESA", status: "ATIVO", descricao: "Comissão", valor: 50, pode_gerar_transacao: true } as const;
  const eventos: EventoFinanceiroBruto[] = [
    { ...common, id: 1, ordemservicoid: 12 },
    { ...common, id: 2, ordemservicoid: null, source_type: "VENDA", source_id: 12 },
  ];
  const linhas = montarLinhas(eventos);
  const grupos = agruparPorOrdem(linhas);
  assert.deepEqual(grupos.map((g) => g.rotulo), ["OS #12", "Venda #12"]);
  assert.equal(grupos.length, 2);
  assert.equal(grupos.reduce((soma, g) => soma + g.total, 0), 100);
  assert.equal(linhas[1].osId, null);
  assert.equal(linhas[1].vendaId, 12);
  assert.ok(linhas.every(eventoSelecionavel));
});
