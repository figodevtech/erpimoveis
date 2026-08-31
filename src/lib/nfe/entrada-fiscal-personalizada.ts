import { paraCentavos, paraReais } from "@/lib/financeiro/rateio";

export type RateioCustoPersonalizado = {
  custoUnitario: number;
  valorDesconto: number;
  outrasDespesas: number;
  custoTotal: number;
};

/**
 * Converte o custo consolidado da NF-e em uma unica linha fisica de estoque.
 *
 * Os motores de entrada guardam custo unitario com quatro casas e recalculam o
 * total da linha. Quando a divisao nao fecha em centavos, o residuo e carregado
 * nos campos que o motor ja conhece, sem alterar o custo total da mercadoria.
 */
export function ratearCustoPersonalizado(
  custoTotal: number,
  quantidade: number,
): RateioCustoPersonalizado {
  if (!Number.isInteger(quantidade) || quantidade <= 0) {
    throw new Error("A quantidade personalizada deve ser um numero inteiro maior que zero.");
  }
  if (!Number.isFinite(custoTotal) || custoTotal < 0) {
    throw new Error("O custo total da entrada personalizada e invalido.");
  }

  const custoTotalEmCentavos = paraCentavos(custoTotal);
  const custoUnitario = Number((paraReais(custoTotalEmCentavos) / quantidade).toFixed(4));
  const totalCalculadoEmCentavos = paraCentavos(quantidade * custoUnitario);
  const ajusteEmCentavos = custoTotalEmCentavos - totalCalculadoEmCentavos;

  return {
    custoUnitario,
    valorDesconto: ajusteEmCentavos < 0 ? paraReais(-ajusteEmCentavos) : 0,
    outrasDespesas: ajusteEmCentavos > 0 ? paraReais(ajusteEmCentavos) : 0,
    custoTotal: paraReais(custoTotalEmCentavos),
  };
}

