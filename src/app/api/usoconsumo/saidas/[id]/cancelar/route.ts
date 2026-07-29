import { NextResponse } from "next/server";
import { requireUsoConsumoCancelar } from "@/app/api/_authz/perms";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { usoConsumoError } from "@/lib/usoconsumo/api";

export async function POST(_req: Request,{params}:{params:Promise<{id:string}>}) {
  try {
    await requireUsoConsumoCancelar(); const id=Number((await params).id);
    if(!Number.isInteger(id)||id<=0) return NextResponse.json({error:"Saída inválida."},{status:400});
    const session=await auth(); const {data,error}=await supabaseAdmin.rpc("cancelar_saida_usoconsumo",{p_saida_id:id,p_cancelada_by:(session?.user as {id?:string})?.id??null});
    if(error) throw error; return NextResponse.json({data});
  } catch(error) { return usoConsumoError(error,"Erro ao cancelar saída."); }
}

