import { NextResponse } from "next/server";
import { requireFinanceirosAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(request: Request) {
  try {
    await requireFinanceirosAccess();
    const osId = Number(new URL(request.url).searchParams.get("osId"));
    if (!Number.isSafeInteger(osId) || osId <= 0) return NextResponse.json({ erro: "OS inválida." }, { status: 400 });
    const { data, error } = await supabaseAdmin.from("pagamento").select("id,status,financeiro_erro")
      .eq("ordemservicoid", osId).eq("financeiro_pendente", true).order("id");
    if (error) throw error;
    return NextResponse.json({ pagamentos: data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    return NextResponse.json({ erro: error?.message || "Erro ao buscar pendências Stone." }, { status: error?.statusCode || 500 });
  }
}
