import assert from "node:assert/strict";
import test from "node:test";

import { montarIndicadores } from "@/app/(app)/(pages)/(financeiro)/dre/apresentacao";
import type { LinhaDre } from "@/app/(app)/(pages)/(financeiro)/dre/types";

import { dataBr, emissaoEmTexto, linhasDaFolha, periodoEmTexto, variacaoEmTexto } from "./report-model";

let proximoId = 1;
function linha(parcial: Partial<LinhaDre> & Pick<LinhaDre, "codigo" | "tipo">, filhos: LinhaDre[] = []): LinhaDre {
  return {
    id: proximoId++,
    nome: parcial.codigo,
    nivel: 1,
    parentId: null,
    naturezaDre: null,
    formula: null,
    sinal: 1,
    semFonte: false,
    valor: 0,
    valorAnterior: 0,
    variacao: 0,
    variacaoPercentual: null,
    percentualReceitaLiquida: null,
    lancamentos: 0,
    ...parcial,
    filhos,
  };
}

/** Recorte do template real: grupo com filhos, fórmula no meio, subgrupo e o resultado no fim. */
function template() {
  return [
    linha({ codigo: "1", tipo: "GRUPO" }, [
      linha({ codigo: "1.1", tipo: "DETALHE", nivel: 2 }),
      linha({ codigo: "1.2", tipo: "DETALHE", nivel: 2 }),
    ]),
    linha({ codigo: "2", tipo: "GRUPO" }, [linha({ codigo: "2.1", tipo: "DETALHE", nivel: 2 })]),
    linha({ codigo: "3", tipo: "FORMULA", formula: "1 - 2" }),
    linha({ codigo: "8", tipo: "GRUPO" }, [
      linha({ codigo: "8.1", tipo: "GRUPO", nivel: 2 }, [linha({ codigo: "8.1.1", tipo: "DETALHE", nivel: 3 })]),
    ]),
    linha({ codigo: "11", tipo: "GRUPO" }),
    linha({ codigo: "14", tipo: "FORMULA", formula: "12 - 13" }),
  ];
}

test("a folha traz a árvore inteira, em profundidade e na ordem do template", () => {
  const codigos = linhasDaFolha(template()).map((item) => item.linha.codigo);
  assert.deepEqual(codigos, ["1", "1.1", "1.2", "2", "2.1", "3", "8", "8.1", "8.1.1", "11", "14"]);
});

test("o peso visual vem da estrutura: grupo, subgrupo, conta e resultados", () => {
  const papel = new Map(linhasDaFolha(template()).map((item) => [item.linha.codigo, item.papel]));
  assert.equal(papel.get("1"), "GRUPO");
  assert.equal(papel.get("1.1"), "CONTA");
  assert.equal(papel.get("3"), "RESULTADO");
  assert.equal(papel.get("8.1"), "SUBGRUPO");
  assert.equal(papel.get("8.1.1"), "CONTA");
  // Grupo sem filhos no template continua sendo título de primeiro nível.
  assert.equal(papel.get("11"), "GRUPO");
  // Só a última linha da demonstração é o resultado final.
  assert.equal(papel.get("14"), "RESULTADO_FINAL");
});

test("título de grupo desce com a primeira linha, e o resultado não abre folha sozinho", () => {
  const amarradas = linhasDaFolha(template())
    .filter((item) => item.manterComProxima)
    .map((item) => item.linha.codigo);
  // 1, 2, 8 e 8.1 têm filhos; 2.1 antecede o 3; 11 antecede o 14.
  assert.deepEqual(amarradas, ["1", "2", "2.1", "8", "8.1", "11"]);
});

test("a última linha nunca fica amarrada a uma linha que não existe", () => {
  const folha = linhasDaFolha([linha({ codigo: "1", tipo: "GRUPO" }, [linha({ codigo: "1.1", tipo: "DETALHE", nivel: 2 })])]);
  assert.equal(folha.at(-1)?.manterComProxima, false);
  assert.deepEqual(linhasDaFolha([]), []);
});

test("variação: seta pelo sentido, percentual da apuração e travessão sem movimento", () => {
  assert.equal(variacaoEmTexto({ valor: 1500, valorAnterior: 1000, variacao: 500, variacaoPercentual: 50 }), "▲ 50,0%");
  assert.equal(variacaoEmTexto({ valor: -300, valorAnterior: 200, variacao: -500, variacaoPercentual: -250 }), "▼ -250,0%");
  assert.equal(variacaoEmTexto({ valor: 80, valorAnterior: 80, variacao: 0, variacaoPercentual: 0 }), "= 0,0%");
  // Sem valor anterior não há base: a seta aparece, o percentual não.
  assert.equal(variacaoEmTexto({ valor: 80, valorAnterior: 0, variacao: 80, variacaoPercentual: null }), "▲ —");
  assert.equal(variacaoEmTexto({ valor: 0, valorAnterior: 0, variacao: 0, variacaoPercentual: null }), "—");
});

test("período e emissão no formato brasileiro", () => {
  assert.equal(dataBr("2026-09-01"), "01/09/2026");
  assert.equal(periodoEmTexto({ de: "2026-08-01", ate: "2026-08-31" }), "01/08/2026 a 31/08/2026");
  // 13:05 UTC é 10:05 no fuso da operação (UTC-3), e meia-noite não vira "24".
  assert.equal(emissaoEmTexto(new Date("2026-09-16T13:05:00.000Z")), "16/09/2026 às 10:05");
  assert.equal(emissaoEmTexto(new Date("2026-09-16T03:00:00.000Z")), "16/09/2026 às 00:00");
});

test("indicadores do resumo são os mesmos da tela, com margem só havendo receita líquida", () => {
  const cards = montarIndicadores({ "3": 1000, "5": 400, "7": 250, "14": -50 });
  assert.deepEqual(
    cards.map((card) => [card.rotulo, card.valor, card.extra]),
    [
      ["Receita líquida", 1000, null],
      ["Lucro bruto", 400, 40],
      ["EBITDA", 250, 25],
      ["Resultado líquido", -50, -5],
    ],
  );
  assert.ok(montarIndicadores({ "3": 0, "5": 10 }).every((card) => card.extra === null));
});
