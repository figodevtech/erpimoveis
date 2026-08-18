import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Campos de diagnóstico da NFS-e: o JSON que a Focus recebeu e o que ela
 * devolveu. Nenhum dos dois participa da regra de negócio — existem para que
 * uma rejeição opaca possa ser lida depois sem reemitir em produção.
 */
export type NFSeDiagnostico = {
  payload_enviado?: unknown;
  retorno_bruto?: unknown;
};

/**
 * Grava campos da NFS-e levando o diagnóstico de carona.
 *
 * O diagnóstico é carona mesmo: se a coluna ainda não existir — código em
 * produção antes de a migration rodar nos quatro bancos —, regrava só os campos
 * principais em vez de deixar a emissão morrer por causa do log. Devolve o erro
 * da gravação principal, ou null.
 */
export async function atualizarRegistroNFSe(
  registroId: number,
  campos: Record<string, unknown>,
  diagnostico: NFSeDiagnostico = {},
) {
  const extras = Object.fromEntries(
    Object.entries(diagnostico).filter(([, valor]) => valor !== undefined && valor !== null),
  );

  if (Object.keys(extras).length > 0) {
    const { error } = await supabaseAdmin
      .from("nfse")
      .update({ ...campos, ...extras })
      .eq("id", registroId);
    if (!error) return null;
    console.warn("[nfse] Diagnóstico não gravado, seguindo sem ele", error);
  }

  const { error } = await supabaseAdmin.from("nfse").update(campos).eq("id", registroId);
  return error;
}
