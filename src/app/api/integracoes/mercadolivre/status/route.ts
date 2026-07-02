import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("mercadolivre_account")
      .select("id, empresa_id, ml_user_id, nickname, site_id, scope, expires_at, updated_at")
      .order("updated_at", { ascending: false });

    if (error) throw error;

    return NextResponse.json({ accounts: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    console.error("GET /api/integracoes/mercadolivre/status", e);
    return NextResponse.json({ error: e?.message || "Falha ao consultar Mercado Livre." }, { status: 500 });
  }
}
