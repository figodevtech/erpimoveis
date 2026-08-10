import { NextResponse, type NextRequest } from "next/server";

import { requireVendasAccess } from "@/app/api/_authz/perms";
import { MODELO_NFCE } from "@/lib/nfe/modeloDocumento";
import {
  salvarNFeDeOrigem,
  type NFeOrigemDraftInput,
} from "@/services/fiscal/nfeOrigemService";

export const runtime = "nodejs";

type Context = { params: Promise<{ vendaId: string }> };

/**
 * Rascunho de NFC-e a partir de uma venda.
 *
 * A API recebe o id da venda e as opções fiscais que o operador pode mesmo
 * escolher; tudo que é valor, produto e total vem do banco. Nada de confiar em
 * preço ou imposto enviado pela tela.
 */
export async function POST(req: NextRequest, context: Context) {
  try {
    await requireVendasAccess();
    const { vendaId: rawVendaId } = await context.params;
    const vendaId = Number(rawVendaId);
    if (!Number.isFinite(vendaId) || vendaId <= 0) {
      return NextResponse.json({ ok: false, message: "ID da venda inválido." }, { status: 400 });
    }

    const body = (await req.json().catch(() => ({}))) as NFeOrigemDraftInput;
    const result = await salvarNFeDeOrigem("VENDA", vendaId, body, MODELO_NFCE);
    if (!result.ok) return NextResponse.json(result, { status: 422 });

    return NextResponse.json(
      { ...result, message: "Rascunho de NFC-e criado a partir da venda." },
      { status: 201 },
    );
  } catch (error: any) {
    const status = error?.statusCode === 403 ? 403 : 500;
    return NextResponse.json(
      {
        ok: false,
        message:
          status === 403
            ? "Você não tem permissão para emitir NFC-e desta venda."
            : "Erro ao gerar a NFC-e a partir da venda.",
        detalhe: error?.message ?? String(error),
      },
      { status },
    );
  }
}
