export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { requireFinanceiroEdit } from "@/app/api/_authz/perms";
import {
  parsePositiveId,
  removeAttachmentObjects,
} from "@/app/api/transaction/_lib/anexos";
import { respostaSeEdicaoBloqueada } from "@/app/api/transaction/_lib/edicao";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type Params = { params: Promise<{ id: string; anexoId: string }> };

function errorResponse(error: unknown) {
  const known = error as { message?: string; statusCode?: number };
  const status = Number(known?.statusCode);
  return NextResponse.json(
    { error: known?.message ?? "Erro ao remover anexo da transação." },
    { status: [400, 401, 403, 404, 409].includes(status) ? status : 500 },
  );
}

export async function DELETE(_request: NextRequest, ctx: Params) {
  try {
    await requireFinanceiroEdit();
    const bloqueio = await respostaSeEdicaoBloqueada();
    if (bloqueio) return bloqueio;

    const params = await ctx.params;
    const transacaoId = parsePositiveId(params.id, "ID da transação");
    const anexoId = parsePositiveId(params.anexoId, "ID do anexo");

    const { data: transacao, error: transactionError } = await supabaseAdmin
      .from("transacao")
      .select("id")
      .eq("id", transacaoId)
      .eq("is_deleted", false)
      .maybeSingle();
    if (transactionError) throw transactionError;
    if (!transacao) {
      return NextResponse.json({ error: "Transação não encontrada." }, { status: 404 });
    }

    const { data: anexo, error: selectError } = await supabaseAdmin
      .from("transacao_anexo")
      .select("id, path")
      .eq("id", anexoId)
      .eq("transacao_id", transacaoId)
      .maybeSingle();
    if (selectError) throw selectError;
    if (!anexo) {
      return NextResponse.json({ error: "Anexo não encontrado." }, { status: 404 });
    }

    const { error: deleteError } = await supabaseAdmin
      .from("transacao_anexo")
      .delete()
      .eq("id", anexoId)
      .eq("transacao_id", transacaoId);
    if (deleteError) throw deleteError;

    try {
      await removeAttachmentObjects([anexo.path]);
    } catch (storageError) {
      // O anexo já saiu do ERP e o bucket é privado. Não devolvemos uma falha
      // falsa ao usuário; o log permite reconciliar o objeto órfão depois.
      console.warn("Falha ao limpar objeto de anexo da transação", storageError);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/transaction/[id]/anexos/[anexoId]", error);
    return errorResponse(error);
  }
}
