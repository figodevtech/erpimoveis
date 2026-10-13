export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAlugueisAccess, requireAlugueisDelete, requireAlugueisEdit } from "@/app/api/_authz/perms";
import {
  ErroAluguel,
  SELECT_DETALHE_ALUGUEL,
  idDaRota,
  respostaDeErro,
  usuarioDaSessao,
} from "@/lib/alugueis/server";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    await requireAlugueisAccess();
    const id = idDaRota((await context.params).id);

    const { data, error } = await supabaseAdmin
      .from("aluguel")
      .select(SELECT_DETALHE_ALUGUEL)
      .eq("id", id)
      .eq("is_deleted", false)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new ErroAluguel("Aluguel não encontrado.", 404);

    // Itens na ordem em que entraram; linha do tempo do mais recente para trás.
    const aluguel = data as any;
    aluguel.itens = [...(aluguel.itens ?? [])].sort((a: any, b: any) => a.id - b.id);
    aluguel.eventos = [...(aluguel.eventos ?? [])].sort(
      (a: any, b: any) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id,
    );
    return NextResponse.json(aluguel);
  } catch (error) {
    return respostaDeErro(error, "Erro ao carregar aluguel.");
  }
}

export async function PUT(req: NextRequest, context: RouteContext) {
  try {
    await requireAlugueisEdit();
    const usuario = await usuarioDaSessao();
    const id = idDaRota((await context.params).id);
    const body = await req.json().catch(() => ({}));

    const { error } = await supabaseAdmin.rpc("aluguel_salvar", {
      p_payload: { ...(body ?? {}), id },
      p_usuario: usuario,
    });
    if (error) throw error;
    return NextResponse.json({ id });
  } catch (error) {
    return respostaDeErro(error, "Erro ao salvar aluguel.");
  }
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    await requireAlugueisDelete();
    const usuario = await usuarioDaSessao();
    const id = idDaRota((await context.params).id);
    const body = await req.json().catch(() => ({}));
    const motivo = String(body?.motivo ?? req.nextUrl.searchParams.get("motivo") ?? "").trim();
    if (!motivo) throw new ErroAluguel("Informe o motivo da exclusão.", 400);

    const { error } = await supabaseAdmin.rpc("aluguel_excluir", {
      p_id: id,
      p_motivo: motivo,
      p_usuario: usuario,
    });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return respostaDeErro(error, "Erro ao excluir aluguel.");
  }
}
