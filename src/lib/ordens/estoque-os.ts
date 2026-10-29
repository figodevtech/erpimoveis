import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type ModoBaixaEstoqueOS = "ORCAMENTO" | "EXECUCAO";

export async function buscarModoBaixaEstoqueOS(): Promise<ModoBaixaEstoqueOS> {
  const { data, error } = await supabaseAdmin
    .from("config_geral")
    .select("modo_baixa_estoque_os")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (error.code === "42703") return "ORCAMENTO";
    throw error;
  }

  return data?.modo_baixa_estoque_os === "EXECUCAO" ? "EXECUCAO" : "ORCAMENTO";
}
