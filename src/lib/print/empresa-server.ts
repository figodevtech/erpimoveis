// src/lib/print/empresa-server.ts
import { supabaseAdmin } from "@/lib/supabaseAdmin";

import { COLUNAS_EMPRESA_IMPRESSAO, identificacaoDaEmpresa, type CadastroEmpresa } from "./empresa";

/**
 * Empresa para o cabeçalho das folhas. Uma falha de leitura não derruba o
 * relatório: a folha sai sem a identificação, e o erro fica no log.
 */
export async function fetchEmpresaDaImpressao() {
  const { data, error } = await supabaseAdmin
    .from("empresa")
    .select(COLUNAS_EMPRESA_IMPRESSAO)
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Erro ao buscar a empresa para impressão:", error);
    return null;
  }

  return identificacaoDaEmpresa(data as CadastroEmpresa | null);
}
