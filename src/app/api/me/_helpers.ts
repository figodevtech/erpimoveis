// src/app/api/me/_helpers.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

/**
 * Helpers da Central Pessoal (/meu-perfil).
 *
 * As rotas /api/me/* nao aparecem em ROUTE_PERMS do middleware: qualquer usuario
 * autenticado passa. Isso so e seguro porque elas devolvem exclusivamente dados
 * do proprio usuario, e o id SEMPRE sai da sessao — nunca de um parametro da
 * query. Aceitar um `usuarioId` do cliente transformaria a rota em leitura livre
 * das vendas e ordens de qualquer colega.
 */
export async function getMeUserId(): Promise<string | NextResponse> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;

  if (!userId) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  return String(userId);
}

export function isNextResponse(value: unknown): value is NextResponse {
  return value instanceof NextResponse;
}

/**
 * Status de OS em que o trabalho ja terminou.
 *
 * `PAGAMENTO` conta como finalizada: o servico foi executado e o veiculo
 * liberado, restando apenas a baixa do financeiro. Compartilhado entre a lista
 * e o resumo para os dois nunca divergirem.
 */
export const STATUS_FINALIZADAS = ["CONCLUIDO", "PAGAMENTO"] as const;

export type Periodo = { inicio: string | null; fim: string | null };

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Converte `de`/`ate` (YYYY-MM-DD) nos limites ISO usados nos filtros de data. */
export function parsePeriodo(searchParams: URLSearchParams): Periodo {
  const de = (searchParams.get("de") ?? "").trim();
  const ate = (searchParams.get("ate") ?? "").trim();

  return {
    inicio: DATA_ISO.test(de) ? `${de}T00:00:00.000Z` : null,
    fim: DATA_ISO.test(ate) ? `${ate}T23:59:59.999Z` : null,
  };
}

export type Paginacao = { page: number; limit: number; from: number; to: number };

function inteiroOu(value: string | null, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export function parsePaginacao(searchParams: URLSearchParams): Paginacao {
  const limit = Math.min(Math.max(inteiroOu(searchParams.get("limit"), 20), 1), 100);
  const page = Math.max(inteiroOu(searchParams.get("page"), 1), 1);
  const from = (page - 1) * limit;

  return { page, limit, from, to: from + limit - 1 };
}

export function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function texto(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

export function totalDePaginas(total: number, limit: number): number {
  return Math.max(1, Math.ceil(total / Math.max(limit, 1)));
}

export type RelacaoNomeada = { id: number; nome: string | null };

/**
 * O PostgREST devolve embeds `to-one` ora como objeto, ora como array de um
 * elemento (depende de como a FK e resolvida). Normaliza os dois casos.
 */
export function relacaoNomeada(value: unknown, campoNome = "nome"): RelacaoNomeada | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return null;

  const registro = row as Record<string, unknown>;
  if (registro.id == null) return null;

  return { id: Number(registro.id), nome: texto(registro[campoNome]) };
}

export function comoLista(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
}

export function erroInterno(escopo: string, e: unknown): NextResponse {
  console.error(`[${escopo}]`, e);
  const message = e instanceof Error ? e.message : "Erro ao carregar dados";
  return NextResponse.json({ error: message }, { status: 500 });
}
