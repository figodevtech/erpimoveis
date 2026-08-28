import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type OperationalTenant = {
  id: number;
  nomefantasia: string | null;
  razaosocial: string;
};

/**
 * A empresa desta instalação.
 *
 * O projeto adota um banco por instalação e uma empresa ativa por banco — as
 * tabelas históricas de OS, venda, transação e produto não carregam
 * `empresa_id`. É a mesma resolução que `central_operacional_tenant_id()` faz no
 * SQL, e precisa continuar sendo uma só: snapshot e detalhe filtrando por
 * tenants diferentes deixariam o detalhe abrir um evento que o feed não mostra.
 */
export async function resolveOperationalTenant(): Promise<OperationalTenant> {
  const resultado = await supabaseAdmin
    .from("empresa")
    .select("id, nomefantasia, razaosocial")
    .order("id", { ascending: true })
    .limit(1)
    .single();

  if (resultado.error || !resultado.data) {
    throw resultado.error ?? new Error("Empresa não configurada");
  }

  return resultado.data as OperationalTenant;
}
