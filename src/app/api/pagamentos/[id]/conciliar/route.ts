import { NextResponse } from "next/server";
import { requireFinanceiroEdit } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function PUT(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFinanceiroEdit();
    const id = Number((await params).id);
    if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ erro: "ID inválido." }, { status: 400 });
    const { error } = await supabaseAdmin.rpc("conciliar_financeiro_stone_os", { p_pagamento_id: id });
    if (error) throw error;
    const result = await supabaseAdmin.from("pagamento").select("financeiro_pendente,financeiro_erro").eq("id", id).single();
    if (result.error) throw result.error;
    return NextResponse.json(result.data, { status: result.data.financeiro_pendente ? 409 : 200 });
  } catch (error: any) {
    return NextResponse.json({ erro: error?.message || "Erro ao conciliar pagamento." }, { status: error?.statusCode || (error?.code === "P0002" ? 404 : 500) });
  }
}
