/**
 * O boleto do terceirizado: uma ou mais despesas de serviço da OS quitadas por
 * um pagamento só, que pode ser parcelado.
 *
 * A presença deste objeto é o que faz o diálogo de transação mudar de alvo: em
 * vez de criar uma transação avulsa, ele registra um lançamento de despesas.
 * Mesmo mecanismo do `ContextoPagamentoMultiplo` — ver `pagamento-multiplo.tsx`.
 */
export type ContextoLancamentoDeEventos = {
  /**
   * A OS, quando o lançamento tem uma só.
   *
   * Ausente quando a seleção atravessa ordens — o boleto único do terceirizado
   * que cobrou serviços de três carros. Aí a ordem de cada despesa vem do
   * próprio evento, e quem descobre se são uma ou várias é o servidor.
   */
  ordemServicoId?: number;
  /** As despesas selecionadas. O servidor relê os valores; daqui vai só a escolha. */
  eventosIds: number[];
  onConcluido?: () => void;
};

/**
 * Desfaz o lançamento inteiro.
 *
 * Existe como função compartilhada porque excluir parcela por parcela deixaria
 * as despesas quitadas por um valor que ninguém mais deve.
 */
export async function excluirLancamentoDeEventos(lancamentoId: number) {
  const resposta = await fetch(`/api/lancamento-de-eventos/${lancamentoId}`, {
    method: "DELETE",
  });
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    throw new Error(corpo?.error ?? "Não foi possível desfazer o lançamento.");
  }
  return corpo?.data;
}
