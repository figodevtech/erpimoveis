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
 * Valor de face: o que a transação valia antes de juros, multa e afins.
 *
 * `valor` é o que o cliente paga, já com os acréscimos aplicados. Para abater um
 * documento, porém, o que conta é a face — acréscimo e desconto são do
 * pagamento, não da OS nem da venda. Somar o bruto faria a OS parecer paga a
 * mais só porque o cliente atrasou e pagou juros.
 *
 * É a mesma separação que o sistema já faz em `acrescimo_financeiro`, que por
 * definição "não altera itens ou valores fiscais".
 *
 * Transação sem ajuste nenhum tem face igual ao bruto, que é o estado de tudo
 * que existia antes desta coluna.
 */
export function valorDeFace(transacao: {
  valor?: number | string | null;
  valor_acrescimos?: number | string | null;
}): number {
  const bruto = Number(transacao.valor ?? 0);
  const brutoSeguro = Number.isFinite(bruto) ? bruto : 0;

  const acrescimos = Number(transacao.valor_acrescimos ?? 0);
  const acrescimosSeguros =
    Number.isFinite(acrescimos) && acrescimos > 0 ? acrescimos : 0;

  // Centavos para não deixar 1030.1 - 30.1 virar 999.9999999999999.
  return Math.round((brutoSeguro - acrescimosSeguros) * 100) / 100;
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
  valor_descontos?: number | string | null;
  tipo?: string | null;
}): number {
  const bruto = Number(transacao.valor ?? 0);
  const brutoSeguro = Number.isFinite(bruto) ? bruto : 0;

  const liquido = Number(transacao.valorLiquido ?? 0);
  const liquidoValido = Number.isFinite(liquido) && liquido > 0;

  // Desconto lançado vale para qualquer tipo: uma conta a pagar quitada com
  // abatimento por antecipação sai da conta pelo valor abatido, não pelo cheio.
  // A regra de ignorar o líquido em despesa e depósito nasceu de registro antigo
  // com lixo nesse campo — com linha de desconto não há dúvida sobre o número.
  const descontos = Number(transacao.valor_descontos ?? 0);
  if (Number.isFinite(descontos) && descontos > 0) {
    return liquidoValido ? liquido : Math.round((brutoSeguro - descontos) * 100) / 100;
  }

  if (!tipoTemValorLiquido(transacao.tipo)) return brutoSeguro;

  return liquidoValido ? liquido : brutoSeguro;
}
