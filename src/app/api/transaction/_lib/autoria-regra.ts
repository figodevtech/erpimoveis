/**
 * A regra do recorte por autoria, sem nada em volta.
 *
 * Separada de `autoria.ts` porque aquele modulo carrega sessao e Supabase no
 * topo: a regra em si e uma decisao pura, e e ela que precisa de teste.
 */

export type RecorteDeAutoria = {
  /** `true` quando a consulta precisa se limitar ao que e desta pessoa. */
  restrito: boolean;
  usuarioId: string | null;
};

/**
 * Quem ve o que.
 *
 * Sem `financeiro:ver_todas_transacoes` o recorte e forcado e o `apenasMinhas`
 * que veio do cliente nem e consultado — quem nao pode ver tudo nao ganha uma
 * chave para desligar o proprio limite. Com a permissao, o recorte so existe se
 * a pessoa pediu por ele.
 */
export function decidirRecorte(
  podeVerTudo: boolean,
  apenasMinhas: boolean,
  usuarioId: string | null,
): RecorteDeAutoria {
  const restrito = !podeVerTudo || apenasMinhas;
  return restrito ? { restrito: true, usuarioId } : { restrito: false, usuarioId: null };
}

/**
 * A expressao do `or()` do PostgREST.
 *
 * `created_by IS NULL` entra junto de proposito: a coluna so passou a ser
 * gravada em todos os caminhos agora, e sem esse ramo o historico inteiro
 * sumiria da tela de todo mundo no dia em que a permissao foi criada. As linhas
 * do webhook da maquineta tambem caem aqui, e ficam visiveis para sempre — nao
 * ha sessao numa chamada de maquina para carimbar autor nenhum.
 */
export function expressaoDeAutoria(usuarioId: string | null): string {
  // Sessao sem id nao deveria chegar aqui (o `require*` roda antes), mas se
  // chegar o recorte fecha para o que nao tem dono em vez de abrir tudo.
  return usuarioId ? `created_by.eq.${usuarioId},created_by.is.null` : "created_by.is.null";
}

/** Documento a que um pagamento pertence: o que a tela de cada um lista. */
export type DocumentoDoPagamento = "OS" | "VENDA";

/** O que pesa para decidir o acesso a uma transacao pelo id. */
export type AcessoPorId = {
  podeVerTudo: boolean;
  usuarioId: string | null;
  createdBy: string | null;
  /** OS e vendas a que aponta, direto ou pelo rateio de um pagamento multiplo. */
  documentos: DocumentoDoPagamento[];
  /** A quais desses modulos a pessoa tem acesso. */
  acessoA: Record<DocumentoDoPagamento, boolean>;
};

/**
 * Alterar exige ser o dono — ou nao haver dono, ou poder ver tudo.
 *
 * Editar, excluir e dar baixa sao as acoes que este recorte existe para travar.
 */
export function podeAlterarTransacao(a: Pick<AcessoPorId, "podeVerTudo" | "usuarioId" | "createdBy">): boolean {
  if (a.podeVerTudo || a.createdBy == null) return true;
  return a.createdBy === a.usuarioId;
}

/**
 * Ler vai alem de alterar num caso so: o pagamento de uma OS ou de uma venda,
 * para quem abre aquele modulo. As telas da OS e de pagamento de vendas ja
 * listam todos eles, de proposito — travar a abertura so trocava a linha
 * visivel por um 403 no clique.
 */
export function podeLerTransacao(a: AcessoPorId): boolean {
  if (podeAlterarTransacao(a)) return true;
  return a.documentos.some((documento) => a.acessoA[documento]);
}

/** Le `apenasMinhas` aceitando as formas que o axios e o fetch produzem. */
export function leApenasMinhas(valor: string | null): boolean {
  const texto = String(valor ?? "").trim().toLowerCase();
  return texto === "1" || texto === "true";
}

/**
 * Aplica o recorte a uma consulta do PostgREST.
 *
 * Chamadas `.or()` empilham em AND, entao isto convive com o `or` da busca
 * textual sem que um anule o outro.
 */
export function aplicarRecorteDeAutoria<T>(query: T, recorte: RecorteDeAutoria): T {
  if (!recorte.restrito) return query;
  return (query as { or: (v: string) => T }).or(expressaoDeAutoria(recorte.usuarioId));
}
