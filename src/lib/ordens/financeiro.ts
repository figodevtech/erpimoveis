import { calculateFinancialTotal } from "@/lib/financial-surcharge";
import { valorDeFace } from "@/lib/financeiro/transacao";

export const STATUS_OS_COM_LANCAMENTO_FINANCEIRO = [
  "ORCAMENTO_APROVADO",
  "EM_ANDAMENTO",
  "PAGAMENTO",
] as const;

export type StatusOsComLancamentoFinanceiro =
  (typeof STATUS_OS_COM_LANCAMENTO_FINANCEIRO)[number];

export type TransacaoFinanceiraOs = {
  tipo?: string | null;
  pendente?: boolean | null;
  evento_financeiro_id?: number | string | null;
  valor?: number | string | null;
  valor_acrescimos?: number | string | null;
};

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

export function podeRegistrarPagamentoOs(status: unknown): status is StatusOsComLancamentoFinanceiro {
  return STATUS_OS_COM_LANCAMENTO_FINANCEIRO.includes(
    String(status ?? "").toUpperCase() as StatusOsComLancamentoFinanceiro,
  );
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
  const valorRecebido = moeda(
    recebimentos
      .filter((transacao) => transacao.pendente !== true)
      .reduce((total, transacao) => total + valorDeFace(transacao), 0),
  );
  const valorPendente = moeda(
    recebimentos
      .filter((transacao) => transacao.pendente === true)
      .reduce((total, transacao) => total + valorDeFace(transacao), 0),
  );
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
