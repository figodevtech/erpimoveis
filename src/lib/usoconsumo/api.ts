import { NextResponse } from "next/server";
import { ESCOPO_MISTO, escopoDoSlug, type UsoConsumoEscopo } from "./escopo";

export function usoConsumoError(error: unknown, fallback: string) {
  const value = error as { message?: string; code?: string; statusCode?: number };
  const message = value?.message?.trim() || fallback;
  const status = Number.isInteger(value?.statusCode) ? Number(value.statusCode)
    : value?.code === "P0002" ? 404
    : ["23505", "40001", "55000"].includes(value?.code ?? "") ? 409
    : value?.code === "23514" || value?.code === "22023" || value?.code === "42501" ? 400
    : 500;
  return NextResponse.json({ error: message }, { status });
}

// Qual estoque simples a requisicao endereca. Aceita tanto o codigo (GERAL) quanto
// o slug de URL (geral), e cai em uso e consumo quando o parametro nao vem — e o
// que mantem todo chamador anterior ao estoque geral funcionando sem alteracao.
export function escopoDaBusca(params: URLSearchParams) {
  return escopoDoSlug(params.get("escopo"));
}

/**
 * Os escopos de CABEÇALHO que pertencem a um estoque simples. Uma entrada `MISTO`
 * tem item dos dois, então ela aparece nos dois — filtrar por igualdade a esconderia
 * de um deles. Use com `.in("escopo", ...)` em `usoconsumo_entrada` e nas visões de
 * movimento; para item e saída, que têm escopo único, continue com `.eq`.
 */
export function escoposDoCabecalho(escopo: UsoConsumoEscopo) {
  return [escopo, ESCOPO_MISTO];
}

export function normalizeSearch(value: string | null) {
  return String(value ?? "").trim().slice(0, 200).replace(/[%,()]/g, " ");
}

