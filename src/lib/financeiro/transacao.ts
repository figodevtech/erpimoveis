/**
 * Regras de domínio de uma transação financeira, sem dependência de React nem
 * de Supabase — servem igual no cliente e nas rotas de API.
 */

/** Colunas que ligam a transação ao documento que a gerou. */
export interface VinculoDeTransacao {
  ordemservicoid?: number | string | null;
  vendaid?: number | string | null;
  entrada_id?: number | string | null;
  usoconsumo_entrada_id?: number | string | null;
}

export type OrigemDeTransacao = "OS" | "VENDA" | "ENTRADA" | "USOCONSUMO";

/**
 * De onde a transação nasceu.
 *
 * É o mesmo conjunto que o DRE já usa para decidir que um lançamento não é
 * resultado novo (`dre_eventos_de_transacao`): liquidação de algo já
 * reconhecido, ou compra que virou estoque.
 */
export function origemDaTransacao(
  transacao: VinculoDeTransacao | null | undefined,
): OrigemDeTransacao | null {
  if (!transacao) return null;
  if (transacao.ordemservicoid != null) return "OS";
  if (transacao.vendaid != null) return "VENDA";
  if (transacao.entrada_id != null) return "ENTRADA";
  if (transacao.usoconsumo_entrada_id != null) return "USOCONSUMO";
  return null;
}

export function rotuloDaOrigem(origem: OrigemDeTransacao): string {
  switch (origem) {
    case "OS":
      return "ordem de serviço";
    case "VENDA":
      return "venda";
    case "ENTRADA":
      return "entrada de estoque";
    case "USOCONSUMO":
      return "entrada de uso e consumo";
  }
}

/**
 * Transação gerada por um documento não pode ter o tipo trocado.
 *
 * Uma receita de OS que vira despesa deixa de abater o documento, e a OS fica
 * CONCLUIDO com saldo em aberto — a rota de edição não revalida status (só o
 * DELETE faz isso). O mesmo vale para uma despesa de entrada virando receita:
 * o custo da compra sumiria do resultado.
 */
export function tipoEhEditavel(transacao: VinculoDeTransacao | null | undefined): boolean {
  return origemDaTransacao(transacao) == null;
}

/**
 * Só saída de dinheiro por maquineta tem taxa, e portanto valor líquido:
 * uma despesa a pagar ou um depósito valem exatamente o que está no bruto.
 *
 * Mesma regra que o cadastro usa para mostrar o switch "Taxa de recebimento".
 */
export function tipoTemValorLiquido(tipo: string | null | undefined): boolean {
  const normalizado = String(tipo ?? "").toUpperCase();
  return normalizado === "RECEITA" || normalizado === "SAQUE";
}

/**
 * Líquido efetivo de uma transação.
 *
 * Registros antigos (e os criados fora do fluxo de caixa, como entrada fiscal)
 * têm `valorLiquido` nulo ou zerado — nesses casos o líquido é o próprio bruto,
 * não R$ 0,00.
 */
export function valorLiquidoEfetivo(transacao: {
  valor?: number | string | null;
  valorLiquido?: number | string | null;
  tipo?: string | null;
}): number {
  const bruto = Number(transacao.valor ?? 0);
  const brutoSeguro = Number.isFinite(bruto) ? bruto : 0;

  if (!tipoTemValorLiquido(transacao.tipo)) return brutoSeguro;

  const liquido = Number(transacao.valorLiquido ?? 0);
  return Number.isFinite(liquido) && liquido > 0 ? liquido : brutoSeguro;
}
