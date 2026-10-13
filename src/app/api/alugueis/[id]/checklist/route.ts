export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAlugueisEdit } from "@/app/api/_authz/perms";
import { ErroAluguel, idDaRota, respostaDeErro, usuarioDaSessao } from "@/lib/alugueis/server";

/**
 * Grava o checklist de saída ou de retorno.
 * Body: { tipo: "SAIDA" | "RETORNO", modeloId?, observacao?, itens: [{ titulo,
 * descricao?, status?, observacao?, modeloItemId? }] }.
 * Devolve { checklist_id, itens: [{ id, titulo }] } para a tela enviar as fotos.
 */
export async function PUT(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAlugueisEdit();
    const usuario = await usuarioDaSessao();
    const id = idDaRota((await context.params).id);
    const body = await req.json().catch(() => ({}));

    const tipo = String(body?.tipo ?? "").toUpperCase();
    if (tipo !== "SAIDA" && tipo !== "RETORNO") throw new ErroAluguel("Tipo de checklist inválido.", 400);
    const itens: any[] = Array.isArray(body?.itens) ? body.itens : [];

    const { data, error } = await supabaseAdmin.rpc("aluguel_salvar_checklist", {
      p_aluguel_id: id,
      p_tipo: tipo,
      p_payload: {
        modelo_id: body?.modeloId ?? null,
        observacao: body?.observacao ?? null,
        itens: itens.map((item, index) => ({
          titulo: item?.titulo,
          descricao: item?.descricao ?? null,
          status: item?.status || null,
          observacao: item?.observacao ?? null,
          modelo_item_id: item?.modeloItemId ?? null,
          ordem: index + 1,
        })),
      },
      p_usuario: usuario,
    });
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) {
    return respostaDeErro(error, "Erro ao salvar checklist.");
  }
}
