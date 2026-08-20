import "server-only";

const DEFAULT_PAGE_SIZE = 1000;

type SupabaseRangeQuery = {
  // Os builders do Supabase carregam o tipo exato de cada SELECT no PromiseLike.
  // A paginação só depende do contrato comum abaixo; o chamador define T.
  range(from: number, to: number): PromiseLike<any>;
};

/**
 * O PostgREST limita cada resposta (1.000 linhas neste projeto). Dashboards não
 * podem tratar a primeira página como se fosse o total da base.
 */
export async function fetchAllSupabaseRows<T>(
  createQuery: () => SupabaseRangeQuery,
  pageSize = DEFAULT_PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await createQuery().range(from, from + pageSize - 1);
    if (error) throw error;

    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

export function chunkValues<T>(values: T[], chunkSize = 300): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
}

export async function fetchAllSupabaseRowsByChunks<T, TValue>(
  values: TValue[],
  createQuery: (chunk: TValue[]) => SupabaseRangeQuery,
  chunkSize = 300,
): Promise<T[]> {
  if (values.length === 0) return [];

  const pages = await Promise.all(
    chunkValues(values, chunkSize).map((chunk) =>
      fetchAllSupabaseRows<T>(() => createQuery(chunk)),
    ),
  );

  return pages.flat();
}
