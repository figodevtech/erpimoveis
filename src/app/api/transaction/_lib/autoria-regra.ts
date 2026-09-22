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
