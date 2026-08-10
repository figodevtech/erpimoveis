import { NextResponse, type NextRequest } from "next/server";

import { requireEmissaoFiscalAccess } from "@/app/api/_authz/perms";
import { emitirNfceEmContingencia } from "@/services/fiscal/nfceContingenciaService";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

/**
 * Emite a NFC-e em contingência offline.
 *
 * Chamada pelo operador, e só depois de uma falha de comunicação comprovada —
 * a tela só oferece a ação quando a tentativa de transmissão indicou que o lote
 * não chegou à SEFAZ. Rejeição fiscal nunca leva a este caminho.
 *
 * O documento é assinado e guardado; a transmissão vem depois, pela rota de
 * autorização, com o mesmo número e a mesma data de emissão.
 */
export async function POST(_req: NextRequest, context: Context) {
  try {
    await requireEmissaoFiscalAccess();

    const { id } = await context.params;
    const nfeId = Number(id);
    if (!Number.isFinite(nfeId) || nfeId <= 0) {
      return NextResponse.json({ ok: false, message: "ID da NFC-e inválido." }, { status: 400 });
    }

    const resultado = await emitirNfceEmContingencia(nfeId);
    if (!resultado.ok) {
      return NextResponse.json(resultado, { status: 422 });
    }

    return NextResponse.json({
      ...resultado,
      message:
        "NFC-e emitida em contingência. Imprima o cupom e transmita assim que a conexão voltar " +
        "— o prazo é de 24 horas.",
    });
  } catch (error: any) {
    const status = error?.statusCode === 403 ? 403 : 500;
    return NextResponse.json(
      {
        ok: false,
        message:
          status === 403
            ? "Você não tem permissão para emitir em contingência."
            : "Erro ao emitir a NFC-e em contingência.",
        detalhe: error?.message ?? String(error),
      },
      { status },
    );
  }
}
