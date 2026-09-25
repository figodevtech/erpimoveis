export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { PERMS, requirePerm, requireVendasEdit } from "@/app/api/_authz/perms";

/** Opcoes do seletor de vendedor, sem expor os dados de /api/users. */
export async function GET() {
  try {
    await requireVendasEdit();
    await requirePerm(PERMS.VENDAS_ALTERAR_VENDEDOR);

    const { data, error } = await supabaseAdmin
      .from("usuario")
      .select("id, nome")
      .eq("ativo", true)
      .order("nome", { ascending: true });
    if (error) throw error;

    return NextResponse.json(
      { users: data ?? [] },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: any) {
    const status = Number(error?.statusCode);
    if (status !== 401 && status !== 403) {
      console.error("Erro ao listar vendedores da venda:", error);
    }
    return NextResponse.json(
      { error: error?.message || "Erro ao listar vendedores." },
      { status: status === 401 || status === 403 ? status : 500 },
    );
  }
}
