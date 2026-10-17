import { SpedServiceError } from "./errors";

type Row = Record<string, any>;

export type SpedPageResult<T> = PromiseLike<{
  data: T[] | null;
  error: { message?: string; code?: string } | null;
  count?: number | null;
}>;

/** Teto do PostgREST no Supabase (`max_rows`). Páginas maiores são truncadas em silêncio. */
export const SPED_PAGE_SIZE = 1000;
/** `.in()` vai na URL: listas grandes estouram o limite do gateway antes do banco responder. */
export const SPED_IN_CHUNK_SIZE = 200;

export type SpedCollectionReport = {
  label: string;
  rows: number;
  expected: number | null;
  pages: number;
};

function rowKey(row: Row, keyOf?: (row: Row) => string): string | null {
  if (keyOf) return keyOf(row);
  return row?.id == null ? null : String(row.id);
}

/**
 * Lê uma consulta inteira em páginas fixas. A fábrica recebe o intervalo e deve
 * ordenar por uma chave única (normalmente `id`) — sem ordem estável, páginas
 * vizinhas podem repetir ou pular linhas.
 *
 * A primeira página deve pedir `count: "exact"`. Se a soma das páginas não bater
 * com a contagem, ou uma chave repetir, a coleta é recusada: um SPED sem um
 * documento elegível parece válido e não é.
 */
export async function fetchAllPages<T extends Row>(
  label: string,
  page: (range: { from: number; to: number }) => SpedPageResult<T>,
  options: { pageSize?: number; keyOf?: (row: T) => string; maxPages?: number } = {},
): Promise<{ rows: T[]; report: SpedCollectionReport }> {
  const pageSize = options.pageSize ?? SPED_PAGE_SIZE;
  const maxPages = options.maxPages ?? 10_000;
  const rows: T[] = [];
  const seen = new Set<string>();
  let expected: number | null = null;
  let pages = 0;

  for (let from = 0; pages < maxPages; from += pageSize) {
    const result = await page({ from, to: from + pageSize - 1 });
    pages += 1;
    if (result.error) {
      throw new SpedServiceError(
        `Falha ao ler ${label}: ${result.error.message ?? "erro desconhecido"}`,
        500,
        result.error.code || "COLETA_FALHOU",
      );
    }
    if (pages === 1 && typeof result.count === "number") expected = result.count;
    const data = result.data ?? [];
    for (const row of data) {
      const key = rowKey(row, options.keyOf as ((row: Row) => string) | undefined);
      if (key != null) {
        if (seen.has(key)) {
          throw new SpedServiceError(
            `A leitura de ${label} retornou a linha ${key} em duas páginas. A coleta foi interrompida para não duplicar documentos.`,
            409,
            "COLETA_DUPLICADA",
          );
        }
        seen.add(key);
      }
      rows.push(row);
    }
    if (data.length < pageSize) break;
    if (expected != null && rows.length >= expected) break;
  }

  if (pages >= maxPages) {
    throw new SpedServiceError(`A leitura de ${label} excedeu ${maxPages} páginas.`, 500, "COLETA_INCOMPLETA");
  }
  if (expected != null && rows.length !== expected) {
    throw new SpedServiceError(
      `A leitura de ${label} trouxe ${rows.length} linha(s), mas a fonte informa ${expected}. Tente novamente; o SPED não é gerado com coleta incompleta.`,
      409,
      "COLETA_INCOMPLETA",
    );
  }
  return { rows, report: { label, rows: rows.length, expected, pages } };
}

export function chunk<T>(values: readonly T[], size = SPED_IN_CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

/** `.in()` em lotes, cada lote paginado. O resultado mantém a ordem dos lotes. */
export async function fetchAllByIds<T extends Row, K>(
  label: string,
  ids: readonly K[],
  page: (ids: K[], range: { from: number; to: number }) => SpedPageResult<T>,
  options: { chunkSize?: number; pageSize?: number; keyOf?: (row: T) => string } = {},
): Promise<{ rows: T[]; report: SpedCollectionReport }> {
  const unique = Array.from(new Set(ids));
  const rows: T[] = [];
  const seen = new Set<string>();
  let expected = 0;
  let pages = 0;
  for (const part of chunk(unique, options.chunkSize)) {
    const result = await fetchAllPages(label, (range) => page(part, range), options);
    pages += result.report.pages;
    expected += result.report.expected ?? result.report.rows;
    for (const row of result.rows) {
      const key = rowKey(row, options.keyOf as ((row: Row) => string) | undefined);
      if (key != null) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      rows.push(row);
    }
  }
  return { rows, report: { label, rows: rows.length, expected, pages } };
}
