import { NextResponse, type NextRequest } from "next/server";

import { requireFinanceirosAccess } from "@/app/api/_authz/perms";
import { consultarDfePorChave } from "@/services/fiscal/dfeRecebidasService";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    await requireFinanceirosAccess();

    const body = await req.json().catch(() => ({}));
    const result = await consultarDfePorChave({
      chave: String(body?.chave ?? ""),
      empresaId: body?.empresaId ? Number(body.empresaId) : undefined,
    });

    return NextResponse.json(result, { status: result.success ? 200 : 409 });
  } catch (error: any) {
    const status = error?.statusCode === 403 ? 403 : 500;
    return NextResponse.json(
      {
        success: false,
        error:
          status === 403
            ? "Você não tem permissão para consultar notas fiscais recebidas."
            : "Erro ao consultar documento fiscal recebido pela chave.",
        detail: error?.message ?? String(error),
      },
      { status },
    );
  }
}
