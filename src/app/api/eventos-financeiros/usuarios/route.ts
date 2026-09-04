export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

import { requireFinanceirosAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Lista enxuta para o filtro financeiro. Não usa `/api/users`, pois consultar
 * eventos não deve exigir acesso administrativo ao cadastro de usuários.
 * Inativos permanecem disponíveis para a conferência do histórico.
 */
export async function GET() {
  try {
    await requireFinanceirosAccess();

    const { data, error } = await supabaseAdmin
      .from("usuario")
      .select("id, nome, email, ativo")
      .order("ativo", { ascending: false })
      .order("nome", { ascending: true, nullsFirst: false });

    if (error) throw error;

    return NextResponse.json(
      {
        usuarios: (data ?? []).map((usuario: any) => ({
          id: String(usuario.id),
          nome: usuario.nome == null ? null : String(usuario.nome),
          email: usuario.email == null ? null : String(usuario.email),
          ativo: usuario.ativo === true,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: unknown) {
    const causa = error as { statusCode?: number; message?: string };
    const status = Number(causa?.statusCode);
    return NextResponse.json(
      { error: causa?.message ?? "Erro ao listar usuários dos eventos financeiros." },
      { status: status === 401 || status === 403 ? status : 500 },
    );
  }
}
