export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { requireFinanceiroEdit } from "@/app/api/_authz/perms";
import {
  attachmentPrefix,
  ensureAttachmentSlot,
  ensureAttachmentTransaction,
  isSupportedAttachment,
  MAX_TRANSACAO_ANEXO_SIZE,
  parsePositiveId,
  TRANSACAO_ANEXOS_BUCKET,
} from "@/app/api/transaction/_lib/anexos";
import { respostaSeEdicaoBloqueada } from "@/app/api/transaction/_lib/edicao";
import { emitirEnvioDireto, lerArquivoDeclarado } from "@/lib/anexos/envio-direto";

type Params = { params: Promise<{ id: string }> };

/** Etapa 1 do envio direto: valida e devolve a URL assinada de upload. */
export async function POST(request: NextRequest, ctx: Params) {
  try {
    await requireFinanceiroEdit();
    const bloqueio = await respostaSeEdicaoBloqueada();
    if (bloqueio) return bloqueio;

    const { id: rawId } = await ctx.params;
    const id = parsePositiveId(rawId, "ID da transação");
    await ensureAttachmentTransaction(id, "alterar");
    await ensureAttachmentSlot(id);

    const arquivo = lerArquivoDeclarado(await request.json().catch(() => null));
    if (arquivo.tamanho > MAX_TRANSACAO_ANEXO_SIZE) {
      return NextResponse.json({ error: "Arquivo muito grande. Máximo: 10 MB." }, { status: 413 });
    }
    if (!isSupportedAttachment({ type: arquivo.tipo })) {
      return NextResponse.json(
        { error: "Tipo de arquivo inválido. Envie JPG, PNG, WebP ou PDF." },
        { status: 415 },
      );
    }

    return NextResponse.json(
      await emitirEnvioDireto(TRANSACAO_ANEXOS_BUCKET, attachmentPrefix(id), arquivo),
    );
  } catch (error) {
    console.error("POST /api/transaction/[id]/anexos/envio", error);
    const known = error as { message?: string; statusCode?: number };
    const status = Number(known?.statusCode);
    return NextResponse.json(
      { error: known?.message ?? "Erro ao preparar o envio do anexo." },
      { status: [400, 401, 403, 404, 409, 413, 415].includes(status) ? status : 500 },
    );
  }
}
