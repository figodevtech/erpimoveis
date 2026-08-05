import { NextResponse, type NextRequest } from "next/server";

import { requireFinanceirosAccess } from "@/app/api/_authz/perms";
import { liberarNumeroNfe } from "@/services/fiscal/nfeNumeracaoService";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ id: string }>;
};

export async function DELETE(_req: NextRequest, { params }: Context) {
  try {
    await requireFinanceirosAccess();

    const { id } = await params;
    const notaId = Number(id);

    if (!Number.isFinite(notaId) || notaId <= 0) {
      return NextResponse.json({ ok: false, error: "ID inválido." }, { status: 400 });
    }

    const { data: nota, error: notaError } = await supabaseAdmin
      .from("nfe")
      .select("id, status")
      .eq("id", notaId)
      .maybeSingle();

    if (notaError) throw notaError;
    if (!nota) {
      return NextResponse.json({ ok: false, error: "Nota fiscal não encontrada." }, { status: 404 });
    }

    // Rejeitada nunca virou documento na SEFAZ, então também pode ser descartada.
    if (!["RASCUNHO", "REJEITADA"].includes(String(nota.status).toUpperCase())) {
      return NextResponse.json(
        { ok: false, error: "Somente notas em rascunho ou rejeitadas podem ser excluídas." },
        { status: 409 },
      );
    }

    // O número reservado volta para a fila antes de a linha sumir.
    await liberarNumeroNfe(notaId, "Nota excluida");

    const { error: deleteItemsError } = await supabaseAdmin
      .from("nfe_item")
      .delete()
      .eq("nfe_id", notaId);

    if (deleteItemsError) throw deleteItemsError;

    const { error: deleteNotaError } = await supabaseAdmin
      .from("nfe")
      .delete()
      .eq("id", notaId);

    if (deleteNotaError) throw deleteNotaError;

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    const status = error?.statusCode === 403 ? 403 : 500;
    return NextResponse.json(
      {
        ok: false,
        error:
          status === 403
            ? "Você não tem permissão para excluir notas fiscais."
            : "Erro ao excluir nota fiscal.",
        detail: error?.message ?? String(error),
      },
      { status },
    );
  }
}
