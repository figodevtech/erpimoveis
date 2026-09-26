import { NextResponse, type NextRequest } from "next/server";

import { requireEmissaoFiscalAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: Context) {
  try {
    await requireEmissaoFiscalAccess();
    const { id } = await context.params;
    const nfeId = Number(id);
    if (!Number.isInteger(nfeId) || nfeId <= 0) {
      return NextResponse.json({ error: "ID da NF-e inválido." }, { status: 400 });
    }
    const { data, error } = await supabaseAdmin
      .from("nfe")
      .select("status, dados_avulsos")
      .eq("id", nfeId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "NF-e não encontrada." }, { status: 404 });
    if (!["RASCUNHO", "REJEITADA"].includes(String(data.status).toUpperCase())) {
      return NextResponse.json({ error: "Esta NF-e não está editável." }, { status: 409 });
    }
    const snapshot = data.dados_avulsos && typeof data.dados_avulsos === "object" && !Array.isArray(data.dados_avulsos)
      ? data.dados_avulsos as Record<string, unknown>
      : {};
    return NextResponse.json({ pagamentos: snapshot.pagamentos ?? null, cobranca: snapshot.cobranca ?? null });
  } catch (error: any) {
    const status = error?.statusCode === 403 ? 403 : 500;
    return NextResponse.json({ error: status === 403 ? "Sem permissão para ler a NF-e." : "Falha ao ler o pagamento da NF-e." }, { status });
  }
}
