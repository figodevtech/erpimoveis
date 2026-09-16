/**
 * Saldo de uma conta bancária linha a linha, como num extrato.
 *
 * Só entra o que movimentou a conta: transação liquidada e não excluída. Título
 * a receber ou a pagar ainda não mexeu no dinheiro.
 */

/** RECEITA e DEPOSITO entram na conta; DESPESA e SAQUE saem. Outro tipo não move saldo. */
export function valorAssinadoNoBanco(tipo: string, valor: number): number {
  const normalizado = String(tipo ?? "").toUpperCase();
  if (normalizado === "RECEITA" || normalizado === "DEPOSITO") return valor;
  if (normalizado === "DESPESA" || normalizado === "SAQUE") return -valor;
  return 0;
}

export type MovimentoDaConta = { id: number; valorAssinado: number };

/**
 * Saldo da conta logo depois de cada movimento, por id.
 *
 * `movimentos` precisa vir na ordem do extrato crescente — dia do movimento,
 * registro, id —, a mesma da tabela lida de baixo para cima. O id sozinho não
 * serve: numa baixa ele é o do título, que nasceu antes do dinheiro andar.
 *
 * Acumula em centavos para que milhares de linhas não arrastem erro de ponto
 * flutuante até o saldo exibido.
 */
export function saldosAposCadaMovimento(
  valorInicial: number,
  movimentos: MovimentoDaConta[],
): Map<number, number> {
  const saldos = new Map<number, number>();
  let centavos = Math.round(valorInicial * 100);

  for (const movimento of movimentos) {
    centavos += Math.round(movimento.valorAssinado * 100);
    saldos.set(movimento.id, centavos / 100);
  }

  return saldos;
}
