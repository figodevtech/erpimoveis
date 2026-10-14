import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * A empresa que emitiu a nota, para consultar, cancelar e reenviar com o token
 * e o ambiente DELA.
 *
 * Com `empresaid` gravado, é ela e pronto. Nota antiga sem o campo só cai na
 * empresa do banco quando existe exatamente uma: com duas, escolher a primeira
 * por id poderia mandar a nota de um CNPJ com o token de outro.
 */
export async function carregarEmpresaDaNota(
  empresaid: unknown,
  colunas: string,
): Promise<{ data: Record<string, any> | null; error: { message: string } | null }> {
  const id = Number(empresaid);
  if (Number.isInteger(id) && id > 0) {
    const { data, error } = await supabaseAdmin.from("empresa").select(colunas).eq("id", id).maybeSingle();
    return { data: (data as Record<string, any> | null) ?? null, error: error ?? null };
  }

  const { data, error } = await supabaseAdmin
    .from("empresa")
    .select(colunas)
    .order("id", { ascending: true })
    .limit(2);
  if (error) return { data: null, error };
  const linhas = (data ?? []) as unknown as Record<string, any>[];
  if (linhas.length > 1) {
    return {
      data: null,
      error: { message: "Esta NFS-e não guarda a empresa emitente e o banco tem mais de uma empresa: não é possível saber qual token usar." },
    };
  }
  return { data: linhas[0] ?? null, error: null };
}
