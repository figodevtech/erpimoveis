import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchAllSupabaseRows, fetchAllSupabaseRowsByChunks } from "@/lib/supabase-pagination";
import { contextoDeAutoria, exigirAcessoATransacao, type ContextoDeAutoria } from "./autoria";

type Operacao = "EXCLUIR" | "ESTORNAR" | "REPARCELAR";
type Vinculos = {
  id: number;
  transferencia_id: number | null;
  lancamento_id: number | null;
  pagamento_multiplo_id: number | null;
  eh_adiantamento: boolean;
  ordemservicoid: number | null;
  vendaid: number | null;
  parcelamento_id: number | null;
};

/** Predicados espelham as famílias alteradas pelas RPCs, não a seleção da tela. */
export function familiasAfetadas(linhas: Vinculos[], operacao: Operacao): string[] {
  const familias = new Set<string>();
  for (const linha of linhas) {
    if (operacao === "REPARCELAR") {
      if (linha.ordemservicoid != null) {
        familias.add("and(ordemservicoid.eq." + linha.ordemservicoid + ",tipo.eq.RECEITA,evento_financeiro_id.is.null,is_deleted.eq.false)");
      } else if (linha.vendaid != null) {
        familias.add("and(vendaid.eq." + linha.vendaid + ",tipo.eq.RECEITA,evento_financeiro_id.is.null,is_deleted.eq.false)");
      } else if (linha.parcelamento_id != null) {
        familias.add("and(parcelamento_id.eq." + linha.parcelamento_id + ",is_deleted.eq.false)");
      }
    } else {
      familias.add("baixa_de_transacao_id.eq." + linha.id);
      if (operacao === "EXCLUIR") {
        if (linha.transferencia_id != null) familias.add("transferencia_id.eq." + linha.transferencia_id);
        if (linha.lancamento_id != null) familias.add("lancamento_id.eq." + linha.lancamento_id);
        if (linha.pagamento_multiplo_id != null) familias.add("pagamento_multiplo_id.eq." + linha.pagamento_multiplo_id);
        if (linha.eh_adiantamento) familias.add("adiantamento_id.eq." + linha.id);
      }
    }
  }
  return [...familias];
}

/** Valida o conjunto inteiro antes de uma exclusão/estorno ou reparcelamento. */
export async function exigirAcessoAOperacao(
  ids: number[],
  operacao: Operacao,
  contexto?: ContextoDeAutoria,
): Promise<void> {
  const acesso = contexto ?? await contextoDeAutoria();
  if (acesso.podeVerTudo) return;
  await exigirAcessoATransacao(ids, acesso);
  const visitadas = new Set<number>(ids);
  let pendentes = ids;
  while (pendentes.length) {
    const linhas = await fetchAllSupabaseRowsByChunks<Vinculos, number>(pendentes, (lote) => supabaseAdmin
      .from("transacao")
      .select("id, transferencia_id, lancamento_id, pagamento_multiplo_id, eh_adiantamento, ordemservicoid, vendaid, parcelamento_id")
      .in("id", lote)
      .order("id", { ascending: true }), 100);
    const familias = familiasAfetadas(linhas, operacao);
    const relacionadas = await fetchAllSupabaseRowsByChunks<{ id: number }, string>(familias, (lote) => supabaseAdmin
      .from("transacao")
      .select("id")
      .or(lote.join(","))
      .order("id", { ascending: true }), 30);
    const novas = [...new Set(relacionadas.map((linha) => Number(linha.id)))].filter((id) => !visitadas.has(id));
    await exigirAcessoATransacao(novas, acesso);
    for (const id of novas) visitadas.add(id);
    // Só exclusões seguem cascatas. Reparcelamento e estorno têm uma família.
    pendentes = operacao === "EXCLUIR" ? novas : [];
  }
}

export async function exigirAcessoAPagamentoMultiplo(id: number, contexto?: ContextoDeAutoria): Promise<void> {
  const acesso = contexto ?? await contextoDeAutoria();
  if (acesso.podeVerTudo) return;
  const linhas = await fetchAllSupabaseRows<{ id: number }>(() => supabaseAdmin
    .from("transacao")
    .select("id")
    .eq("pagamento_multiplo_id", id)
    .order("id", { ascending: true }));
  await exigirAcessoAOperacao(linhas.map((linha) => Number(linha.id)), "EXCLUIR", acesso);
}
