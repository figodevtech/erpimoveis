import "server-only";

import {
  carregarFatiasRateadas,
  fatiaComoTransacao,
  type TipoDocumentoRateio,
} from "@/lib/financeiro/rateio-documentos";
import { fetchAllSupabaseRowsByChunks } from "@/lib/supabase-pagination";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { RecebimentoDoDocumento } from "./recebimentos-de-documentos";

const COLUNA_DO_DOCUMENTO: Record<TipoDocumentoRateio, "ordemservicoid" | "vendaid"> = {
  OS: "ordemservicoid",
  VENDA: "vendaid",
};

/**
 * Os recebimentos de cada documento: o mesmo recorte do saldo da OS e da venda
 * — receita, não excluída e não gerada por evento —, mais as fatias dos
 * pagamentos em grupo, que não apontam para o documento.
 *
 * Entram todos, de qualquer data: o período do relatório escolhe os
 * documentos, não os pagamentos.
 */
export async function carregarRecebimentosPorDocumento(tipo: TipoDocumentoRateio, ids: number[]) {
  const porDocumento = new Map<number, RecebimentoDoDocumento[]>();
  if (!ids.length) return porDocumento;

  const coluna = COLUNA_DO_DOCUMENTO[tipo];
  const [diretos, fatias] = await Promise.all([
    fetchAllSupabaseRowsByChunks<RecebimentoDoDocumento & Record<string, unknown>, number>(ids, (chunk) =>
      supabaseAdmin
        .from("transacao")
        .select(`id, ${coluna}, data, vencimento_em, metodopagamento, tipo, valor, valor_acrescimos, valor_baixado, pendente, evento_financeiro_id`)
        .in(coluna, chunk)
        .eq("tipo", "RECEITA")
        .eq("is_deleted", false)
        .is("evento_financeiro_id", null)
        .order(coluna, { ascending: true })
        .order("data", { ascending: true })
        .order("id", { ascending: true }),
    ),
    carregarFatiasRateadas(tipo, ids),
  ]);

  const acrescentar = (documentoId: number, recebimento: RecebimentoDoDocumento) => {
    if (!Number.isFinite(documentoId)) return;
    const atual = porDocumento.get(documentoId) ?? [];
    atual.push(recebimento);
    porDocumento.set(documentoId, atual);
  };

  for (const linha of diretos) acrescentar(Number(linha[coluna]), linha);
  for (const fatia of [...fatias.values()].flat()) acrescentar(fatia.documentoId, fatiaComoTransacao(fatia));

  return porDocumento;
}
