import { NextResponse } from "next/server";
import { requireVendasAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  try {
    await requireVendasAccess();
    // Apenas os campos necessários ao filtro; não exige acesso ao cadastro de usuários.
    const [categorias, vendedores] = await Promise.all([
      supabaseAdmin.from("categoriavenda").select("id, nome").order("nome"),
      supabaseAdmin.from("usuario").select("id, nome").order("nome"),
    ]);
    if (categorias.error) throw categorias.error;
    if (vendedores.error) throw vendedores.error;
    return NextResponse.json({ categorias: categorias.data, vendedores: vendedores.data });
  } catch (error) {
    const status = typeof error === "object" && error !== null && "statusCode" in error ? Number(error.statusCode) : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível carregar os filtros." }, { status });
  }
}
