/**
 * Os dois estoques simples do ERP — uso e consumo e geral/avulso — vivem nas
 * mesmas tabelas `usoconsumo_*`, separados pela coluna `escopo`. Ver
 * `supabase/migrations/20260826120000_estoque_geral_avulso.sql` para o porquê.
 *
 * Este módulo é a única fonte dos rótulos e dos slugs de URL, para nome de
 * estoque não ficar espalhado por página, histórico, relatório e etiqueta.
 */
export const ESCOPOS_USOCONSUMO = ["USOCONSUMO", "GERAL"] as const;
export type UsoConsumoEscopo = (typeof ESCOPOS_USOCONSUMO)[number];

/**
 * O escopo de um item é sempre um dos dois. O de uma ENTRADA pode ser `MISTO`:
 * uma NF-e de fornecedor mistura o que quiser, e ela não pode virar duas entradas
 * porque `usoconsumo_entrada_chave_uk` é único por chave globalmente.
 *
 * `MISTO` é resumo de cabeçalho, para filtro e rótulo — quem manda no saldo é
 * sempre o `escopo` do próprio item.
 */
export const ESCOPO_MISTO = "MISTO" as const;
export type EscopoDeEntrada = UsoConsumoEscopo | typeof ESCOPO_MISTO;

/** Aceita os dois escopos de estoque e o `MISTO` de cabeçalho de entrada. */
export function parseEscopoDeEntrada(value: unknown): EscopoDeEntrada {
  const normalized = String(value ?? "").trim().toUpperCase();
  return normalized === ESCOPO_MISTO ? ESCOPO_MISTO : parseEscopo(normalized);
}

/**
 * Resume os escopos das linhas de uma nota em um valor de cabeçalho: um só
 * estoque devolve ele mesmo, dois devolvem `MISTO`.
 */
export function escopoDeEntradaDe(escopos: readonly UsoConsumoEscopo[]): EscopoDeEntrada {
  const distintos = [...new Set(escopos)];
  return distintos.length === 1 ? distintos[0] : ESCOPO_MISTO;
}

/**
 * Uso e consumo é o padrão em toda leitura de parâmetro: o módulo existia antes
 * do escopo, e nenhum cliente que não conheça o parâmetro pode mudar de estoque.
 */
export const ESCOPO_PADRAO: UsoConsumoEscopo = "USOCONSUMO";

type RotuloDeEscopo = {
  /** Nome completo, para título de página e cabeçalho de diálogo. */
  nome: string;
  /** Forma curta, para aba, badge e menu. */
  curto: string;
  /** Como o item é chamado em frase corrida ("O item de uso/consumo foi..."). */
  item: string;
  /** Descricao/categoria padrao do titulo gerado pela entrada. Espelha o rotulo
   *  que a RPC `registrar_entrada_usoconsumo` usa quando o payload nao manda um. */
  compra: string;
  /** Nome de aba de planilha: sem os caracteres que o Excel recusa em sheet name. */
  planilha: string;
  /** Segmento de URL e valor de query dos relatórios/histórico. */
  slug: string;
};

export const ROTULOS_ESCOPO: Record<UsoConsumoEscopo, RotuloDeEscopo> = {
  USOCONSUMO: {
    nome: "Uso e consumo",
    curto: "Uso/Consumo",
    item: "Item de uso/consumo",
    planilha: "Uso e consumo",
    compra: "Compra de material de uso e consumo",
    slug: "uso-consumo",
  },
  GERAL: {
    nome: "Geral/Avulso",
    curto: "Geral",
    item: "Item do estoque geral",
    planilha: "Geral Avulso",
    compra: "Compra de material do estoque geral",
    slug: "geral",
  },
};

export function rotuloDeEscopo(escopo: UsoConsumoEscopo) {
  return ROTULOS_ESCOPO[escopo] ?? ROTULOS_ESCOPO[ESCOPO_PADRAO];
}

/** Aceita o código do escopo; qualquer outra coisa cai no padrão. */
export function parseEscopo(value: unknown): UsoConsumoEscopo {
  const normalized = String(value ?? "").trim().toUpperCase();
  return (ESCOPOS_USOCONSUMO as readonly string[]).includes(normalized)
    ? (normalized as UsoConsumoEscopo)
    : ESCOPO_PADRAO;
}

/** Aceita o slug de URL (`uso-consumo`, `geral`) ou o próprio código. */
export function escopoDoSlug(value: unknown): UsoConsumoEscopo {
  const normalized = String(value ?? "").trim().toLowerCase();
  const encontrado = ESCOPOS_USOCONSUMO.find(
    (escopo) => ROTULOS_ESCOPO[escopo].slug === normalized,
  );
  return encontrado ?? parseEscopo(value);
}

export function slugDoEscopo(escopo: UsoConsumoEscopo) {
  return rotuloDeEscopo(escopo).slug;
}

/**
 * Prefixo do `sourceItemId` da NF-e avulsa para item vindo de estoque simples.
 *
 * `nfe_item.produtoid` tem FK para `produto(id)` e não comporta o id de um item
 * de `usoconsumo_item`, então a origem viaja como texto no `tributacao_snapshot`.
 * `usoconsumo:` é o prefixo histórico e continua significando uso e consumo —
 * notas gravadas antes do estoque geral são todas dele.
 */
export const PREFIXO_ORIGEM_NFE: Record<UsoConsumoEscopo, string> = {
  USOCONSUMO: "usoconsumo",
  GERAL: "geral",
};

/** De qual estoque simples o item da nota veio, ou null se não veio de um. */
export function escopoDaOrigemNfe(sourceItemId: string | null | undefined): UsoConsumoEscopo | null {
  const prefixo = String(sourceItemId ?? "").split(":")[0];
  return (
    ESCOPOS_USOCONSUMO.find((escopo) => PREFIXO_ORIGEM_NFE[escopo] === prefixo) ?? null
  );
}

/**
 * Os TRÊS estoques do ERP, para quando a tela precisa escolher um item de
 * qualquer um deles.
 *
 * `UsoConsumoEscopo` é coluna de banco: vale para `usoconsumo_item.escopo` e é
 * o que a check constraint aceita. `EscopoDeEstoque` é conceito de tela, e
 * acrescenta o estoque de venda, que mora em `produto` e tem rota própria.
 * Os dois tipos são separados de propósito — deixar `PRODUTO` entrar no
 * primeiro faria a API aceitar um escopo que o banco recusa.
 *
 * Mora aqui, e não num módulo novo, porque este arquivo já é a única fonte dos
 * nomes de estoque; espalhar "Produtos"/"Uso e consumo" por mais um lugar é
 * exatamente o que ele existe para evitar.
 */
export const ESCOPO_PRODUTO = "PRODUTO" as const;
export const ESCOPOS_DE_ESTOQUE = [ESCOPO_PRODUTO, ...ESCOPOS_USOCONSUMO] as const;
export type EscopoDeEstoque = (typeof ESCOPOS_DE_ESTOQUE)[number];

export const ROTULOS_ESTOQUE: Record<EscopoDeEstoque, RotuloDeEscopo> = {
  ...ROTULOS_ESCOPO,
  PRODUTO: {
    nome: "Produtos",
    curto: "Produtos",
    item: "produto do estoque de venda",
    planilha: "Produtos",
    compra: "Compra de mercadoria para revenda",
    slug: "produtos",
  },
};

export function rotuloDeEstoque(escopo: EscopoDeEstoque) {
  return ROTULOS_ESTOQUE[escopo] ?? ROTULOS_ESTOQUE[ESCOPO_PADRAO];
}

/** Distingue o que vive em `usoconsumo_item` do que vive em `produto`. */
export function ehEstoqueSimples(valor: unknown): valor is UsoConsumoEscopo {
  return (ESCOPOS_USOCONSUMO as readonly string[]).includes(String(valor ?? ""));
}

/** Aceita os três escopos; qualquer outra coisa cai em uso e consumo. */
export function parseEscopoDeEstoque(valor: unknown): EscopoDeEstoque {
  const normalizado = String(valor ?? "").trim().toUpperCase();
  return (ESCOPOS_DE_ESTOQUE as readonly string[]).includes(normalizado)
    ? (normalizado as EscopoDeEstoque)
    : ESCOPO_PADRAO;
}
