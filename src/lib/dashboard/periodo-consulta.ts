/**
 * Leitura do par `dateFrom`/`dateTo` que os dashboards mandam na URL.
 *
 * O contrato é o mesmo das abas de OS e Financeiro: duas datas puras
 * (YYYY-MM-DD, sem hora e sem fuso) que representam dias no fuso da oficina.
 * Aqui elas viram os limites UTC de um intervalo **semiaberto** — o início
 * entra, a meia-noite seguinte ao fim fica de fora. Nunca `lte 23:59:59`, que
 * perde o último segundo do dia.
 *
 * O par de helpers está copiado em ~11 rotas. Este módulo é o começo da
 * unificação: rotas novas usam daqui, as antigas migram quando forem tocadas.
 */
const FORTALEZA_OFFSET = "-03:00";

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type PeriodoDaConsulta = {
  /** Ecoa o filtro recebido, para a resposta devolver o que foi pedido. */
  dateFrom: string;
  dateTo: string;
  /** Limite inferior, inclusivo: usar com `.gte()`. */
  inicioIso: string;
  /** Limite superior, exclusivo: usar com `.lt()`. */
  fimExclusivoIso: string;
};

export function localDayStartToUtcIso(date: string) {
  return new Date(`${date}T00:00:00${FORTALEZA_OFFSET}`).toISOString();
}

export function localNextDayStartToUtcIso(date: string) {
  const start = new Date(`${date}T00:00:00${FORTALEZA_OFFSET}`);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

/** Devolve `null` quando o par não valida — o chamador responde 400. */
export function lerPeriodoDaUrl(params: URLSearchParams): PeriodoDaConsulta | null {
  const dateFrom = params.get("dateFrom") ?? "";
  const dateTo = params.get("dateTo") ?? "";

  if (!DATE_PATTERN.test(dateFrom) || !DATE_PATTERN.test(dateTo) || dateFrom > dateTo) {
    return null;
  }

  return {
    dateFrom,
    dateTo,
    inicioIso: localDayStartToUtcIso(dateFrom),
    fimExclusivoIso: localNextDayStartToUtcIso(dateTo),
  };
}
