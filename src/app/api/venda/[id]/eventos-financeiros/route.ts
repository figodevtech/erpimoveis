import { NextResponse } from "next/server";
import { requireAuthenticated, requireFinanceirosAccess, requireVendasAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchAllSupabaseRows } from "@/lib/supabase-pagination";
import { responderFalha } from "@/app/api/ordens/[id]/eventos-financeiros/_lib/servico";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuthenticated();
    await requireVendasAccess();
    await requireFinanceirosAccess();
    const id = Number((await params).id);
    if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "ID de venda inválido." }, { status: 400 });

    const { data: venda, error } = await supabaseAdmin.from("venda")
      .select("id, status, comissao:venda_comissao(integrada)").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!venda) return NextResponse.json({ error: "Venda não encontrada." }, { status: 404 });

    const eventos = await fetchAllSupabaseRows<any>(() => supabaseAdmin.from("eventos_financeiros")
      .select("id, ordemservicoid, source_type, source_id, origem, natureza, status, descricao, detalhe, valor, data_evento, competencia_em, produtoid, servicoid, usuarioid, chave_origem, dados_snapshot, is_manual, pode_gerar_transacao, transacaoid, lancamento_id")
      .eq("source_type", "VENDA").eq("source_id", id).neq("status", "CANCELADO")
      .order("data_evento", { ascending: false }).order("id", { ascending: false }));
    const comissao = Array.isArray(venda.comissao) ? venda.comissao[0] : venda.comissao;
    return NextResponse.json({ eventos, comissaoHistorica: comissao?.integrada === false }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return responderFalha(error, "Erro ao carregar eventos financeiros da venda.");
  }
}
