import {
  calculateFinancialSurcharge,
  calculateFinancialTotal,
  type FinancialSurchargeType,
} from "@/lib/financial-surcharge";
import {
  arredondarMoeda,
  calcularDescontoAplicado,
  calcularTotalComDesconto,
  type TipoDesconto,
} from "@/lib/ordens/desconto";

function numeroNaoNegativo(value: unknown) {
  const numero = Number(value);
  return Number.isFinite(numero) ? Math.max(0, numero) : 0;
}

export function sanitizarValorFrete(value: unknown) {
  return arredondarMoeda(numeroNaoNegativo(value));
}

export type TotaisOsInput = {
  subtotal: unknown;
  descontoTipo?: TipoDesconto;
  desconto?: unknown;
  valorFrete?: unknown;
  acrescimoFinanceiroTipo?: FinancialSurchargeType | string;
  acrescimoFinanceiroValor?: unknown;
};

/**
 * Regra unica dos totais da OS:
 * itens - desconto comercial + frete = orcamentototal;
 * orcamentototal + acrescimo financeiro = total a receber.
 */
export function calcularTotaisOs(input: TotaisOsInput) {
  const subtotal = arredondarMoeda(numeroNaoNegativo(input.subtotal));
  const descontoAplicado = calcularDescontoAplicado(
    subtotal,
    input.descontoTipo ?? null,
    input.desconto,
  );
  const totalItens = calcularTotalComDesconto(
    subtotal,
    input.descontoTipo ?? null,
    input.desconto,
  );
  const valorFrete = sanitizarValorFrete(input.valorFrete);
  const totalComercial = arredondarMoeda(totalItens + valorFrete);
  const acrescimoFinanceiro = calculateFinancialSurcharge(
    totalComercial,
    input.acrescimoFinanceiroTipo,
    input.acrescimoFinanceiroValor,
  );
  const totalFinanceiro = calculateFinancialTotal(
    totalComercial,
    input.acrescimoFinanceiroTipo,
    input.acrescimoFinanceiroValor,
  );

  return {
    subtotal,
    descontoAplicado,
    totalItens,
    valorFrete,
    totalComercial,
    acrescimoFinanceiro,
    totalFinanceiro,
  };
}

/** Base que deve participar de desconto, margem e comissao. Frete fica fora. */
export function calcularBaseLiquidaDosItens(totalComercial: unknown, valorFrete: unknown) {
  return arredondarMoeda(
    Math.max(0, numeroNaoNegativo(totalComercial) - sanitizarValorFrete(valorFrete)),
  );
}

/**
 * Recupera o desconto geral efetivamente gravado a partir dos totais. O frete
 * e somado ao total da OS, portanto precisa ser retirado antes da comparacao.
 */
export function inferirDescontoGeralOs(input: {
  subtotal: unknown;
  orcamentoTotal: unknown;
  valorFrete?: unknown;
}) {
  const subtotal = numeroNaoNegativo(input.subtotal);
  const total = numeroNaoNegativo(input.orcamentoTotal);
  const frete = sanitizarValorFrete(input.valorFrete);
  if (total <= 0 && frete <= 0) return 0;
  return arredondarMoeda(Math.max(0, Math.min(subtotal, subtotal + frete - total)));
}
