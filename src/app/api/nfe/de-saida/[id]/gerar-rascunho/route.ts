import { NextResponse, type NextRequest } from "next/server";

import { requireEstoqueAccess } from "@/app/api/_authz/perms";
import { salvarNFeDaSaida, type NFeSaidaDraftInput } from "@/services/fiscal/nfeSaidaService";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    await requireEstoqueAccess();
    const { id: rawId } = await context.params;
    const saidaId = Number(rawId);
    if (!Number.isInteger(saidaId) || saidaId <= 0) {
      return NextResponse.json({ ok: false, message: "Saída inválida." }, { status: 400 });
    }
    const input = (await request.json()) as NFeSaidaDraftInput;
    const result = await salvarNFeDaSaida(saidaId, input);
    if (!result.ok) return NextResponse.json(result, { status: 422 });
    return NextResponse.json(
      { ...result, message: "Rascunho de NF-e criado a partir da saída." },
      { status: 201 },
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        message: error?.statusCode === 403
          ? "Você não tem permissão para emitir NF-e desta saída."
          : "Erro ao gerar a NF-e a partir da saída.",
        detalhe: error?.message ?? String(error),
      },
      { status: error?.statusCode === 403 ? 403 : 500 },
    );
  }
}
