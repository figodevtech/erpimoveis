import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * A empresa emitente do banco.
 *
 * O sistema opera com uma empresa só, mas o id dela não é 1 em todo banco — em
 * AlphaGarage é 6. As rotas de configuração fixavam `1` e, nesses bancos, liam e
 * gravavam uma linha inexistente: a tela abria com os padrões vazios e o
 * salvamento voltava 404, enquanto a emissão continuava usando a linha certa
 * (`buscarFiscalConfig` pega a primeira por id). O padrão cadastrado nunca
 * chegava ao motor porque nunca chegava a ser gravado.
 *
 * Regra única, igual à de `GET /api/config/empresa` e à da emissão: a primeira
 * empresa por id.
 */
export type EmpresaAtual = {
  id: number;
  /** CRT: decide entre CSOSN e CST, e se a NFS-e é a Nacional (MEI). */
  regimetributario: string;
  /** IBGE de 7 dígitos: decide o município da NFS-e. */
  codigomunicipio: string;
  /** UF do emitente: define idDest e a alíquota interestadual do DIFAL. */
  uf: string;
};

export async function buscarEmpresaAtual(): Promise<EmpresaAtual | null> {
  const { data, error } = await supabaseAdmin
    .from("empresa")
    .select("id, regimetributario, codigomunicipio, uf")
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    id: Number(data.id),
    regimetributario: String(data.regimetributario ?? ""),
    codigomunicipio: String(data.codigomunicipio ?? ""),
    uf: String(data.uf ?? "").trim().toUpperCase(),
  };
}
