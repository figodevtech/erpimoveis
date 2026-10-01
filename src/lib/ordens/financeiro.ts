import { calculateFinancialTotal } from "@/lib/financial-surcharge";
import { valorDeFace } from "@/lib/financeiro/transacao";

export const STATUS_OS_COM_LANCAMENTO_FINANCEIRO = [
  "ORCAMENTO_APROVADO",
  "EM_ANDAMENTO",
  "PAGAMENTO",
  "FATURAMENTO",
] as const;

export type StatusOsComLancamentoFinanceiro =
  (typeof STATUS_OS_COM_LANCAMENTO_FINANCEIRO)[number];

export type TransacaoFinanceiraOs = {
  tipo?: string | null;
  pendente?: boolean | null;
  evento_financeiro_id?: number | string | null;
  valor?: number | string | null;
  valor_acrescimos?: number | string | null;
  /** Quanto de baixa parcial já cobriu o título. Zero, ou ausente, no comum. */
  valor_baixado?: number | string | null;
};

/*
 * A parte já paga de um título, em valor de face.
 *
 * Um título pago pela metade é ao mesmo tempo recebimento e pendência, e tratá-lo
 * como uma coisa só falseia os dois lados: contado inteiro como pendente, o
 * dinheiro que já entrou some do "recebido"; inteiro como recebido, a OS pareceria
 * quitada sem estar. É o mesmo desdobramento que `recebimento_por_documento` faz
 * no banco, e as duas contas precisam dizer a mesma coisa.
 */
const parteJaPaga = (transacao: TransacaoFinanceiraOs) => {
  const baixado = Number(transacao.valor_baixado ?? 0);
  if (!Number.isFinite(baixado) || baixado <= 0) return 0;
  return Math.min(baixado, valorDeFace(transacao));
};

/**
 * Quanto de um recebimento já entrou e quanto ainda está em aberto, em valor de
 * face. Título liquidado é todo recebido; pendente com baixa parcial se divide.
 *
 * Sai daqui para o relatório de ordens repartir os mesmos números por método
 * de pagamento sem reescrever a conta do saldo da OS.
 */
export function desdobrarRecebimento(transacao: TransacaoFinanceiraOs) {
  if (transacao.pendente !== true) return { recebido: valorDeFace(transacao), pendente: 0 };
  const recebido = parteJaPaga(transacao);
  return { recebido, pendente: Math.max(valorDeFace(transacao) - recebido, 0) };
}

export type ResumoFinanceiroOs = {
  totalDevido: number;
  valorRecebido: number;
  valorPendente: number;
  valorComprometido: number;
  saldoAReceber: number;
  saldoDisponivelParaLancamento: number;
  quantidadeTransacoes: number;
  quitada: boolean;
};

const moeda = (valor: number) =>
  Math.round((Number.isFinite(valor) ? valor : 0) * 100) / 100;

export function podeRegistrarPagamentoOs(status: unknown, habilitarFaturamento = false): status is StatusOsComLancamentoFinanceiro {
  const atual = String(status ?? "").toUpperCase();
  return atual === "ORCAMENTO_APROVADO" || atual === "EM_ANDAMENTO" ||
    atual === (habilitarFaturamento ? "FATURAMENTO" : "PAGAMENTO");
}

export function calcularResumoFinanceiroOs({
  totalComercial,
  acrescimoFinanceiroTipo,
  acrescimoFinanceiroValor,
  transacoes,
}: {
  totalComercial: unknown;
  acrescimoFinanceiroTipo?: string | null;
  acrescimoFinanceiroValor?: unknown;
  transacoes: TransacaoFinanceiraOs[];
}): ResumoFinanceiroOs {
  const totalDevido = moeda(
    calculateFinancialTotal(
      totalComercial,
      acrescimoFinanceiroTipo,
      acrescimoFinanceiroValor,
    ),
  );
  const recebimentos = transacoes.filter(
    (transacao) =>
      String(transacao.tipo ?? "").toUpperCase() === "RECEITA" &&
      transacao.evento_financeiro_id == null,
  );
  const partes = recebimentos.map(desdobrarRecebimento);
  const valorRecebido = moeda(partes.reduce((total, parte) => total + parte.recebido, 0));
  const valorPendente = moeda(partes.reduce((total, parte) => total + parte.pendente, 0));
  const valorComprometido = moeda(valorRecebido + valorPendente);

  return {
    totalDevido,
    valorRecebido,
    valorPendente,
    valorComprometido,
    saldoAReceber: moeda(Math.max(0, totalDevido - valorRecebido)),
    saldoDisponivelParaLancamento: moeda(
      Math.max(0, totalDevido - valorComprometido),
    ),
    quantidadeTransacoes: recebimentos.length,
    // Títulos pendentes representam um compromisso financeiro válido (ex.: boletos
    // parcelados) e, por isso, também quitam o saldo da OS.
    quitada: totalDevido > 0 && valorComprometido >= totalDevido,
  };
}

export function statusAposEncerrarExecucao(quitada: boolean) {
  return quitada ? "CONCLUIDO" : "PAGAMENTO";
}

export function informarCondicoesPagamentoOs(statusDestino: string, habilitarFaturamento: boolean) {
  return statusDestino === (habilitarFaturamento ? "FATURAMENTO" : "PAGAMENTO");
}
