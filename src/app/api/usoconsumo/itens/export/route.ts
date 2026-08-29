export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireUsoConsumoAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { escopoDaBusca, normalizeSearch, usoConsumoError } from "@/lib/usoconsumo/api";
import { rotuloDeEscopo, slugDoEscopo } from "@/lib/usoconsumo/escopo";

export async function GET(req: NextRequest) {
  try {
    await requireUsoConsumoAccess();
    const escopo=escopoDaBusca(req.nextUrl.searchParams);
    const search=normalizeSearch(req.nextUrl.searchParams.get("search"));
    const status=req.nextUrl.searchParams.get("status")?.toUpperCase();
    const grupoId=Number(req.nextUrl.searchParams.get("grupoId"));
    let query=supabaseAdmin.from("usoconsumo_item").select("id,titulo,descricao,referencia,fabricante,unidade,estoque,estoqueminimo,status_estoque,precocompra,ultimovalordecompra,codigobarras,etiqueta,local,ncm,cest,cfop_entrada,created_at,grupo:usoconsumo_grupo(nome)").eq("ativo",true).eq("escopo",escopo).order("titulo");
    if(search) query=query.or([`titulo.ilike.%${search}%`,`descricao.ilike.%${search}%`,`referencia.ilike.%${search}%`,`fabricante.ilike.%${search}%`,`codigobarras.ilike.%${search}%`,`etiqueta.ilike.%${search}%`].join(","));
    if(status&&["OK","BAIXO","CRITICO","SEM_ESTOQUE"].includes(status)) query=query.eq("status_estoque",status);
    if(Number.isInteger(grupoId)&&grupoId>0) query=query.eq("grupo_id",grupoId);
    const {data,error}=await query.limit(10000); if(error) throw error;
    const rows=(data??[]).map((item:any)=>({
      ID:item.id,Título:item.titulo,Descrição:item.descricao,Referência:item.referencia,Fabricante:item.fabricante,
      Grupo:Array.isArray(item.grupo)?item.grupo[0]?.nome:item.grupo?.nome,Unidade:item.unidade,Estoque:item.estoque,
      "Estoque mínimo":item.estoqueminimo,Status:item.status_estoque,"Custo médio":item.precocompra,
      "Último custo":item.ultimovalordecompra,"Código de barras":item.codigobarras,Etiqueta:item.etiqueta,
      Local:item.local,NCM:item.ncm,CEST:item.cest,"CFOP entrada":item.cfop_entrada,"Criado em":item.created_at,
    }));
    const workbook=XLSX.utils.book_new(); const worksheet=XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook,worksheet,rotuloDeEscopo(escopo).planilha);
    const buffer=XLSX.write(workbook,{type:"buffer",bookType:"xlsx",cellDates:true});
    return new NextResponse(buffer,{headers:{"Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","Content-Disposition":`attachment; filename="estoque_${slugDoEscopo(escopo)}_${new Date().toISOString().slice(0,10)}.xlsx"`,"Cache-Control":"no-store"}});
  } catch(error) { return usoConsumoError(error,"Erro ao exportar itens."); }
}
