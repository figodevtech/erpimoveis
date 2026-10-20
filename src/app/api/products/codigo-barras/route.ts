// src/app/api/products/codigo-barras/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireEstoqueAccess } from "@/app/api/_authz/perms";
import { variantesGtin } from "@/lib/gtin";

/**
 * GET /api/products/codigo-barras?codigo=7891234567895&excluir=123
 * Lista os produtos ativos que ja usam o codigo de barras. `excluir` tira o
 * proprio produto da busca quando ele esta sendo editado.
 */
export async function GET(req: NextRequest) {
  try {
    await requireEstoqueAccess();

    const codigo = (req.nextUrl.searchParams.get("codigo") ?? "").replace(/\D/g, "");
    const excluir = Number(req.nextUrl.searchParams.get("excluir"));

    if (codigo.length < 8) {
      return NextResponse.json({ produtos: [] }, { headers: { "Cache-Control": "no-store" } });
    }

    let query = supabaseAdmin
      .from("produto")
      .select("id, titulo, referencia")
      .eq("is_deleted", false)
      .in("codigobarras", variantesGtin(codigo))
      .order("id", { ascending: true })
      .limit(5);

    if (Number.isInteger(excluir) && excluir > 0) query = query.neq("id", excluir);

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ produtos: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Erro ao verificar o código de barras." },
      { status: e?.statusCode ?? 500 },
    );
  }
}
