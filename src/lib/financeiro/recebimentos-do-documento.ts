import { valorDeFace } from "./transacao";

/**
 * Quanto já foi pago de uma OS ou de uma venda, em centavos.
 *
 * Conta pela FACE, nunca pelo bruto cobrado: juros e multa são do pagamento, não
 * do documento. Somá-los faria uma venda paga com atraso parecer paga a mais — a
 * última parcela legítima voltava como "a soma dos pagamentos ultrapassa o valor
 * da venda", e o teste de quitação nunca batia, deixando a venda paga e aberta.
 *
 * É a mesma conta que a view `recebimento_por_documento` faz no banco, para OS e
 * para venda: `greatest(valor - greatest(valor_acrescimos, 0), 0)`. Ter isto num
 * lugar só é o ponto: a regra da face nasceu no caminho de OS e foi esquecida
 * nos dois caminhos de venda justamente porque a soma estava escrita à mão em
 * cada rota.
 *
 * Centavos porque quem chama compara com o total do documento também em
 * centavos, e em ponto flutuante 0.1 + 0.2 não dá 0.3.
 */
export function somarRecebimentosDeFace(
  transacoes:
    | Array<{
        valor?: number | string | null;
        valor_acrescimos?: number | string | null;
      }>
    | null
    | undefined,
): number {
  return (transacoes ?? []).reduce((total, transacao) => {
    const face = valorDeFace(transacao);
    return total + Math.round((Number.isFinite(face) ? face : 0) * 100);
  }, 0);
}
