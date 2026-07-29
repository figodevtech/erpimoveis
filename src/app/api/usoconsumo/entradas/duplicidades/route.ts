import { NextRequest, NextResponse } from "next/server";
import { requireUsoConsumoAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { usoConsumoError } from "@/lib/usoconsumo/api";

export async function GET(req: NextRequest) {
  try {
    await requireUsoConsumoAccess();
    const chaveNfe = String(req.nextUrl.searchParams.get("chaveNfe") ?? "").replace(/\D/g, "");
    if (chaveNfe.length !== 44) return NextResponse.json({ error: "Chave de NF-e inválida." }, { status: 400 });

    const { data, error } = await supabaseAdmin
      .from("usoconsumo_entrada")
      .select("id,created_at,itens:usoconsumo_entrada_item(item_id,numero_item_fiscal,quantidade)")
      .eq("chave_nfe", chaveNfe)
      .eq("status", "CONFIRMADA")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ data: data ?? [] });
  } catch (error) {
    return usoConsumoError(error, "Erro ao verificar duplicidade da NF-e.");
  }
}
