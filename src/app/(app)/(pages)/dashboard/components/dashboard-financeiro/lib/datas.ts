import { obterMesAtual, type PeriodoDashboard } from "../../shared/periodo";

// intervalo padrão do dashboard: o mês atual
export function obterPeriodoInicial(): PeriodoDashboard {
  return obterMesAtual();
}

export function formatarDataCurta(d: Date) {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function formatarDataCompleta(d: Date) {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatarDataYYYYMMDD(d: Date) {
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}
