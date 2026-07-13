import { NextResponse } from "next/server";
import { requireVendasAccess } from "@/app/api/_authz/perms";
import { errorStatus, requireEmpresaId } from "@/lib/empresa-context";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireVendasAccess();
    const empresaId = await requireEmpresaId();
    const { data, error } = await supabaseAdmin
      .from("mercadolivre_account")
      .select("id, empresa_id, ml_user_id, nickname, site_id, scope, expires_at, updated_at")
      .eq("empresa_id", empresaId)
      .order("updated_at", { ascending: false });

    if (error) throw error;

    return NextResponse.json({ accounts: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    console.error("GET /api/integracoes/mercadolivre/status", e);
    return NextResponse.json({ error: e?.message || "Falha ao consultar Mercado Livre." }, { status: errorStatus(e) });
  }
}
