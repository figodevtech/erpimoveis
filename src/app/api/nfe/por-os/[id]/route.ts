// src/app/api/nfe/por-os/[id]/route.ts
//
// Notas fiscais de uma OS. Delega a `listarNotasPorOrigem`, o mesmo serviço da
// listagem em lote, para que a nota consolidada — cuja âncora é outra OS e que
// portanto não aparece em `nfe.ordemservicoid` — também apareça aqui.
import { NextResponse, type NextRequest } from "next/server";

import { requireEmissaoFiscalAccess } from "@/app/api/_authz/perms";
import { listarNotasPorOrigem } from "@/services/fiscal/notasPorOrigemService";

export const runtime = "nodejs";

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const osId = Number(id);

  if (!Number.isFinite(osId) || osId <= 0) {
    return NextResponse.json({ ok: false, message: "ID da OS inválido." }, { status: 400 });
  }

  try {
    await requireEmissaoFiscalAccess();
    const nfes = await listarNotasPorOrigem("OS", [osId]);

    return NextResponse.json(
      { ok: true, osId, nfes },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (e: any) {
    const status = e?.statusCode === 403 ? 403 : 500;
    console.error("[GET /api/nfe/por-os]", e);
    return NextResponse.json(
      {
        ok: false,
        message:
          status === 403
            ? "Você não tem permissão para consultar notas fiscais."
            : "Erro ao buscar NF-e vinculadas à OS.",
        error: e?.message ?? String(e),
      },
      { status },
    );
  }
}
