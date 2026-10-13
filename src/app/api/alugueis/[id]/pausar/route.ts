export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAlugueisEdit } from "@/app/api/_authz/perms";
import { idDaRota, respostaDeErro, usuarioDaSessao } from "@/lib/alugueis/server";

export async function PUT(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAlugueisEdit();
    const usuario = await usuarioDaSessao();
    const id = idDaRota((await context.params).id);
    const { error } = await supabaseAdmin.rpc("aluguel_pausar", { p_id: id, p_usuario: usuario });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return respostaDeErro(error, "Erro ao pausar aluguel.");
  }
}
