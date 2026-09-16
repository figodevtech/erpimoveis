// src/app/(app)/(full)/print/relatorios/dre/report-model.ts
//
// A árvore da DRE posta em linhas de folha. Nenhum valor é calculado aqui: a
// folha só decide a ordem, o peso visual de cada linha e o que não pode ficar
// separado numa quebra de página.

import { direcaoDaVariacao, pct } from "@/app/(app)/(pages)/(financeiro)/dre/apresentacao";
import type { LinhaDre } from "@/app/(app)/(pages)/(financeiro)/dre/types";

/**
 * Peso visual da linha. Vem da estrutura do template — tipo, nível e posição —,
 * nunca do código ou do nome, para que um template diferente imprima certo.
 */
export type PapelDaLinha = "GRUPO" | "SUBGRUPO" | "CONTA" | "SUBTOTAL" | "RESULTADO" | "RESULTADO_FINAL";

type NoDaDre = { tipo: LinhaDre["tipo"]; nivel: number; filhos: NoDaDre[] };

export type LinhaDaFolha<T extends NoDaDre> = {
  linha: T;
  papel: PapelDaLinha;
  /** A linha não pode ser a última de uma folha: desce junto com a seguinte. */
  manterComProxima: boolean;
};

function papelDa(linha: NoDaDre, ehUltimaRaiz: boolean): PapelDaLinha {
  if (linha.tipo === "FORMULA") return ehUltimaRaiz ? "RESULTADO_FINAL" : "RESULTADO";
  if (linha.tipo === "SUBTOTAL") return "SUBTOTAL";
  if (linha.nivel <= 1) return "GRUPO";
  return linha.tipo === "GRUPO" || linha.filhos.length > 0 ? "SUBGRUPO" : "CONTA";
}

/**
 * Todas as linhas, em profundidade e na ordem do template. A folha não herda o
 * que estava recolhido na tela: a DRE impressa é a demonstração inteira.
 *
 * Duas amarras de quebra de página:
 * - título de grupo desce com a primeira linha dele, para não ficar sozinho no
 *   pé da folha;
 * - a linha logo acima de um resultado desce com ele, para o total não abrir a
 *   folha seguinte longe das contas que resume.
 */
export function linhasDaFolha<T extends NoDaDre>(raizes: T[]): LinhaDaFolha<T>[] {
  const plano: T[] = [];
  const visitar = (linha: T) => {
    plano.push(linha);
    (linha.filhos as T[]).forEach(visitar);
  };
  raizes.forEach(visitar);

  const ultimaRaiz = raizes.at(-1);

  return plano.map((linha, indice) => {
    const proxima = plano[indice + 1];
    return {
      linha,
      papel: papelDa(linha, linha === ultimaRaiz),
      manterComProxima: Boolean(proxima) && (linha.filhos.length > 0 || proxima.tipo === "FORMULA"),
    };
  });
}

/** "2026-09-01" → "01/09/2026". O período chega como dia, sem fuso para converter. */
export function dataBr(dia: string) {
  const [ano, mes, diaDoMes] = dia.split("-");
  return ano && mes && diaDoMes ? `${diaDoMes}/${mes}/${ano}` : dia;
}

export function periodoEmTexto(periodo: { de: string; ate: string }) {
  return `${dataBr(periodo.de)} a ${dataBr(periodo.ate)}`;
}

/** Momento da emissão no fuso da operação, como as demais folhas: "16/09/2026 às 10:32". */
export function emissaoEmTexto(momento: Date) {
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Fortaleza",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(momento);
  const parte = (tipo: Intl.DateTimeFormatPartTypes) => partes.find((p) => p.type === tipo)?.value ?? "";
  return `${parte("day")}/${parte("month")}/${parte("year")} às ${parte("hour")}:${parte("minute")}`;
}

const SETA = { SUBIU: "▲", CAIU: "▼", IGUAL: "=" } as const;

/**
 * A coluna Variação em texto. Na tela o sentido é um ícone; no papel, uma seta
 * tipográfica — legível em impressora monocromática e sem depender de cor.
 */
export function variacaoEmTexto(linha: Pick<LinhaDre, "valor" | "valorAnterior" | "variacao" | "variacaoPercentual">) {
  const direcao = direcaoDaVariacao(linha);
  if (direcao === null) return "—";
  return `${SETA[direcao]} ${pct(linha.variacaoPercentual)}`;
}
