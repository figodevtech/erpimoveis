import { NextResponse, type NextRequest } from "next/server";

import { requireEstoqueAccess } from "@/app/api/_authz/perms";
import {
  montarEspelhoFiscalSaida,
  type EspelhoFiscalItemInput,
} from "@/services/fiscal/nfeSaidaService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * Perfil tributário dos itens da saída espelhando a NF-e de entrada.
 *
 * É POST e não GET porque o mapeamento item↔entrada↔nItem é escolhido na tela e
 * muda a cada ajuste; nada é gravado aqui — a persistência acontece só no
 * `gerar-rascunho`.
 */
export async function POST(request: NextRequest, context: Context) {
  try {
    await requireEstoqueAccess();
    const { id: rawId } = await context.params;
    const saidaId = Number(rawId);
    if (!Number.isInteger(saidaId) || saidaId <= 0) {
      return NextResponse.json({ ok: false, message: "Saída inválida." }, { status: 400 });
    }

    const body = (await request.json().catch(() => null)) as
      | {
          itens?: EspelhoFiscalItemInput[];
          ufDestinatario?: string | null;
          operacaoFiscalCodigo?: string | null;
        }
      | null;
    if (!Array.isArray(body?.itens)) {
      return NextResponse.json(
        { ok: false, message: "Informe os itens a espelhar." },
        { status: 400 },
      );
    }

    const itens = await montarEspelhoFiscalSaida(
      saidaId,
      body.itens,
      body.ufDestinatario,
      body.operacaoFiscalCodigo,
    );
    return NextResponse.json({ ok: true, itens });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        message: error?.statusCode === 403
          ? "Você não tem permissão para consultar a origem fiscal desta saída."
          : error?.message ?? "Erro ao espelhar os tributos da NF-e de origem.",
      },
      { status: error?.statusCode === 403 ? 403 : 500 },
    );
  }
}
