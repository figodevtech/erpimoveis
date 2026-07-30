import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type MovementAuthor = { id: string; nome: string | null } | null;

/**
 * Resolve o nome dos usuarios autores de movimentacoes de estoque.
 *
 * As colunas `created_by` de entrada/estoque_saida/usoconsumo_entrada/usoconsumo_saida
 * sao uuid soltos, sem FK para `usuario` — entao o PostgREST nao consegue fazer o
 * embed automatico (`criador:created_by(...)` retorna PGRST200). Resolvemos em uma
 * segunda consulta, em lote, para nao criar constraint nova em bancos ja em producao.
 */
export async function carregarAutores(ids: Array<string | null | undefined>) {
  const unicos = Array.from(
    new Set(ids.filter((id): id is string => typeof id === "string" && id.trim() !== "")),
  );
  if (!unicos.length) return new Map<string, MovementAuthor>();

  const { data, error } = await supabaseAdmin
    .from("usuario")
    .select("id, nome, email")
    .in("id", unicos);

  if (error) {
    // Autoria e informativa: se a consulta falhar, a movimentacao ainda deve ser exibida.
    console.error("[carregarAutores] erro ao resolver autores:", error);
    return new Map<string, MovementAuthor>();
  }

  const mapa = new Map<string, MovementAuthor>();
  for (const linha of data ?? []) {
    mapa.set(String(linha.id), {
      id: String(linha.id),
      nome: (linha.nome as string | null) ?? (linha.email as string | null) ?? null,
    });
  }
  return mapa;
}

/** Anexa `{ criador }` a um registro que tenha `created_by`. */
export async function anexarAutor<T extends Record<string, any>>(registro: T) {
  const autores = await carregarAutores([registro?.created_by]);
  return { ...registro, criador: autores.get(String(registro?.created_by ?? "")) ?? null };
}
