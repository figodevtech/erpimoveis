import { endOfMonth, startOfMonth, subMonths } from "date-fns";

export type PeriodoDashboard = { inicio: Date; fim: Date };

// mês atual: do dia 1 até hoje (não adianta projetar dias que ainda não aconteceram)
export function obterMesAtual(): PeriodoDashboard {
  const hoje = new Date();
  const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1, 0, 0, 0);
  const fim = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 23, 59, 59);
  return { inicio, fim };
}

// mês anterior inteiro: do dia 1 ao último dia
export function obterMesAnterior(): PeriodoDashboard {
  const anterior = subMonths(new Date(), 1);
  const inicio = startOfMonth(anterior);
  const fim = endOfMonth(anterior);
  fim.setHours(23, 59, 59, 0);
  return { inicio, fim };
}

// intervalo padrão do dashboard: o mês atual
export function obterPeriodoInicial(): PeriodoDashboard {
  return obterMesAtual();
}

// compara pelo dia, ignorando hora — é o que a API recebe
export function mesmoPeriodo(a: Partial<PeriodoDashboard>, b: PeriodoDashboard) {
  if (!a.inicio || !a.fim) return false;
  return (
    formatarDataYYYYMMDD(a.inicio) === formatarDataYYYYMMDD(b.inicio) &&
    formatarDataYYYYMMDD(a.fim) === formatarDataYYYYMMDD(b.fim)
  );
}

export function formatarDataCurta(d: Date) {
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
}

export function formatarDataCompleta(d: Date) {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}


// formato que a API espera: YYYY-MM-DD
export function formatarDataYYYYMMDD(d: Date) {
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}
