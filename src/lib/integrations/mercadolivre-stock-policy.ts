/** Não enviar saldo físico do ERP a estoques gerenciados pelo ML ou multiorigem. */
export function assertMercadoLivreItemStockWritable(item: { shipping?: { logistic_type?: string }; tags?: string[] }) {
  if (item.shipping?.logistic_type === "fulfillment" || item.tags?.includes("multiwarehouse")) {
    throw new Error("Estoque Full ou multiorigem: atualização automática suspensa. Configure a origem do estoque antes de sincronizar; nenhum saldo foi enviado.");
  }
}
