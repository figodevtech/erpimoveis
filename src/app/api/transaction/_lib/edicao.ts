import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Devolve a resposta de erro quando a edicao de transacoes esta desligada em
 * Configuracoes > Geral, ou `null` quando esta liberada.
 */
export async function respostaSeEdicaoBloqueada(): Promise<NextResponse | null> {
  const { data: config, error } = await supabaseAdmin
    .from("config_geral")
    .select("habilitar_edicao_transacoes")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "A configuração de edição de transações ainda não foi aplicada." },
      { status: 409 },
    );
  }

  if (config?.habilitar_edicao_transacoes !== true) {
    return NextResponse.json(
      { error: "A edição de transações está desativada nas configurações gerais." },
      { status: 403 },
    );
  }

  return null;
}
