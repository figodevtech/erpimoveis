import { NextResponse } from "next/server";
import { requireUsoConsumoAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { usoConsumoError } from "@/lib/usoconsumo/api";

export async function GET(){
  try{
    await requireUsoConsumoAccess();
    const [items,entries,outputs]=await Promise.all([
      supabaseAdmin.from("usoconsumo_item").select("id,estoque,precocompra,status_estoque").eq("ativo",true),
      supabaseAdmin.from("usoconsumo_entrada").select("valor_total,fornecedor:fornecedor(nomerazaosocial)").eq("status","CONFIRMADA"),
      supabaseAdmin.from("usoconsumo_saida").select("motivo,itens:usoconsumo_saida_item(quantidade,valor_custo_aplicado)").eq("status","CONFIRMADA"),
    ]);
    const failure=[items,entries,outputs].find((result)=>result.error)?.error;if(failure)throw failure;
    const stockValue=(items.data??[]).reduce((sum,item)=>sum+Number(item.estoque)*Number(item.precocompra??0),0);
    const byReason=new Map<string,{quantidade:number;valor:number}>();
    for(const output of outputs.data??[]){const current=byReason.get(output.motivo)??{quantidade:0,valor:0};for(const line of output.itens??[]){current.quantidade+=Number(line.quantidade);current.valor+=Number(line.quantidade)*Number(line.valor_custo_aplicado??0);}byReason.set(output.motivo,current);}
    const bySupplier=new Map<string,number>();for(const entry of entries.data??[]){const supplier=Array.isArray(entry.fornecedor)?entry.fornecedor[0]:entry.fornecedor;const name=(supplier as {nomerazaosocial?:string}|null)?.nomerazaosocial??"Sem fornecedor";bySupplier.set(name,(bySupplier.get(name)??0)+Number(entry.valor_total));}
    return NextResponse.json({data:{itens:(items.data??[]).length,valorEstoque:Number(stockValue.toFixed(2)),semEstoque:(items.data??[]).filter((item)=>item.status_estoque==="SEM_ESTOQUE").length,baixoCritico:(items.data??[]).filter((item)=>item.status_estoque==="BAIXO"||item.status_estoque==="CRITICO").length,consumoPorMotivo:Array.from(byReason,([motivo,value])=>({motivo,...value})),comprasPorFornecedor:Array.from(bySupplier,([fornecedor,valor])=>({fornecedor,valor:Number(valor.toFixed(2))})).sort((a,b)=>b.valor-a.valor)}});
  }catch(error){return usoConsumoError(error,"Erro ao gerar relatório.");}
}

