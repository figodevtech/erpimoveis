import { NextResponse, type NextRequest } from "next/server";

import { requireFinanceirosAccess } from "@/app/api/_authz/perms";
import {
  manifestarDfeRecebida,
  type TipoManifestacaoDestinatario,
} from "@/services/fiscal/dfeRecebidasService";

export const runtime = "nodejs";

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await requireFinanceirosAccess();

    const { id } = await context.params;
    const body = await req.json().catch(() => ({}));
    const result = await manifestarDfeRecebida({
      documentoId: Number(id),
      tipo: String(body?.tipo ?? "") as TipoManifestacaoDestinatario,
      justificativa: body?.justificativa ? String(body.justificativa) : undefined,
    });

    if (!result.success) {
      const message = result.xMotivo
        ? `${result.cStat ? `cStat ${result.cStat}: ` : ""}${result.xMotivo}`
        : "Manifestação rejeitada pela SEFAZ.";

      return NextResponse.json(
        {
          ...result,
          error: message,
          detail: message,
        },
        { status: 409 },
      );
    }

    return NextResponse.json(result);
  } catch (error: any) {
    const status = error?.statusCode === 403 ? 403 : 500;
    return NextResponse.json(
      {
        success: false,
        error:
          status === 403
            ? "Você não tem permissão para manifestar notas fiscais recebidas."
            : "Erro ao enviar manifestação do destinatário.",
        detail: error?.message ?? String(error),
      },
      { status },
    );
  }
}
