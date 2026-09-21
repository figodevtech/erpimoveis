// Notas fiscais de uma venda. Delega ao mesmo serviço da listagem em lote,
// para que a nota consolidada ancorada em outra venda também apareça aqui.
import { NextResponse, type NextRequest } from "next/server";

import { requireEmissaoFiscalAccess } from "@/app/api/_authz/perms";
import { listarNotasPorOrigem } from "@/services/fiscal/notasPorOrigemService";

export const runtime = "nodejs";

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const vendaId = Number(id);

  if (!Number.isFinite(vendaId) || vendaId <= 0) {
    return NextResponse.json({ ok: false, message: "ID da venda inválido." }, { status: 400 });
  }

  try {
    await requireEmissaoFiscalAccess();
    const nfes = await listarNotasPorOrigem("VENDA", [vendaId]);

    return NextResponse.json(
      { ok: true, vendaId, nfes },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (e: any) {
    const status = e?.statusCode === 403 ? 403 : 500;
    console.error("[GET /api/nfe/por-venda]", e);
    return NextResponse.json(
      {
        ok: false,
        message:
          status === 403
            ? "Você não tem permissão para consultar notas fiscais."
            : "Erro ao buscar NF-e vinculadas à venda.",
        error: e?.message ?? String(e),
      },
      { status },
    );
  }
}
