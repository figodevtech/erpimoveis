import { NextResponse, type NextRequest } from "next/server";

import { requireFinanceirosAccess } from "@/app/api/_authz/perms";
import {
  buscarNFeAvulsaDraft,
  salvarNFeAvulsaDraft,
} from "@/services/fiscal/nfeAvulsaService";
import { liberarNumeroNfe } from "@/services/fiscal/nfeNumeracaoService";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type Context = { params: Promise<{ draftId: string }> };

function parseDraftId(value: string) {
  const id = Number(value);
  return Number.isFinite(id) ? id : null;
}

export async function GET(_req: NextRequest, context: Context) {
  try {
    await requireFinanceirosAccess();
    const { draftId } = await context.params;
    const id = parseDraftId(draftId);

    if (id === null) {
      return NextResponse.json({ error: "ID de rascunho inválido." }, { status: 400 });
    }

    const draft = await buscarNFeAvulsaDraft(id);
    if (!draft) {
      return NextResponse.json({ error: "Rascunho não encontrado." }, { status: 404 });
    }

    return NextResponse.json(draft);
  } catch (error: any) {
    const status = error?.statusCode === 403 ? 403 : error?.statusCode === 422 ? 422 : 500;
    return NextResponse.json(
      {
        error:
          status === 403
            ? "Você não tem permissão para visualizar rascunhos de NF-e."
            : status === 422
              ? // Regra de negócio: a mensagem do serviço já explica o que fazer.
                error?.message
              : "Erro ao buscar rascunho de NF-e avulsa.",
        detail: error?.message ?? String(error),
      },
      { status },
    );
  }
}

export async function PATCH(req: NextRequest, context: Context) {
  try {
    await requireFinanceirosAccess();
    const { draftId } = await context.params;
    const id = parseDraftId(draftId);

    if (id === null) {
      return NextResponse.json({ ok: false, error: "ID de rascunho inválido." }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const result = await salvarNFeAvulsaDraft({ ...body, nfeId: id });

    if (!result.ok) {
      return NextResponse.json(result, { status: 422 });
    }

    return NextResponse.json(result);
  } catch (error: any) {
    const status = error?.statusCode === 403 ? 403 : 500;
    return NextResponse.json(
      {
        ok: false,
        error:
          status === 403
            ? "Você não tem permissão para editar rascunhos de NF-e."
            : "Erro ao atualizar rascunho de NF-e avulsa.",
        detail: error?.message ?? String(error),
      },
      { status },
    );
  }
}

export async function DELETE(_req: NextRequest, context: Context) {
  try {
    await requireFinanceirosAccess();
    const { draftId } = await context.params;
    const id = parseDraftId(draftId);

    if (id === null) {
      return NextResponse.json({ ok: false, error: "ID de rascunho inválido." }, { status: 400 });
    }

    const { data: nfe, error: nfeError } = await supabaseAdmin
      .from("nfe")
      .select("status")
      .eq("id", id)
      .maybeSingle();

    if (nfeError) throw nfeError;
    if (!nfe) {
      return NextResponse.json({ ok: false, error: "Rascunho não encontrado." }, { status: 404 });
    }
    if (!["RASCUNHO", "REJEITADA"].includes(String(nfe.status).toUpperCase())) {
      return NextResponse.json(
        { ok: false, error: "Somente rascunhos ou notas rejeitadas podem ser descartados." },
        { status: 409 },
      );
    }

    // O número reservado volta para a fila antes de a linha sumir.
    await liberarNumeroNfe(id, "Rascunho descartado");

    const { error: deleteError } = await supabaseAdmin.from("nfe").delete().eq("id", id);
    if (deleteError) throw deleteError;

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    const status = error?.statusCode === 403 ? 403 : 500;
    return NextResponse.json(
      {
        ok: false,
        error:
          status === 403
            ? "Você não tem permissão para descartar rascunhos de NF-e."
            : "Erro ao descartar rascunho de NF-e avulsa.",
        detail: error?.message ?? String(error),
      },
      { status },
    );
  }
}
