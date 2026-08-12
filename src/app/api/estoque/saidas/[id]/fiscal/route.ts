import { NextResponse, type NextRequest } from "next/server";

import { requireEstoqueAccess, requireEstoqueEdit } from "@/app/api/_authz/perms";
import { auth } from "@/lib/auth";
import {
  buscarContextoFiscalSaida,
  buscarEntradasCandidatasDaSaida,
  buscarOperacoesFiscaisSaida,
  salvarContextoFiscalSaida,
  type SalvarContextoFiscalSaidaInput,
} from "@/services/fiscal/nfeSaidaService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

function parseId(value: string) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(_request: NextRequest, context: Context) {
  try {
    await requireEstoqueAccess();
    const { id: rawId } = await context.params;
    const saidaId = parseId(rawId);
    if (!saidaId) return NextResponse.json({ ok: false, message: "Saída inválida." }, { status: 400 });

    const [dados, entradas, operacoes] = await Promise.all([
      buscarContextoFiscalSaida(saidaId),
      buscarEntradasCandidatasDaSaida(saidaId),
      buscarOperacoesFiscaisSaida(),
    ]);
    return NextResponse.json({
      ok: true,
      ...dados,
      entradasCandidatas: entradas,
      operacoes,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, message: error?.message ?? "Erro ao carregar o contexto fiscal da saída." },
      { status: error?.statusCode === 403 ? 403 : 500 },
    );
  }
}

export async function PUT(request: NextRequest, context: Context) {
  try {
    await requireEstoqueEdit();
    const session = await auth();
    const { id: rawId } = await context.params;
    const saidaId = parseId(rawId);
    if (!saidaId) return NextResponse.json({ ok: false, message: "Saída inválida." }, { status: 400 });
    const input = (await request.json()) as SalvarContextoFiscalSaidaInput;
    const dados = await salvarContextoFiscalSaida(
      saidaId,
      input,
      (session?.user as any)?.id ?? null,
    );
    return NextResponse.json({ ok: true, ...dados });
  } catch (error: any) {
    const forbidden = error?.statusCode === 403;
    return NextResponse.json(
      { ok: false, message: error?.message ?? "Erro ao salvar o contexto fiscal da saída." },
      { status: forbidden ? 403 : 422 },
    );
  }
}
