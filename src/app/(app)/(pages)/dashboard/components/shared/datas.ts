import { obterMesAtual, type PeriodoDashboard } from "./periodo";

// intervalo padrão dos dashboards: o mês atual
export function obterPeriodoInicial(): PeriodoDashboard {
  return obterMesAtual();
}

export function formatarDataCurta(d: Date) {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function formatarDataCompleta(d: Date) {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// formato que a API espera: YYYY-MM-DD. Lido do calendário local, sem passar
// por UTC — `toISOString()` aqui jogaria a data para o dia anterior à noite.
export function formatarDataYYYYMMDD(d: Date) {
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}
