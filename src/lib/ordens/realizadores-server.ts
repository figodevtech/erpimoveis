import { supabaseAdmin } from "@/lib/supabaseAdmin";

import {
  servicosSemRealizador,
  type ServicoSemRealizador,
} from "./realizadores";

/**
 * Serviços da OS que ainda não têm nenhum realizador.
 *
 * `escopo` limita a checagem a esses `servicoid` (usado ao salvar o orçamento,
 * onde só os serviços recém-incluídos precisam de realizador na hora).
 */
export async function buscarServicosSemRealizador(
  osId: number,
  escopo?: readonly number[] | null,
): Promise<ServicoSemRealizador[]> {
  // Escopo vazio é diferente de escopo ausente: nada a checar.
  if (escopo && escopo.length === 0) return [];

  const [servicosRes, vinculosRes] = await Promise.all([
    supabaseAdmin
      .from("osservico")
      .select("servicoid, descricao, servico:servicoid ( descricao )")
      .eq("ordemservicoid", osId),
    supabaseAdmin
      .from("osservico_realizador")
      .select("servicoid")
      .eq("ordemservicoid", osId),
  ]);

  if (servicosRes.error) throw servicosRes.error;
  if (vinculosRes.error) throw vinculosRes.error;

  const servicos = (servicosRes.data ?? []).map((row: any) => ({
    servicoid: Number(row.servicoid),
    // A descrição do cadastro identifica melhor o serviço do que a observação
    // digitada na linha do orçamento; esta entra só como reserva.
    descricao: String(row.servico?.descricao ?? "").trim() || String(row.descricao ?? "").trim() || null,
  }));

  return servicosSemRealizador(servicos, vinculosRes.data ?? [], escopo);
}
