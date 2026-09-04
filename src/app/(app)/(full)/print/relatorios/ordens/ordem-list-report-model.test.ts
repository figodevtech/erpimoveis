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
  alturaLucroRealPorStatus,
  capacidadeDaFolha,
  contarParcelasDoFechamento,
  MM_FILEIRA_PAINEL,
  paginarOrdens,
  type FatiaOrdem,
  type LinhaDaOrdem,
  type ModoDaFolha,
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

/** O modelo só enxerga a chave; o resto da linha é assunto da folha. */
function item(indice: number): LinhaDaOrdem {
  return { chave: `item-${indice}` };
}

/** Repete a conta do paginador, para o teste medir o que a folha vai ocupar. */
function alturaDaFatia(fatia: FatiaOrdem, modo: ModoDaFolha) {
  if (modo === "simples") return MM_ORDEM;
  const abertura = fatia.continuacao ? MM_ORDEM_CONTINUACAO : MM_ORDEM;
  // Fatia sem linha ou é a OS sem lançamento (uma linha de aviso) ou é o
  // fechamento órfão, que não tem linha nenhuma.
  const linhas = fatia.linhas.length || (fatia.continuacao ? 0 : 1);
  return (
    abertura + linhas * MM_ITEM + (fatia.fecha ? alturaDoFechamento(fatia.ordem, modo) : 0) + MM_ESPACO_ORDEM
  );
}

test("sem detalhe, cabe o que foi medido e nem uma ordem a mais", () => {
  const ordens = Array.from({ length: 50 }, (_, i) => ({ ordem: ordem(i + 1), linhas: [] }));
  const folhas = paginarOrdens(ordens, "simples");
  assert.deepEqual(folhas.map((folha) => folha.length), [15, 19, 16]);
});

test("recorte vazio devolve uma folha vazia, e não nenhuma folha", () => {
  assert.deepEqual(paginarOrdens([], "simples"), [[]]);
  assert.deepEqual(paginarOrdens([], "itens"), [[]]);
});

test("uma OS de 200 itens atravessa as folhas e fecha uma vez só", () => {
  const itens = Array.from({ length: 200 }, (_, i) => item(i));
  const folhas = paginarOrdens([{ ordem: ordem(1), linhas: itens }], "itens");

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

test("OS sem item ganha a linha de aviso e o fechamento quando há valor", () => {
  const [folha] = paginarOrdens(
    [
      { ordem: ordem(1, { products: 0, services: 0, budget: 150, freight: 150 }), linhas: [] },
      { ordem: ordem(2, { products: 0, services: 0, budget: 0 }), linhas: [] },
    ],
    "itens",
  );

  assert.equal(folha[0].linhas.length, 0);
  assert.equal(folha[0].continuacao, false);
  assert.equal(folha[0].fecha, true, "frete lançado precisa aparecer no fechamento");
  assert.equal(folha[1].fecha, false, "sem valor nenhum não há o que compor");
});

test("nenhuma folha estoura a capacidade — a invariante contra o corte silencioso", () => {
  const ordens = [
    { ordem: ordem(1), linhas: Array.from({ length: 3 }, (_, i) => item(i)) },
    { ordem: ordem(2), linhas: Array.from({ length: 90 }, (_, i) => item(i)) },
    { ordem: ordem(3), linhas: [] },
    { ordem: ordem(4), linhas: Array.from({ length: 41 }, (_, i) => item(i)) },
    ...Array.from({ length: 12 }, (_, i) => ({
      ordem: ordem(10 + i),
      linhas: Array.from({ length: 7 }, (_, j) => item(j)),
    })),
  ];

  for (const modo of ["simples", "itens"] as ModoDaFolha[]) {
    const folhas = paginarOrdens(ordens, modo);
    folhas.forEach((folha, indice) => {
      const usado = folha.reduce((soma, fatia) => soma + alturaDaFatia(fatia, modo), 0);
      assert.ok(
        usado <= capacidadeDaFolha(indice, modo),
        `folha ${indice + 1} ocupou ${usado}mm de ${capacidadeDaFolha(indice, modo)}mm`,
      );
    });
  }
});

test("o fechamento cheio reserva duas linhas, e o enxuto continua numa", () => {
  const enxuta = ordem(1, { products: 6000, services: 0, budget: 6000 });
  assert.equal(contarParcelasDoFechamento(enxuta), 2);
  assert.equal(alturaDoFechamento(enxuta, "itens"), MM_FECHAMENTO);

  const cheia = ordem(2, { products: 100, services: 100, discount: 10, freight: 10, surcharge: 10, budget: 200 });
  assert.equal(contarParcelasDoFechamento(cheia), 6);
  assert.equal(alturaDoFechamento(cheia, "itens"), MM_FECHAMENTO_DUPLO);

  // A folha precisa reservar o que a linha cheia vai ocupar de fato.
  const [folha] = paginarOrdens([{ ordem: cheia, linhas: [item(0)] }], "itens");
  const usado = folha.reduce((soma, fatia) => soma + alturaDaFatia(fatia, "itens"), 0);
  assert.ok(usado <= capacidadeDaFolha(0, "itens"));
  assert.equal(folha[0].fecha, true);
});

test("no modo de eventos o fechamento reserva sempre duas linhas", () => {
  // As nove entradas somam 254mm numa OS comum e 279mm com valores altos,
  // contra 176mm de folha: quebram em duas em qualquer cenário, e duas
  // comportam 352mm.
  assert.equal(alturaDoFechamento(ordem(1, { budget: 8_000 }), "eventos"), MM_FECHAMENTO_DUPLO);
  assert.equal(alturaDoFechamento(ordem(2, { budget: 1_200_000 }), "eventos"), MM_FECHAMENTO_DUPLO);
  assert.notEqual(MM_FECHAMENTO_DUPLO, MM_FECHAMENTO);
});

test("no modo de eventos a ordem sem evento nenhum não imprime fechamento", () => {
  const [folha] = paginarOrdens([{ ordem: ordem(1, { budget: 500 }), linhas: [] }], "eventos");
  assert.equal(folha[0].fecha, false, "sem evento não há lucro a compor");
  assert.equal(folha[0].linhas.length, 0);
});

test("uma terceira fileira de cards reduz a primeira folha, e não corta a última ordem", () => {
  const duas = capacidadeDaFolha(0, "simples", 2);
  const tres = capacidadeDaFolha(0, "simples", 3);
  assert.equal(duas - tres, MM_FILEIRA_PAINEL);

  const ordens = Array.from({ length: 50 }, (_, i) => ({ ordem: ordem(i + 1), linhas: [] }));
  const comPainelAlto = paginarOrdens(ordens, "simples", 3);
  assert.ok(
    comPainelAlto[0].length < paginarOrdens(ordens, "simples", 2)[0].length,
    "o painel mais alto tem que tirar ordens da primeira folha",
  );
  assert.ok(comPainelAlto[0].length * MM_ORDEM <= tres);
});

test("os cards de lucro por status também reservam espaço na primeira folha", () => {
  const alturaStatus = alturaLucroRealPorStatus(9);
  const semStatus = capacidadeDaFolha(0, "simples", 4);
  const comStatus = capacidadeDaFolha(0, "simples", 4, alturaStatus);
  assert.equal(semStatus - comStatus, alturaStatus);

  const ordens = Array.from({ length: 50 }, (_, i) => ({ ordem: ordem(i + 1), linhas: [] }));
  const folhas = paginarOrdens(ordens, "simples", 4, alturaStatus);
  assert.ok(folhas[0].length * MM_ORDEM <= comStatus);
});
