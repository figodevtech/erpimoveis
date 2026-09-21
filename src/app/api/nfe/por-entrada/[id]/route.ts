// Notas fiscais de uma entrada. Delega ao mesmo serviço das demais origens.
//
// A entrada não é agrupável (documenta uma compra e não tem cliente), então
// aqui a união recai sobre a coluna escalar — mas passar pelo serviço mantém o
// mesmo conjunto de colunas e o mesmo `origens[]` que a tela espera.
import { NextResponse, type NextRequest } from "next/server";

import { requireEmissaoFiscalAccess } from "@/app/api/_authz/perms";
import { listarNotasPorOrigem } from "@/services/fiscal/notasPorOrigemService";

export const runtime = "nodejs";

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const entradaId = Number(id);

  if (!Number.isInteger(entradaId) || entradaId <= 0) {
    return NextResponse.json({ ok: false, message: "ID da entrada inválido." }, { status: 400 });
  }

  try {
    await requireEmissaoFiscalAccess();
    const nfes = await listarNotasPorOrigem("ENTRADA", [entradaId]);

    return NextResponse.json(
      { ok: true, entradaId, nfes },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (e: any) {
    const status = e?.statusCode === 403 ? 403 : 500;
    console.error("[GET /api/nfe/por-entrada]", e);
    return NextResponse.json(
      {
        ok: false,
        message:
          status === 403
            ? "Você não tem permissão para consultar notas fiscais."
            : "Erro ao buscar NF-e vinculadas à entrada.",
        error: e?.message ?? String(e),
      },
      { status },
    );
  }
}
