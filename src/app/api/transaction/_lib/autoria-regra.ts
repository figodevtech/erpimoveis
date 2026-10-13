/** Regra de visibilidade do caixa, independente de sessão e banco. */
export type RecorteDeAutoria =
  | { modo: "TODAS"; restrito: false; usuarioId: null }
  | { modo: "MINHAS"; restrito: true; usuarioId: string | null }
  | { modo: "COMPARTILHADAS"; restrito: true; usuarioId: string | null; autoresAdministrativos: ReadonlySet<string> };

/** O filtro opcional nunca pode desligar a separação do caixa administrativo. */
export function decidirRecorte(
  podeVerTudo: boolean,
  apenasMinhas: boolean,
  usuarioId: string | null,
  autoresAdministrativos: ReadonlySet<string>,
): RecorteDeAutoria {
  if (!podeVerTudo) return { modo: "COMPARTILHADAS", restrito: true, usuarioId, autoresAdministrativos };
  if (apenasMinhas) return { modo: "MINHAS", restrito: true, usuarioId };
  return { modo: "TODAS", restrito: false, usuarioId: null };
}

/** Sem autor continua compartilhado, inclusive no filtro opcional de próprias. */
export function expressaoDeAutoria(recorte: RecorteDeAutoria): string | null {
  if (recorte.modo === "TODAS") return null;
  // Uma sessão sem identificador nunca amplia a consulta.
  if (!recorte.usuarioId) return "created_by.is.null";
  if (recorte.modo === "MINHAS") return "created_by.eq." + recorte.usuarioId + ",created_by.is.null";
  const autores = [...recorte.autoresAdministrativos];
  return autores.length ? "created_by.is.null,created_by.not.in.(" + autores.join(",") + ")" : null;
}

export type DocumentoDoPagamento = "OS" | "VENDA";

export type AcessoPorId = {
  podeVerTudo: boolean;
  createdBy: string | null;
  autoresAdministrativos: ReadonlySet<string>;
  documentos: DocumentoDoPagamento[];
  acessoA: Record<DocumentoDoPagamento, boolean>;
};

/** As permissões de editar, excluir e baixar são verificadas separadamente. */
export function podeAlterarTransacao(
  a: Pick<AcessoPorId, "podeVerTudo" | "createdBy" | "autoresAdministrativos">,
): boolean {
  return a.podeVerTudo || a.createdBy == null || !a.autoresAdministrativos.has(a.createdBy);
}

/** Preserva a leitura de pagamentos administrativos dentro de OS e vendas. */
export function podeLerTransacao(a: AcessoPorId): boolean {
  return podeAlterarTransacao(a) || a.documentos.some((documento) => a.acessoA[documento]);
}

export function leApenasMinhas(valor: string | null): boolean {
  const texto = String(valor ?? "").trim().toLowerCase();
  return texto === "1" || texto === "true";
}

/** Os ORs da busca e da visibilidade se somam em AND no PostgREST. */
export function aplicarRecorteDeAutoria<T>(query: T, recorte: RecorteDeAutoria): T {
  const expressao = expressaoDeAutoria(recorte);
  return expressao ? (query as { or: (v: string) => T }).or(expressao) : query;
}
