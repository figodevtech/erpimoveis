import { NextResponse, type NextRequest } from "next/server";

import { requireEmissaoFiscalAccess } from "@/app/api/_authz/perms";
import { carregarDadosDanfe } from "@/lib/nfe/danfeData";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: Context) {
  try {
    await requireEmissaoFiscalAccess();
    const id = Number((await context.params).id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "ID da NF-e inválido." }, { status: 400 });
    }
    const dados = await carregarDadosDanfe(id);
    if (!dados) return NextResponse.json({ error: "NF-e não encontrada." }, { status: 404 });
    return NextResponse.json({ view: dados.view });
  } catch (error: any) {
    const status = error?.statusCode === 403 ? 403 : 500;
    return NextResponse.json({ error: status === 403 ? "Sem permissão para visualizar a NF-e." : "Falha ao carregar o DANFE." }, { status });
  }
}
