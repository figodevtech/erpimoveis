import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolverServicosNFSe, type SelecaoServicosNFSe } from "@/lib/services/fiscais/nfse-selecao";

export async function carregarSelecaoNFSe(selecao: SelecaoServicosNFSe) {
  const { data, error } = await supabaseAdmin
    .from("ordemservico")
    .select("*, cliente (*), osservico (*, servico (*))")
    .in("id", selecao.osIds);
  if (error) throw error;
  return resolverServicosNFSe(selecao, data ?? []);
}
