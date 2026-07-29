import { NextRequest, NextResponse } from "next/server";
import { requireEstoqueAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: NextRequest) {
  try {
    await requireEstoqueAccess();
    const documentoId = Number(req.nextUrl.searchParams.get("documentoId"));
    if (!Number.isInteger(documentoId) || documentoId <= 0) {
      return NextResponse.json({ error: "Documento fiscal inválido." }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("fiscal_dfe_item_apropriacao")
      .select("numero_item,destino,entrada_id,usoconsumo_entrada_id,quantidade")
      .eq("documento_id", documentoId)
      .is("cancelada_at", null);
    if (error) throw error;

    return NextResponse.json({ data: data ?? [] });
  } catch (error: any) {
    const status = error?.statusCode === 401 || error?.statusCode === 403 ? error.statusCode : 500;
    return NextResponse.json(
      { error: status === 500 ? "Erro ao consultar apropriações fiscais." : error.message },
      { status },
    );
  }
}
