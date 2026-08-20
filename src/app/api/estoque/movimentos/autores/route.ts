export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireEstoqueAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Quem assinou movimento no razao de produtos.
 *
 * Serve so para montar o seletor de usuario do historico. Nao e a lista de
 * usuarios do sistema — essa exige permissao propria e mostraria gente que
 * nunca mexeu no estoque. A visao `estoque_movimento_autor` resolve o distinct
 * no banco; aqui so sobra a ordenacao.
 */
export async function GET() {
  try {
    await requireEstoqueAccess();

    const { data, error } = await supabaseAdmin
      .from("estoque_movimento_autor")
      .select("id, nome")
      .order("nome", { ascending: true });
    if (error) throw error;

    return NextResponse.json({
      autores: (data ?? []).map((autor) => ({
        id: String(autor.id),
        nome: String(autor.nome ?? "").trim() || "Sem nome",
      })),
    });
  } catch (error: any) {
    const message = error?.message ?? "Não foi possível carregar os autores das movimentações.";
    return NextResponse.json({ error: message }, { status: error?.statusCode ?? 500 });
  }
}
