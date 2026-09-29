import { paraCentavos, paraReais } from "@/lib/financeiro/rateio";

export type LinhaEmQuantidadeInteira = {
  quantidade: number;
  valorUnitario: number;
  /** Somar ao desconto da linha. */
  ajusteDesconto: number;
  /** Somar às outras despesas da linha. */
  ajusteOutrasDespesas: number;
};

/**
 * O saldo dos estoques é inteiro. Linha fracionada da NF-e (6,15 M) entra com a
 * quantidade no inteiro mais próximo — nunca abaixo de 1 — e com o mesmo custo:
 * o unitário é refeito nas quatro casas que o motor de entrada guarda, e o
 * resíduo em centavos vai para desconto ou outras despesas, como no rateio da
 * entrada personalizada. Linha inteira passa intacta.
 */
export function linhaEmQuantidadeInteira(
  quantidade: number,
  valorUnitario: number,
): LinhaEmQuantidadeInteira {
  if (!Number.isFinite(quantidade) || quantidade <= 0 || Number.isInteger(quantidade)) {
    return { quantidade, valorUnitario, ajusteDesconto: 0, ajusteOutrasDespesas: 0 };
  }

  const inteira = Math.max(1, Math.round(quantidade));
  // O mesmo bruto que `calcularCustoEstoque` usa para o custo da linha.
  const brutoEmCentavos = paraCentavos(quantidade * valorUnitario);
  const unitarioEmDezMilesimos = Math.round((brutoEmCentavos * 100) / inteira);
  // O motor faz round(qtd * custo, 2) em numeric: meio centavo sobe.
  const recalculadoEmCentavos = Math.floor((inteira * unitarioEmDezMilesimos + 50) / 100);
  const ajuste = brutoEmCentavos - recalculadoEmCentavos;

  return {
    quantidade: inteira,
    valorUnitario: unitarioEmDezMilesimos / 10_000,
    ajusteDesconto: ajuste < 0 ? paraReais(-ajuste) : 0,
    ajusteOutrasDespesas: ajuste > 0 ? paraReais(ajuste) : 0,
  };
}
