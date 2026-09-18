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

function chaveDoDia(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// compara pelo dia, ignorando hora — é o que a API recebe
export function mesmoPeriodo(a: Partial<PeriodoDashboard>, b: PeriodoDashboard) {
  if (!a.inicio || !a.fim) return false;
  return chaveDoDia(a.inicio) === chaveDoDia(b.inicio) && chaveDoDia(a.fim) === chaveDoDia(b.fim);
}
