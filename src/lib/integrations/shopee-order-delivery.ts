export type EntregaVenda = "SEPARACAO" | "ENVIO" | "ENTREGUE";

/**
 * Entrega da venda a partir do status do pedido na Shopee. Nulo antes do
 * pagamento, no cancelamento e na devolução: nesses casos a entrega não muda.
 */
export function entregaDoPedidoShopee(orderStatus?: string | null): EntregaVenda | null {
  const status = String(orderStatus ?? "").toUpperCase();
  if (status === "READY_TO_SHIP" || status === "PROCESSED") return "SEPARACAO";
  if (status === "SHIPPED") return "ENVIO";
  // TO_CONFIRM_RECEIVE: o comprador recebeu e ainda vai confirmar na Shopee.
  if (status === "TO_CONFIRM_RECEIVE" || status === "COMPLETED") return "ENTREGUE";
  return null;
}

const ORDEM: Array<string | null> = [null, "SEPARACAO", "ENVIO", "ENTREGUE"];

/**
 * A entrega só avança. Quem marcou à mão um passo adiante no pedido marketplace
 * não é desfeito pela próxima sincronização. Devolve o novo valor ou nulo.
 */
export function entregaAvancada(atual: string | null | undefined, nova: EntregaVenda | null) {
  if (!nova) return null;
  const posicaoAtual = ORDEM.indexOf(String(atual ?? "").toUpperCase() || null);
  return ORDEM.indexOf(nova) > posicaoAtual ? nova : null;
}
