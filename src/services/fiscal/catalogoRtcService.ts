import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { selecionarVersaoCatalogoRtc } from "@/lib/nfe/catalogoRtc";

/** Carrega uma única edição completa do CST e usa a mesma edição no cClassTrib. */
export async function carregarEdicaoCatalogoRtc(dataEmissao: string) {
  const { data, error } = await supabaseAdmin
    .from("fiscal_nfe_cst_ibscbs")
    .select("cst, indicadores, versao_fonte");
  if (error) throw error;
  const linhas = (data ?? []) as Array<{
    cst: string;
    indicadores: Record<string, unknown>;
    versao_fonte: string;
  }>;
  const versao = selecionarVersaoCatalogoRtc(linhas, dataEmissao);
  const csts = linhas.filter((linha) => linha.versao_fonte === versao);
  const cstsPadrao = new Set(csts
    .filter((linha) => Number(linha.indicadores.ind_gIBSCBS) === 1 && Number(linha.indicadores.ind_gDif) === 0)
    .map((linha) => linha.cst));
  return { versao, cstsPadrao };
}
