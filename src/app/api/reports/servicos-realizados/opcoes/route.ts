import { NextResponse } from "next/server";
import { requireRelatoriosAccess } from "@/app/api/_authz/perms";
import { carregarOpcoesServicos } from "@/lib/relatorios/servicos-realizados-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await requireRelatoriosAccess();
    return NextResponse.json(await carregarOpcoesServicos(), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const status = Number((e as { statusCode?: number }).statusCode) || 500;
    console.error("[servicos-realizados/opcoes]", e);
    return NextResponse.json({ error: status === 403 ? "Sem permissão para acessar relatórios." : "Não foi possível carregar as opções." }, { status });
  }
}
