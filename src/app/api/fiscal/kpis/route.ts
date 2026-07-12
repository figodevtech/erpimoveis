import { NextResponse } from "next/server";

import { requireFinanceirosAccess } from "@/app/api/_authz/perms";
import { buscarFiscalKpisGerais } from "@/services/fiscal/fiscalKpisService";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireFinanceirosAccess();
    const kpis = await buscarFiscalKpisGerais();
    return NextResponse.json({ kpis });
  } catch (error: any) {
    const status = error?.statusCode === 403 ? 403 : 500;
    return NextResponse.json(
      {
        error:
          status === 403
            ? "Você não tem permissão para visualizar KPIs fiscais."
            : "Erro ao carregar KPIs fiscais.",
        detail: error?.message ?? String(error),
      },
      { status },
    );
  }
}
