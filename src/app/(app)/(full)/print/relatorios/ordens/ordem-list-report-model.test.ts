import assert from "node:assert/strict";
import test from "node:test";

import {
  MM_ESPACO_ORDEM,
  MM_FECHAMENTO,
  MM_FECHAMENTO_DUPLO,
  MM_ITEM,
  MM_ORDEM,
  MM_ORDEM_CONTINUACAO,
  alturaDoFechamento,
  capacidadeDaFolha,
  contarParcelasDoFechamento,
  paginarOrdens,
  type FatiaOrdem,
  type ItemDaOrdem,
  type OrderRow,
} from "./ordem-list-report-model";

function ordem(id: number, valores: Partial<OrderRow> = {}): OrderRow {
  return {
    id: String(id),
    status: "CONCLUIDO",
    priority: "NORMAL",
    customer: `Cliente ${id}`,
    document: "—",
    target: "—",
    sector: "—",
    owner: "—",
    description: "—",
    openedAt: "01/01/2026",
    closedAt: "02/01/2026",
    products: 100,
    services: 0,
    discount: 0,
    freight: 0,
    budget: 100,
    surcharge: 0,
    ...valores,
  };
}

function item(indice: number): ItemDaOrdem {
  return {
    chave: `item-${indice}`,
    tipo: "PRODUTO",
    codigo: String(indice),
    descricao: `Item ${indice}`,
    unidade: "",
    quantidade: 1,
    precoUnitario: 10,
    descontoItem: 0,
    subtotal: 10,
  };
}

/** Repete a conta do paginador, para o teste medir o que a folha vai ocupar. */
function alturaDaFatia(fatia: FatiaOrdem, detalhado: boolean) {
  if (!detalhado) return MM_ORDEM;
  const abertura = fatia.continuacao ? MM_ORDEM_CONTINUACAO : MM_ORDEM;
  // Fatia sem item ou é a OS sem lançamento (uma linha de aviso) ou é o
  // fechamento órfão, que não tem linha nenhuma.
  const linhas = fatia.itens.length || (fatia.continuacao ? 0 : 1);
  return (
    abertura + linhas * MM_ITEM + (fatia.fecha ? alturaDoFechamento(fatia.ordem) : 0) + MM_ESPACO_ORDEM
  );
}

test("sem detalhe, cabe o que foi medido e nem uma ordem a mais", () => {
  const ordens = Array.from({ length: 50 }, (_, i) => ({ ordem: ordem(i + 1), itens: [] }));
  const folhas = paginarOrdens(ordens, false);
  assert.deepEqual(folhas.map((folha) => folha.length), [15, 19, 16]);
});

test("recorte vazio devolve uma folha vazia, e não nenhuma folha", () => {
  assert.deepEqual(paginarOrdens([], false), [[]]);
  assert.deepEqual(paginarOrdens([], true), [[]]);
});

test("uma OS de 200 itens atravessa as folhas e fecha uma vez só", () => {
  const itens = Array.from({ length: 200 }, (_, i) => item(i));
  const folhas = paginarOrdens([{ ordem: ordem(1), itens }], true);

  assert.ok(folhas.length > 1, "200 itens não cabem numa folha");

  const fatias = folhas.flat();
  assert.equal(fatias.filter((fatia) => fatia.fecha).length, 1);
  assert.equal(fatias.at(-1)?.fecha, true);
  assert.equal(fatias[0].continuacao, false);
  assert.ok(fatias.slice(1).every((fatia) => fatia.continuacao));

  // Nenhum item se perde nem se repete na virada.
  const impressos = fatias.flatMap((fatia) => fatia.itens.map((linha) => linha.chave));
  assert.deepEqual(impressos, itens.map((linha) => linha.chave));
});

test("OS sem item ganha a linha de aviso e o fechamento quando há valor", () => {
  const [folha] = paginarOrdens(
    [
      { ordem: ordem(1, { products: 0, services: 0, budget: 150, freight: 150 }), itens: [] },
      { ordem: ordem(2, { products: 0, services: 0, budget: 0 }), itens: [] },
    ],
    true,
  );

  assert.equal(folha[0].itens.length, 0);
  assert.equal(folha[0].continuacao, false);
  assert.equal(folha[0].fecha, true, "frete lançado precisa aparecer no fechamento");
  assert.equal(folha[1].fecha, false, "sem valor nenhum não há o que compor");
});

test("nenhuma folha estoura a capacidade — a invariante contra o corte silencioso", () => {
  const ordens = [
    { ordem: ordem(1), itens: Array.from({ length: 3 }, (_, i) => item(i)) },
    { ordem: ordem(2), itens: Array.from({ length: 90 }, (_, i) => item(i)) },
    { ordem: ordem(3), itens: [] },
    { ordem: ordem(4), itens: Array.from({ length: 41 }, (_, i) => item(i)) },
    ...Array.from({ length: 12 }, (_, i) => ({
      ordem: ordem(10 + i),
      itens: Array.from({ length: 7 }, (_, j) => item(j)),
    })),
  ];

  for (const detalhado of [false, true]) {
    const folhas = paginarOrdens(ordens, detalhado);
    folhas.forEach((folha, indice) => {
      const usado = folha.reduce((soma, fatia) => soma + alturaDaFatia(fatia, detalhado), 0);
      assert.ok(
        usado <= capacidadeDaFolha(indice, detalhado),
        `folha ${indice + 1} ocupou ${usado}mm de ${capacidadeDaFolha(indice, detalhado)}mm`,
      );
    });
  }
});

test("o fechamento cheio reserva duas linhas, e o enxuto continua numa", () => {
  const enxuta = ordem(1, { products: 6000, services: 0, budget: 6000 });
  assert.equal(contarParcelasDoFechamento(enxuta), 2);
  assert.equal(alturaDoFechamento(enxuta), MM_FECHAMENTO);

  const cheia = ordem(2, { products: 100, services: 100, discount: 10, freight: 10, surcharge: 10, budget: 200 });
  assert.equal(contarParcelasDoFechamento(cheia), 6);
  assert.equal(alturaDoFechamento(cheia), MM_FECHAMENTO_DUPLO);

  // A folha precisa reservar o que a linha cheia vai ocupar de fato.
  const [folha] = paginarOrdens([{ ordem: cheia, itens: [item(0)] }], true);
  const usado = folha.reduce((soma, fatia) => soma + alturaDaFatia(fatia, true), 0);
  assert.ok(usado <= capacidadeDaFolha(0, true));
  assert.equal(folha[0].fecha, true);
});
