import { NextResponse, type NextRequest } from "next/server";

import { requireEstoqueAccess } from "@/app/api/_authz/perms";
import {
  salvarNFeDeOrigem,
  type NFeOrigemDraftInput,
} from "@/services/fiscal/nfeOrigemService";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, context: Context) {
  try {
    await requireEstoqueAccess();
    const { id } = await context.params;
    const entradaId = Number(id);
    if (!Number.isFinite(entradaId) || entradaId <= 0) {
      return NextResponse.json({ ok: false, message: "ID da entrada inválido." }, { status: 400 });
    }

    const body = (await req.json().catch(() => ({}))) as NFeOrigemDraftInput;
    const result = await salvarNFeDeOrigem("ENTRADA", entradaId, body);
    if (!result.ok) return NextResponse.json(result, { status: 422 });

    return NextResponse.json(
      { ...result, message: "Rascunho de NF-e criado a partir da entrada." },
      { status: 201 },
    );
  } catch (error: any) {
    const status = error?.statusCode === 403 ? 403 : 500;
    return NextResponse.json(
      {
        ok: false,
        message:
          status === 403
            ? "Você não tem permissão para emitir NF-e desta entrada."
            : "Erro ao gerar a NF-e a partir da entrada.",
        detalhe: error?.message ?? String(error),
      },
      { status },
    );
  }
}
