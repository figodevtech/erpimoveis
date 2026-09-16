// src/app/(app)/(pages)/(financeiro)/dre/apresentacao.ts
//
// Como a DRE escreve os seus números. A tela e a folha impressa importam daqui:
// se cada uma formatasse por conta própria, o papel poderia mostrar um
// percentual arredondado diferente do que está no monitor.

import type { LinhaDre } from "./types";

const MOEDA = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export const brl = (v: number) => MOEDA.format(Number.isFinite(v) ? v : 0);

/** `null` é "não se aplica" (sem base de comparação), diferente de zero. */
export const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(1).replace(".", ",")}%`);

/** Indicadores do topo. Margens só existem se houver receita líquida. */
export function montarIndicadores(ind: Record<string, number>) {
  const receitaLiquida = ind["3"] ?? 0;
  const margem = (v: number) => (receitaLiquida === 0 ? null : (v / receitaLiquida) * 100);

  return [
    { chave: "rl", rotulo: "Receita líquida", valor: ind["3"] ?? 0, extra: null as number | null },
    { chave: "lb", rotulo: "Lucro bruto", valor: ind["5"] ?? 0, extra: margem(ind["5"] ?? 0) },
    { chave: "ebitda", rotulo: "EBITDA", valor: ind["7"] ?? 0, extra: margem(ind["7"] ?? 0) },
    { chave: "rl2", rotulo: "Resultado líquido", valor: ind["14"] ?? 0, extra: margem(ind["14"] ?? 0) },
  ];
}

export type DirecaoDaVariacao = "SUBIU" | "CAIU" | "IGUAL";

/** Sentido da variação contra o período anterior; `null` quando os dois períodos estão zerados. */
export function direcaoDaVariacao(
  linha: Pick<LinhaDre, "valor" | "valorAnterior" | "variacao">,
): DirecaoDaVariacao | null {
  if (linha.valorAnterior === 0 && linha.valor === 0) return null;
  if (linha.variacao === 0) return "IGUAL";
  return linha.variacao > 0 ? "SUBIU" : "CAIU";
}
