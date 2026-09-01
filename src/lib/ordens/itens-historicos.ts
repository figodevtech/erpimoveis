export type TipoItemHistorico = "PRODUTO" | "SERVICO";

export type ItemHistoricoOs = {
  id: number;
  tipo: TipoItemHistorico;
  subtotal: number;
};

export function agruparItensHistoricos<T extends ItemHistoricoOs>(itens: T[] | null | undefined) {
  const produtos: T[] = [];
  const servicos: T[] = [];

  for (const item of itens ?? []) {
    if (item.tipo === "SERVICO") servicos.push(item);
    else produtos.push(item);
  }

  return {
    produtos,
    servicos,
    totalProdutos: produtos.reduce((total, item) => total + Number(item.subtotal || 0), 0),
    totalServicos: servicos.reduce((total, item) => total + Number(item.subtotal || 0), 0),
  };
}
