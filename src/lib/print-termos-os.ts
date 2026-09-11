import { normalizarTermo, type TermoImpressao } from "@/lib/ordens/termos-impressao";
import { TERMOS_OS_PADRAO } from "@/lib/ordens/termos-impressao-padrao";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const TERMOS_SELECT = "id, titulo, intro, itens, status, alvos, ordem";

/**
 * A tabela so existe depois da migration `20260911160000_os_termo_impressao`.
 * Ate la o fallback e o comportamento esperado, nao um defeito — por isso nao
 * vai para o log. O PostgREST responde PGRST205 quando a tabela nao esta no
 * schema cache; 42P01 e o codigo do proprio Postgres.
 */
function tabelaNaoExiste(error: { code?: string } | null) {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

export type TermosImpressaoOS = {
  termos: TermoImpressao[];
  /**
   * true quando a lista veio do codigo, e nao do banco — a tabela ainda nao
   * existe ou a consulta falhou. A tela usa isso para avisar que o cadastro
   * ainda nao esta valendo.
   */
  padrao: boolean;
};

/**
 * Dizeres cadastrados para a impressao da OS.
 *
 * Tabela vazia e um estado legitimo: significa que a oficina apagou todos os
 * blocos e a OS sai sem termo de aceite. So o erro — inclusive a tabela ainda
 * nao existir, entre o deploy do codigo e o da migration — cai nos textos
 * padrao, porque ai o silencio seria um defeito, nao uma escolha.
 */
export async function fetchTermosImpressaoOS(): Promise<TermosImpressaoOS> {
  const { data, error } = await supabaseAdmin
    .from("os_termo_impressao")
    .select(TERMOS_SELECT)
    .order("ordem", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    if (!tabelaNaoExiste(error)) console.error("Erro ao buscar dizeres da OS:", error);
    return { termos: TERMOS_OS_PADRAO, padrao: true };
  }

  const termos = (data ?? [])
    .map((linha, indice) => normalizarTermo(linha, indice + 1))
    .filter((termo): termo is TermoImpressao => termo !== null);

  return { termos, padrao: false };
}
