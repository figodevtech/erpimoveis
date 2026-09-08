/** Validação do cadastro de um lançamento, após normalizar o estado pendente. */
export function erroDeBancoNoLancamento(transacao: {
  pendente?: boolean | null;
  banco_id?: number | string | null;
}): string | null {
  if (transacao.pendente === true) return null;
  const bancoId = Number(transacao.banco_id);
  if (!Number.isSafeInteger(bancoId) || bancoId <= 0) {
    return "Selecione o banco ou a conta utilizada para registrar a transação liquidada.";
  }
  return null;
}
