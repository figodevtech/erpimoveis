// Regras de desconto da OS, iguais às aplicadas ao salvar o orçamento
// (PUT /api/ordens/[id]/orcamento) e ao imprimir a ordem de serviço.
//
// O desconto aparece em dois níveis e um não substitui o outro:
// - por item, sobre quantidade x preço unitário (grava osproduto/osservico.subtotal já líquido);
// - geral, sobre a soma dos subtotais dos itens (ordemservico.desconto).

export type TipoDesconto = "FIXO" | "PORCENTAGEM" | null;

export function sanitizeTipoDesconto(value: unknown): TipoDesconto {
  return value === "FIXO" || value === "PORCENTAGEM" ? value : null;
}

function toNum(value: unknown) {
  const numero = Number(value);
  return Number.isFinite(numero) ? numero : 0;
}

export function arredondarMoeda(valor: number) {
  return Math.round((Number.isFinite(valor) ? valor : 0) * 100) / 100;
}

/** Converte o desconto informado (R$ ou %) no valor em reais efetivamente abatido. */
export function calcularDescontoAplicado(base: number, tipo: TipoDesconto, desconto: unknown) {
  const baseSegura = Math.max(0, toNum(base));
  const valor = Math.max(0, toNum(desconto));
  if (!tipo || valor <= 0 || baseSegura <= 0) return 0;
  if (tipo === "PORCENTAGEM") return arredondarMoeda(baseSegura * (Math.min(valor, 100) / 100));
  return arredondarMoeda(Math.min(valor, baseSegura));
}

export function calcularTotalComDesconto(base: number, tipo: TipoDesconto, desconto: unknown) {
  return arredondarMoeda(Math.max(0, toNum(base) - calcularDescontoAplicado(base, tipo, desconto)));
}
