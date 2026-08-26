export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUsoConsumoAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { escopoDaBusca, escoposDoCabecalho, usoConsumoError } from "@/lib/usoconsumo/api";

/**
 * Quem assinou entrada ou saida de uso e consumo. Mesmo papel da rota irma em
 * `/api/estoque/movimentos/autores`: alimentar o seletor de usuario do
 * historico sem expor a lista de usuarios do sistema.
 */
export async function GET(req: NextRequest) {
  try {
    await requireUsoConsumoAccess();

    const { data, error } = await supabaseAdmin
      .from("usoconsumo_movimento_autor")
      .select("id, nome")
      .in("escopo", escoposDoCabecalho(escopoDaBusca(req.nextUrl.searchParams)))
      .order("nome", { ascending: true });
    if (error) throw error;

    return NextResponse.json({
      autores: (data ?? []).map((autor) => ({
        id: String(autor.id),
        nome: String(autor.nome ?? "").trim() || "Sem nome",
      })),
    });
  } catch (error) {
    return usoConsumoError(error, "Erro ao listar os autores do histórico de uso e consumo.");
  }
}
