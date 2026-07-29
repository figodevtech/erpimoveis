import { NextRequest, NextResponse } from "next/server";
import { requireUsoConsumoAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { usoConsumoError } from "@/lib/usoconsumo/api";

export async function GET(req: NextRequest) {
  try {
    await requireUsoConsumoAccess();
    const documentoId=Number(req.nextUrl.searchParams.get("documentoId"));
    if(!Number.isInteger(documentoId)||documentoId<=0) return NextResponse.json({error:"Documento fiscal inválido."},{status:400});
    const {data,error}=await supabaseAdmin.from("fiscal_dfe_item_apropriacao").select("numero_item,destino,entrada_id,usoconsumo_entrada_id,quantidade").eq("documento_id",documentoId).is("cancelada_at",null);
    if(error) throw error;
    return NextResponse.json({data:data??[]});
  } catch(error) { return usoConsumoError(error,"Erro ao consultar apropriações fiscais."); }
}

