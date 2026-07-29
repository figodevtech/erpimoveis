import { NextRequest, NextResponse } from "next/server";
import { requireUsoConsumoAccess, requireUsoConsumoEntrada } from "@/app/api/_authz/perms";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { usoConsumoError } from "@/lib/usoconsumo/api";
import { registrarEntradaUsoConsumo } from "@/services/usoconsumo/entradaService";

export async function GET(req: NextRequest) {
  try {
    await requireUsoConsumoAccess();
    const page = Math.max(Number(req.nextUrl.searchParams.get("page")) || 1, 1);
    const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit")) || 20, 1), 100);
    const itemId = Number(req.nextUrl.searchParams.get("itemId"));
    let query = supabaseAdmin.from("usoconsumo_entrada")
      .select("*,fornecedor:fornecedor(id,nomerazaosocial,cpfcnpj),itens:usoconsumo_entrada_item(*,item:usoconsumo_item(id,titulo,referencia,unidade))", { count: "exact" })
      .order("created_at", { ascending: false }).range((page-1)*limit, page*limit-1);
    if (Number.isInteger(itemId) && itemId > 0) query = query.eq("itens.item_id", itemId);
    const { data,error,count } = await query;
    if (error) throw error;
    const total = count ?? 0;
    return NextResponse.json({ data, pagination: { page,limit,total,totalPages: Math.max(1,Math.ceil(total/limit)) } });
  } catch (error) { return usoConsumoError(error, "Erro ao listar entradas."); }
}

export async function POST(req: NextRequest) {
  try {
    await requireUsoConsumoEntrada();
    const session = await auth();
    const data = await registrarEntradaUsoConsumo(await req.json(), (session?.user as { id?: string })?.id ?? null);
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) { return usoConsumoError(error, "Erro ao registrar entrada."); }
}

