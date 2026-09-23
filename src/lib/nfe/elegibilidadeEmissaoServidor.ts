// Trava de status da OS nas rotas que criam nota a partir dela.
//
// A tela já esconde a emissão fora dos status escolhidos em Configurações
// Gerais, mas a rota é chamável direto. Aqui a mesma regra de
// `elegibilidadeEmissao.ts` é aplicada no servidor, lendo a config do banco.

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { rotuloStatusOS } from "@/lib/ordens/destaque";
import { normalizarStatusEmissaoOS } from "@/lib/nfe/elegibilidadeEmissao";

async function buscarStatusPermitidos() {
  const completo = await supabaseAdmin
    .from("config_geral")
    .select("emissao_nf_status_os, emissao_nf_ordens_nao_pagas")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!completo.error) {
    return normalizarStatusEmissaoOS(completo.data?.emissao_nf_status_os, completo.data?.emissao_nf_ordens_nao_pagas);
  }
  if (completo.error.code !== "42703") throw completo.error;

  // Banco sem a migration da lista: vale o switch antigo.
  const legado = await supabaseAdmin
    .from("config_geral")
    .select("emissao_nf_ordens_nao_pagas")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (legado.error) throw legado.error;
  return normalizarStatusEmissaoOS(null, legado.data?.emissao_nf_ordens_nao_pagas);
}

/**
 * Confere se todas as OS estão num status que libera a emissão. Na emissão
 * agrupada vale para cada OS do grupo, não só para a âncora.
 */
export async function verificarStatusOSParaEmissao(
  osIds: number[],
): Promise<{ ok: true } | { ok: false; message: string }> {
  const ids = [...new Set(osIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (ids.length === 0) return { ok: true };

  const permitidos = await buscarStatusPermitidos();
  const { data, error } = await supabaseAdmin
    .from("ordemservico")
    .select("id, status")
    .in("id", ids);
  if (error) throw error;

  const statusPorId = new Map((data ?? []).map((os: any) => [Number(os.id), String(os.status ?? "").toUpperCase()]));
  for (const id of ids) {
    const status = statusPorId.get(id);
    // OS inexistente fica para a validação de cada rota, que já responde 404.
    if (status === undefined) continue;
    if (!(permitidos as string[]).includes(status)) {
      return {
        ok: false,
        message:
          `A OS #${id} está em ${rotuloStatusOS(status)}, e a configuração só permite emitir nota nos status: ` +
          `${permitidos.map(rotuloStatusOS).join(", ")}.`,
      };
    }
  }
  return { ok: true };
}
