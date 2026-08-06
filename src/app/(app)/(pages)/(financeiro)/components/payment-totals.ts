import { valorDeFace, valorLiquidoEfetivo } from "@/lib/financeiro/transacao";
import { Transaction } from "../fluxodecaixa/types";

export type ResumoDePagamentos = {
  /**
   * Soma do que abate o total da OS/venda: o valor de face, sem os acrescimos.
   * Juros e multa sao do pagamento, nao do documento — se entrassem aqui, uma OS
   * paga com atraso apareceria como paga a mais.
   */
  bruto: number;
  /** Soma do que efetivamente entrou no banco, ja descontados taxa e demais descontos. */
  liquido: number;
  /** Soma dos acrescimos (juros, multa) cobrados nos pagamentos. */
  acrescimos: number;
  /** Quanto os descontos comeram do bruto. Zero quando nao ha nenhum. */
  taxa: number;
  /** `true` quando ao menos um pagamento tem desconto ou taxa de recebimento. */
  temTaxa: boolean;
  /** `true` quando ao menos um pagamento tem acrescimo. */
  temAcrescimo: boolean;
};

/** Dinheiro comparado em centavos: 96.5 - 96.5 nem sempre da 0 em float. */
const emCentavos = (valor: number) => Math.round(valor * 100);

/**
 * Soma os recebimentos de uma OS ou venda, em bruto e em liquido.
 *
 * Conta so o que abate o documento: receitas nao deletadas que nao vieram de um
 * evento financeiro (juros, multa e afins tem total proprio). Pagamentos
 * pendentes entram — a lista ja os considerava no total pago, e mudar isso
 * mexeria no badge de situacao.
 *
 * `valorLiquido` so existe para recebimento por maquineta; nos demais casos
 * `valorLiquidoEfetivo` devolve o proprio bruto, entao `temTaxa` fica falso e a
 * tela mostra um numero so.
 *
 * O que abate o documento e a face (`valorDeFace`), nao o bruto cobrado: um
 * pagamento de R$ 1.030 que inclui R$ 30 de juros abate R$ 1.000 da OS.
 */
export function resumirPagamentos(
  transacoes: Transaction[] | null | undefined,
): ResumoDePagamentos {
  const pagamentos = (transacoes ?? []).filter(
    (t) =>
      String(t?.tipo ?? "").toUpperCase() === "RECEITA" &&
      t?.evento_financeiro_id == null &&
      t?.is_deleted !== true,
  );

  let faceCents = 0;
  let liquidoCents = 0;
  let acrescimosCents = 0;
  let cobradoCents = 0;

  for (const pagamento of pagamentos) {
    faceCents += emCentavos(valorDeFace(pagamento));
    liquidoCents += emCentavos(valorLiquidoEfetivo(pagamento));
    acrescimosCents += emCentavos(Number(pagamento?.valor_acrescimos ?? 0));
    cobradoCents += emCentavos(Number(pagamento?.valor ?? 0));
  }

  return {
    bruto: faceCents / 100,
    liquido: liquidoCents / 100,
    acrescimos: acrescimosCents / 100,
    // A taxa e a diferenca entre o que foi cobrado e o que entrou — medida sobre
    // o cobrado, nao sobre a face, senao o acrescimo apareceria como se fosse
    // desconto negativo.
    taxa: (cobradoCents - liquidoCents) / 100,
    temTaxa: cobradoCents !== liquidoCents,
    temAcrescimo: acrescimosCents > 0,
  };
}
