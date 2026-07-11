import { NextResponse, type NextRequest } from "next/server";

import { requireFinanceirosAccess } from "@/app/api/_authz/perms";
import { consultarStatusDfeRecebida } from "@/services/fiscal/dfeRecebidasService";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ id: string }>;
};

export async function POST(_req: NextRequest, { params }: Context) {
  try {
    await requireFinanceirosAccess();

    const { id } = await params;
    const documentoId = Number(id);
    if (!Number.isFinite(documentoId) || documentoId <= 0) {
      return NextResponse.json({ ok: false, error: "ID inválido." }, { status: 400 });
    }

    const result = await consultarStatusDfeRecebida(documentoId);
    return NextResponse.json(result);
  } catch (error: any) {
    const status = error?.statusCode === 403 ? 403 : 500;
    return NextResponse.json(
      {
        ok: false,
        error:
          status === 403
            ? "Você não tem permissão para consultar notas fiscais recebidas."
            : "Erro ao consultar status da nota fiscal recebida.",
        detail: error?.message ?? String(error),
      },
      { status },
    );
  }
}
