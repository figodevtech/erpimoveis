import assert from "node:assert/strict";
import test from "node:test";

import {
  MM_ESPACO_VENDA,
  MM_FECHAMENTO,
  MM_FECHAMENTO_DUPLO,
  MM_FILEIRA_PAINEL,
  MM_ITEM,
  MM_VENDA,
  MM_VENDA_CONTINUACAO,
  alturaDoFechamento,
  alturaLucroRealPorStatus,
  capacidadeDaFolha,
  contarParcelasDoFechamento,
  paginarLancamentos,
  paginarVendas,
  type FatiaVenda,
  type ItemDaVenda,
  type ModoDaFolha,
  type SaleRow,
} from "./venda-list-report-model";

function venda(id: number, valores: Partial<SaleRow> = {}): SaleRow {
  return {
    id: String(id),
    status: "FINALIZADA",
    channel: "PDV",
    category: "—",
    customer: `Cliente ${id}`,
    document: "—",
    seller: "—",
    creator: "—",
    payment: "—",
    installments: "",
    description: "—",
    soldAt: "01/01/2026",
    paidAt: "02/01/2026",
    subtotal: 100,
    discount: 0,
    freight: 0,
    total: 100,
    surcharge: 0,
    ...valores,
  };
}

function item(indice: number): ItemDaVenda {
  return {
    chave: `item-${indice}`,
    codigo: String(indice),
    descricao: `Item ${indice}`,
    unidade: "",
    quantidade: 1,
    precoUnitario: 10,
    descontoItem: 0,
    freteItem: 0,
    subtotal: 10,
  };
}

/** Repete a conta do paginador, para o teste medir o que a folha vai ocupar. */
function alturaDaFatia(fatia: FatiaVenda, modo: ModoDaFolha) {
  if (modo === "simples") return MM_VENDA;
  const abertura = fatia.continuacao ? MM_VENDA_CONTINUACAO : MM_VENDA;
  // Fatia sem linha ou é a venda sem lançamento (uma linha de aviso) ou é o
  // fechamento órfão, que não tem linha nenhuma.
  const linhas = fatia.linhas.length || (fatia.continuacao ? 0 : 1);
  return (
    abertura + linhas * MM_ITEM + (fatia.fecha ? alturaDoFechamento(fatia.venda, modo) : 0) + MM_ESPACO_VENDA
  );
}

test("sem detalhe, cabe o que foi medido e nem uma venda a mais", () => {
  const vendas = Array.from({ length: 50 }, (_, i) => ({ venda: venda(i + 1), linhas: [] }));
  const folhas = paginarVendas(vendas, "simples");
  assert.deepEqual(folhas.map((folha) => folha.length), [15, 19, 16]);
});

test("recorte vazio devolve uma folha vazia, e não nenhuma folha", () => {
  assert.deepEqual(paginarVendas([], "simples"), [[]]);
  assert.deepEqual(paginarVendas([], "itens"), [[]]);
  assert.deepEqual(paginarVendas([], "eventos"), [[]]);
});

test("uma venda de 200 itens atravessa as folhas e fecha uma vez só", () => {
  const itens = Array.from({ length: 200 }, (_, i) => item(i));
  const folhas = paginarVendas([{ venda: venda(1), linhas: itens }], "itens");

  assert.ok(folhas.length > 1, "200 itens não cabem numa folha");

  const fatias = folhas.flat();
  assert.equal(fatias.filter((fatia) => fatia.fecha).length, 1);
  assert.equal(fatias.at(-1)?.fecha, true);
  assert.equal(fatias[0].continuacao, false);
  assert.ok(fatias.slice(1).every((fatia) => fatia.continuacao));

  // Nenhum item se perde nem se repete na virada.
  const impressos = fatias.flatMap((fatia) => fatia.linhas.map((linha) => linha.chave));
  assert.deepEqual(impressos, itens.map((linha) => linha.chave));
});

test("venda sem item ganha a linha de aviso e o fechamento quando há valor", () => {
  const [folha] = paginarVendas(
    [
      { venda: venda(1, { subtotal: 0, total: 150, freight: 150 }), linhas: [] },
      { venda: venda(2, { subtotal: 0, total: 0 }), linhas: [] },
    ],
    "itens",
  );

  assert.equal(folha[0].linhas.length, 0);
  assert.equal(folha[0].continuacao, false);
  assert.equal(folha[0].fecha, true, "frete lançado precisa aparecer no fechamento");
  assert.equal(folha[1].fecha, false, "sem valor nenhum não há o que compor");
});

test("nenhuma folha estoura a capacidade — a invariante contra o corte silencioso", () => {
  const vendas = [
    { venda: venda(1), linhas: Array.from({ length: 3 }, (_, i) => item(i)) },
    { venda: venda(2), linhas: Array.from({ length: 90 }, (_, i) => item(i)) },
    { venda: venda(3), linhas: [] },
    { venda: venda(4), linhas: Array.from({ length: 41 }, (_, i) => item(i)) },
    ...Array.from({ length: 12 }, (_, i) => ({
      venda: venda(10 + i),
      linhas: Array.from({ length: 7 }, (_, j) => item(j)),
    })),
  ];

  for (const modo of ["simples", "itens", "eventos"] as const) {
    for (const fileiras of [0, 2, 3]) {
      const folhas = paginarVendas(vendas, modo, fileiras, 28);
      folhas.forEach((folha, indice) => {
        const usado = folha.reduce((soma, fatia) => soma + alturaDaFatia(fatia, modo), 0);
        const capacidade = capacidadeDaFolha(indice, modo, fileiras, 28);
        assert.ok(usado <= capacidade, `${modo}/${fileiras}: folha ${indice + 1} ocupou ${usado}mm de ${capacidade}mm`);
      });
    }
  }
});

test("o fechamento cheio reserva duas linhas, e o enxuto continua numa", () => {
  const enxuta = venda(1, { subtotal: 6000, total: 6000 });
  assert.equal(contarParcelasDoFechamento(enxuta), 2);
  assert.equal(alturaDoFechamento(enxuta), MM_FECHAMENTO);

  const cheia = venda(2, { subtotal: 200, discount: 10, freight: 10, surcharge: 10, total: 200 });
  assert.equal(contarParcelasDoFechamento(cheia), 5);
  assert.equal(alturaDoFechamento(cheia), MM_FECHAMENTO_DUPLO);

  // A folha precisa reservar o que a linha cheia vai ocupar de fato.
  const [folha] = paginarVendas([{ venda: cheia, linhas: [item(0)] }], "itens");
  const usado = folha.reduce((soma, fatia) => soma + alturaDaFatia(fatia, "itens"), 0);
  assert.ok(usado <= capacidadeDaFolha(0, "itens"));
  assert.equal(folha[0].fecha, true);
});

test("no modo de eventos o fechamento é sempre duplo e segue quem tem evento", () => {
  assert.equal(alturaDoFechamento(venda(1), "eventos"), MM_FECHAMENTO_DUPLO);

  // O filtro escondeu tudo, mas a venda tem evento: a conta fecha assim mesmo.
  const [folha] = paginarVendas(
    [
      { venda: venda(1), linhas: [], fechamento: true },
      { venda: venda(2), linhas: [], fechamento: false },
    ],
    "eventos",
  );
  assert.equal(folha[0].fecha, true);
  assert.equal(folha[1].fecha, false);
});

test("a terceira fileira do painel e o lucro por status saem da primeira folha", () => {
  assert.equal(capacidadeDaFolha(0, "simples", 2) - capacidadeDaFolha(0, "simples", 3), MM_FILEIRA_PAINEL);
  assert.equal(capacidadeDaFolha(1, "simples", 3), capacidadeDaFolha(1, "simples", 2));
  assert.equal(alturaLucroRealPorStatus(0), 0);
  assert.equal(alturaLucroRealPorStatus(5) - alturaLucroRealPorStatus(4), 12);
});

test("a tabela sem agrupamento não perde nem repete lançamento", () => {
  const lancamentos = Array.from({ length: 200 }, (_, i) => i);
  const folhas = paginarLancamentos(lancamentos, 3, 16);
  assert.deepEqual(folhas.flat(), lancamentos);
  assert.ok(folhas[0].length < folhas[1].length, "a primeira folha tem o painel");
});
