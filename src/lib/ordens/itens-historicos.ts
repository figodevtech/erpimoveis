export type TipoItemHistorico = "PRODUTO" | "SERVICO";

export type ItemHistoricoOs = {
  id: number;
  tipo: TipoItemHistorico;
  subtotal: number;
};

export type ItemHistoricoDetalhado = ItemHistoricoOs & {
  ordemservicoid: number;
  linhaOrigem: number;
  codigoLegado: string | null;
  descricao: string;
  unidade: string | null;
  quantidade: number;
  precoUnitario: number;
};

export function mapearItemHistorico(row: Record<string, unknown>): ItemHistoricoDetalhado {
  return {
    id: Number(row.id),
    ordemservicoid: Number(row.ordemservicoid),
    linhaOrigem: Number(row.linha_origem),
    tipo: row.tipo === "SERVICO" ? "SERVICO" : "PRODUTO",
    codigoLegado: String(row.codigo_legado ?? "").trim() || null,
    descricao: String(row.descricao ?? ""),
    unidade: String(row.unidade ?? "").trim() || null,
    quantidade: Number(row.quantidade ?? 0),
    precoUnitario: Number(row.preco_unitario ?? 0),
    subtotal: Number(row.subtotal ?? 0),
  };
}

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
