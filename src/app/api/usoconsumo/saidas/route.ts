import { NextRequest, NextResponse } from "next/server";
import { requireUsoConsumoAccess, requireUsoConsumoSaida } from "@/app/api/_authz/perms";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { usoConsumoError } from "@/lib/usoconsumo/api";
import { saidaUsoConsumoSchema, zodMessage } from "@/lib/usoconsumo/schemas";

export async function GET(req: NextRequest) {
  try {
    await requireUsoConsumoAccess();
    const page=Math.max(Number(req.nextUrl.searchParams.get("page"))||1,1); const limit=Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit"))||20,1),100);
    const { data,error,count } = await supabaseAdmin.from("usoconsumo_saida")
      .select("*,centro_custo:centrosdecusto(id,nome),itens:usoconsumo_saida_item(*,item:usoconsumo_item(id,titulo,referencia,unidade))",{count:"exact"})
      .order("created_at",{ascending:false}).range((page-1)*limit,page*limit-1);
    if(error) throw error; const total=count??0;
    return NextResponse.json({data,pagination:{page,limit,total,totalPages:Math.max(1,Math.ceil(total/limit))}});
  } catch (error) { return usoConsumoError(error, "Erro ao listar saídas."); }
}

export async function POST(req: NextRequest) {
  try {
    await requireUsoConsumoSaida();
    const parsed=saidaUsoConsumoSchema.safeParse(await req.json());
    if(!parsed.success) return NextResponse.json({error:zodMessage(parsed.error)},{status:400});
    const session=await auth(); const {itens,...saida}=parsed.data;
    const {data,error}=await supabaseAdmin.rpc("registrar_saida_usoconsumo",{p_saida:{...saida,created_by:(session?.user as {id?:string})?.id??null},p_itens:itens});
    if(error) throw error; return NextResponse.json({data},{status:201});
  } catch (error) { return usoConsumoError(error, "Erro ao registrar saída."); }
}

