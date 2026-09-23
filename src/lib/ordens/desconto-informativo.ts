import { arredondarMoeda, sanitizeTipoDesconto } from "./desconto";

/** Anotação do avulso: nunca deve entrar no cálculo comercial ou financeiro. */
export function normalizarDescontoInformativo(tipo: unknown, valor: unknown) {
  const descontoInformativoTipo = sanitizeTipoDesconto(tipo);
  const numero = Number(valor);
  const positivo = Number.isFinite(numero) ? Math.max(0, numero) : 0;
  return {
    descontoInformativoTipo,
    descontoInformativo: !descontoInformativoTipo
      ? 0
      : arredondarMoeda(descontoInformativoTipo === "PORCENTAGEM" ? Math.min(100, positivo) : positivo),
  };
}

export function formatarDescontoInformativo(tipo: unknown, valor: unknown): string | null {
  const desconto = normalizarDescontoInformativo(tipo, valor);
  if (!desconto.descontoInformativoTipo || desconto.descontoInformativo <= 0) return null;
  const texto = desconto.descontoInformativoTipo === "PORCENTAGEM"
    ? `${desconto.descontoInformativo.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`
    : desconto.descontoInformativo.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  return `Desconto informativo: ${texto} (não abatido dos totais)`;
}
