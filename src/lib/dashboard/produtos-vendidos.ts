/**
 * Ranking de produtos vendidos no período.
 *
 * "Vendido" é produto que saiu cobrado do cliente, por dois caminhos que se
 * somam: a venda de balcão/PDV e a peça aplicada numa OS. Na oficina a maior
 * parte do produto sai pela OS, então só o PDV daria um ranking pela metade.
 *
 * Esta camada é pura de propósito: recebe itens já normalizados pela rota e não
 * conhece Supabase. É o que torna a regra testável sem banco.
 *
 * Fica de fora, e é escolha, não esquecimento:
 * - produto avulso da OS (`osproduto_avulso`), que não tem cadastro e portanto
 *   não tem como entrar num ranking por produto;
 * - consumo interno na OS (`estoque_saida` com motivo `CONSUMO_EM_OS`), que é
 *   material aplicado e não cobrado — não é venda;
 * - desconto geral do documento, que incide sobre a soma dos itens e não está
 *   gravado em `vendaproduto`/`osproduto`. Consequência: a soma do faturamento
 *   por produto fica acima do valor do documento quando há desconto de
 *   cabeçalho. Ratear traria a complexidade inteira da aba de Rentabilidade
 *   para um gráfico de ranking.
 */

export type OrigemVenda = "VENDA" | "OS";

export type ItemVendido = {
  origem: OrigemVenda;
  /** `venda.id` ou `ordemservico.id` — o que faz `documentos` contar documento, não linha. */
  documentoId: unknown;
  produtoId: unknown;
  titulo: unknown;
  referencia: unknown;
  unidade: unknown;
  /** `produto.grupo_produto_id` — o "Grupo" do cadastro do produto. */
  grupoId: unknown;
  grupoNome: unknown;
  /** `integer` no banco, mas o PostgREST devolve número ou string. */
  quantidade: unknown;
  /** Já resolvido pelo chamador: a regra de faturamento difere entre venda e OS. */
  faturamento: unknown;
};

export type ValoresPorOrigem = {
  quantidade: number;
  faturamento: number;
};

export type ProdutoVendido = ValoresPorOrigem & {
  produtoId: number;
  titulo: string;
  referencia: string | null;
  unidade: string | null;
  /** `null` quando o produto não tem grupo no cadastro. */
  grupoId: number | null;
  grupoNome: string;
  venda: ValoresPorOrigem;
  os: ValoresPorOrigem;
  documentos: number;
};

/** Rótulo de quem ficou sem grupo — some do cadastro, não do ranking. */
export const SEM_GRUPO = "Sem grupo";

export type TotalPorOrigem = ValoresPorOrigem & {
  produtosDistintos: number;
  documentos: number;
};

export type ProdutosVendidosAgregados = {
  ranking: ProdutoVendido[];
  totais: { todas: TotalPorOrigem; venda: TotalPorOrigem; os: TotalPorOrigem };
  /** Liga quando o ranking bateu no teto e foi cortado. */
  truncado: boolean;
};

/**
 * Teto de segurança. O cliente corta o top 10 depois de reordenar, então o
 * ranking vem inteiro — mas uma oficina com catálogo gigante não deve derrubar
 * a aba. Se isto começar a ligar, a hora é de trocar a agregação em JS por uma
 * RPC com `GROUP BY` no banco; a resposta HTTP não muda.
 */
export const LIMITE_RANKING = 500;

function numero(valor: unknown) {
  const resultado = Number(valor ?? 0);
  return Number.isFinite(resultado) ? resultado : 0;
}

function texto(valor: unknown): string | null {
  if (valor == null) return null;
  const limpo = String(valor).trim();
  return limpo || null;
}

function zerado(): ValoresPorOrigem {
  return { quantidade: 0, faturamento: 0 };
}

type Acumulado = Omit<ProdutoVendido, "documentos"> & { documentos: Set<number> };

export function agregarProdutosVendidos(itens: ItemVendido[]): ProdutosVendidosAgregados {
  const porProduto = new Map<number, Acumulado>();

  // Documento distinto é por origem: venda #7 e OS #7 não são o mesmo papel.
  const documentosTodas = new Set<string>();
  const documentosVenda = new Set<number>();
  const documentosOs = new Set<number>();

  const somaTodas = zerado();
  const somaVenda = zerado();
  const somaOs = zerado();

  for (const item of itens) {
    const produtoId = numero(item.produtoId);
    const quantidade = numero(item.quantidade);
    // Linha sem produto ou sem quantidade não é venda de nada.
    if (!produtoId || quantidade <= 0) continue;

    const faturamento = numero(item.faturamento);
    const documentoId = numero(item.documentoId);
    const daVenda = item.origem === "VENDA";

    let acumulado = porProduto.get(produtoId);
    if (!acumulado) {
      const grupoId = numero(item.grupoId) || null;
      acumulado = {
        produtoId,
        titulo: texto(item.titulo) ?? `Produto #${produtoId}`,
        referencia: texto(item.referencia),
        unidade: texto(item.unidade),
        grupoId,
        grupoNome: texto(item.grupoNome) ?? SEM_GRUPO,
        quantidade: 0,
        faturamento: 0,
        venda: zerado(),
        os: zerado(),
        documentos: new Set<number>(),
      };
      porProduto.set(produtoId, acumulado);
    }

    acumulado.quantidade += quantidade;
    acumulado.faturamento += faturamento;
    acumulado.documentos.add(documentoId);

    const bucketProduto = daVenda ? acumulado.venda : acumulado.os;
    bucketProduto.quantidade += quantidade;
    bucketProduto.faturamento += faturamento;

    somaTodas.quantidade += quantidade;
    somaTodas.faturamento += faturamento;
    documentosTodas.add(`${item.origem}:${documentoId}`);

    const somaOrigem = daVenda ? somaVenda : somaOs;
    somaOrigem.quantidade += quantidade;
    somaOrigem.faturamento += faturamento;
    (daVenda ? documentosVenda : documentosOs).add(documentoId);
  }

  const todos = Array.from(porProduto.values());

  // Ordenação determinística: sem o desempate por id, produtos empatados
  // trocam de lugar entre recargas e o teste fica intermitente.
  todos.sort(
    (a, b) =>
      b.quantidade - a.quantidade || b.faturamento - a.faturamento || a.produtoId - b.produtoId,
  );

  const truncado = todos.length > LIMITE_RANKING;
  const ranking = (truncado ? todos.slice(0, LIMITE_RANKING) : todos).map((produto) => ({
    ...produto,
    documentos: produto.documentos.size,
  }));

  const distintos = (origem: OrigemVenda | null) =>
    todos.filter((produto) =>
      origem === null ? true : (origem === "VENDA" ? produto.venda : produto.os).quantidade > 0,
    ).length;

  return {
    ranking,
    totais: {
      todas: { ...somaTodas, produtosDistintos: distintos(null), documentos: documentosTodas.size },
      venda: { ...somaVenda, produtosDistintos: distintos("VENDA"), documentos: documentosVenda.size },
      os: { ...somaOs, produtosDistintos: distintos("OS"), documentos: documentosOs.size },
    },
    truncado,
  };
}
