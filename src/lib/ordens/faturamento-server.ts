import { supabaseAdmin } from "@/lib/supabaseAdmin";

/** Apenas coluna ausente representa uma instalação anterior à migração. */
export async function buscarFaturamentoOsHabilitado(): Promise<boolean> {
  const { data, error } = await supabaseAdmin.from("config_geral")
    .select("habilitar_faturamento_os").order("id", { ascending: false }).limit(1).maybeSingle();
  if (error) {
    if (error.code === "42703") return false;
    throw error;
  }
  return data?.habilitar_faturamento_os === true;
}
