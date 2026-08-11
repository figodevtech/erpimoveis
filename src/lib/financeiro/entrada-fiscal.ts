import { paraCentavos, paraReais, somarCentavos } from "./rateio";

/**
 * Uma NF-e mista gera duas entradas de estoque, mas continua sendo um único
 * documento financeiro. O total devido é a soma dos dois lados, sem rateio.
 */
export function calcularTotalDocumentoEntrada(
  valorProdutos: number | string | null | undefined,
  valorUsoConsumo: number | string | null | undefined,
) {
  return paraReais(paraCentavos(valorProdutos) + paraCentavos(valorUsoConsumo));
}

export function parcelasFechamTotalDocumento(
  totalDocumento: number | string | null | undefined,
  parcelas: Array<number | string | null | undefined>,
) {
  return somarCentavos(parcelas) === paraCentavos(totalDocumento);
}
