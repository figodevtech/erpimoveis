import type { NewTransaction } from "../../types";
import { Tipo_transacao } from "../../types";

/** O formulário financeiro prepara a decisão; a conciliação continua sendo quem grava. */
export interface ContextoConciliacaoOfx {
  data: string;
  valorCentavos: number;
  bancoId: number;
  onPreparar: (transacao: NewTransaction) => void;
}

export function tiposDaConciliacao(valorCentavos: number): Tipo_transacao[] {
  return valorCentavos > 0
    ? [Tipo_transacao.RECEITA, Tipo_transacao.DEPOSITO]
    : [Tipo_transacao.DESPESA, Tipo_transacao.SAQUE];
}

export function validarTransacaoOfx(
  transacao: NewTransaction,
  contexto: ContextoConciliacaoOfx,
): string | null {
  if (!transacao.descricao?.trim()) return "Preencha a descrição da transação.";
  if (!transacao.metodopagamento) return "Escolha o método de pagamento.";
  if (
    !transacao.tipo ||
    !tiposDaConciliacao(contexto.valorCentavos).includes(transacao.tipo)
  )
    return "O tipo precisa acompanhar a entrada ou saída do extrato.";
  const data = transacao.data;
  const dia =
    data &&
    `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`;
  const valor = Math.abs(contexto.valorCentavos);
  if (
    dia !== contexto.data ||
    transacao.banco_id !== contexto.bancoId ||
    Math.round((transacao.valor ?? 0) * 100) !== valor ||
    Math.round((transacao.valorLiquido ?? 0) * 100) !== valor ||
    transacao.pendente ||
    (transacao.parcelas ?? 1) !== 1
  )
    return "Data, conta e valor devem corresponder ao movimento do extrato.";
  return null;
}
