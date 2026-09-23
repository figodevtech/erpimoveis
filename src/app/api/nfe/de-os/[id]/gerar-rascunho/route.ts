import { NextResponse, type NextRequest } from "next/server";

import { requireOSAccess } from "@/app/api/_authz/perms";
import {
  salvarNFeDeOrigem,
  type NFeOrigemDraftInput,
} from "@/services/fiscal/nfeOrigemService";
import { verificarStatusOSParaEmissao } from "@/lib/nfe/elegibilidadeEmissaoServidor";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, context: Context) {
  try {
    await requireOSAccess();
    const { id } = await context.params;
    const osId = Number(id);
    if (!Number.isFinite(osId) || osId <= 0) {
      return NextResponse.json({ ok: false, message: "ID da OS inválido." }, { status: 400 });
    }

    const body = (await req.json().catch(() => ({}))) as NFeOrigemDraftInput;
    // A trava vale para criar a nota; um rascunho existente continua editável.
    if (!body.nfeId) {
      const statusOk = await verificarStatusOSParaEmissao([
        osId,
        ...(body.origensAdicionais ?? []).map(Number),
      ]);
      if (!statusOk.ok) {
        return NextResponse.json(
          { ok: false, message: statusOk.message, errors: [{ step: "operation", message: statusOk.message }] },
          { status: 422 },
        );
      }
    }
    const result = await salvarNFeDeOrigem("OS", osId, body);
    if (!result.ok) return NextResponse.json(result, { status: 422 });

    return NextResponse.json(
      { ...result, message: "Rascunho de NF-e criado a partir da OS." },
      { status: 201 },
    );
  } catch (error: any) {
    const status = error?.statusCode === 403 ? 403 : 500;
    return NextResponse.json(
      {
        ok: false,
        message:
          status === 403
            ? "Você não tem permissão para emitir NF-e desta OS."
            : "Erro ao gerar a NF-e a partir da OS.",
        detalhe: error?.message ?? String(error),
      },
      { status },
    );
  }
}
