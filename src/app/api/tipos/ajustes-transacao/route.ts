export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { requireFinanceirosAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Catalogo de tipos de acrescimo e desconto.
 *
 * Somente leitura por aqui: o cadastro e mantido em Configuracoes, e a linha de
 * `codigo_sistema` (Taxa de recebimento) e usada pelo proprio ERP, entao nao
 * pode ser removida.
 */
export async function GET() {
  try {
    await requireFinanceirosAccess();

    const { data, error } = await supabaseAdmin
      .from("tipos_ajuste_transacao")
      .select("id, codigo, nome, descricao, natureza, codigo_sistema")
      .eq("ativo", true)
      // Acrescimo antes de desconto, e dentro de cada grupo em ordem alfabetica:
      // e a ordem em que a tela lista as opcoes.
      .order("natureza", { ascending: true })
      .order("nome", { ascending: true });

    if (error) throw error;
    return NextResponse.json({ data: data ?? [] });
  } catch (error: unknown) {
    const erro = error as { statusCode?: number; message?: string };
    const status = Number(erro?.statusCode);
    return NextResponse.json(
      { error: erro?.message ?? "Não foi possível carregar os tipos de ajuste." },
      { status: status === 401 || status === 403 ? status : 500 },
    );
  }
}
