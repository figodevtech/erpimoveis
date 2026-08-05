import { valorLiquidoEfetivo } from "@/lib/financeiro/transacao";
import { Transaction } from "../fluxodecaixa/types";

export type ResumoDePagamentos = {
  /** Soma do que o cliente pagou. E este valor que abate o total da OS/venda. */
  bruto: number;
  /** Soma do que efetivamente entrou no banco, ja descontada a taxa da maquineta. */
  liquido: number;
  /** Quanto a taxa de recebimento comeu do bruto. Zero quando nao ha taxa. */
  taxa: number;
  /** `true` quando ao menos um pagamento tem taxa de recebimento. */
  temTaxa: boolean;
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

  let brutoCents = 0;
  let liquidoCents = 0;

  for (const pagamento of pagamentos) {
    brutoCents += emCentavos(Number(pagamento?.valor ?? 0));
    liquidoCents += emCentavos(valorLiquidoEfetivo(pagamento));
  }

  return {
    bruto: brutoCents / 100,
    liquido: liquidoCents / 100,
    taxa: (brutoCents - liquidoCents) / 100,
    temTaxa: liquidoCents !== brutoCents,
  };
}
