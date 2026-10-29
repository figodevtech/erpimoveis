import { criarEventoDaVenda } from "@/lib/financeiro/eventos-documento";
import { modalidadeDeCriacaoVenda } from "@/lib/financeiro/documento-evento";
import { comCriadoPor } from "@/lib/financeiro/eventos-autoria";
import { NextResponse } from "next/server";
import { requireAuthenticated, requireFinanceiroCreate, requireFinanceirosAccess, requireVendasAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchAllSupabaseRows } from "@/lib/supabase-pagination";
import { responder, responderFalha } from "@/lib/financeiro/eventos-financeiros/servico";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuthenticated();
    await requireVendasAccess();
    await requireFinanceirosAccess();
    await requireFinanceiroCreate();
    const id = Number((await params).id);
    if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "ID de venda inválido." }, { status: 400 });
    const body = await request.json().catch(() => null);
    const modalidade = modalidadeDeCriacaoVenda(body);
    if (modalidade === "AVULSO") {
      return responder(await criarEventoDaVenda(id, body, session.user.id), 201);
    }
    if (modalidade !== "DESPESA_FRETE") {
      return NextResponse.json({ error: "Informe a modalidade AVULSO ou DESPESA_FRETE." }, { status: 400 });
    }
    const receitaId = Number(body?.eventoReceitaId);
    const valor = Number(body?.valor);
    const descricao = typeof body?.descricao === "string" ? body.descricao.trim() : "";
    if (body?.natureza !== "DESPESA" || !descricao || !Number.isFinite(valor) || Math.round(valor * 100) <= 0
      || !Number.isSafeInteger(receitaId) || receitaId <= 0) {
      return NextResponse.json({ error: "Informe a receita de frete, o título e um valor positivo para a despesa." }, { status: 400 });
    }
    const { data, error } = await supabaseAdmin.rpc("criar_despesa_frete_venda", {
      p_venda_id: id,
      p_receita_id: receitaId,
      p_descricao: descricao,
      p_detalhe: typeof body?.detalhe === "string" ? body.detalhe.trim() : null,
      p_valor: valor,
      p_usuario: session.user.id,
    });
    if (error) {
      const status = error.code === "P0002" ? 404 : error.code === "22023" ? 400 : error.code === "P0001" ? 409 : 500;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ evento: data }, { status: 201 });
  } catch (error) {
    return responderFalha(error, "Erro ao registrar despesa de frete da venda.");
  }
}

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
      .select("id, ordemservicoid, source_type, source_id, origem, natureza, status, descricao, detalhe, valor, data_evento, competencia_em, produtoid, servicoid, usuarioid, chave_origem, dados_snapshot, is_manual, created_by, pode_gerar_transacao, transacaoid, lancamento_id")
      .eq("source_type", "VENDA").eq("source_id", id).neq("status", "CANCELADO")
      .order("data_evento", { ascending: false }).order("id", { ascending: false }));
    const comissao = Array.isArray(venda.comissao) ? venda.comissao[0] : venda.comissao;
    return NextResponse.json({ eventos: await comCriadoPor(eventos), comissaoHistorica: comissao?.integrada === false }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return responderFalha(error, "Erro ao carregar eventos financeiros da venda.");
  }
}
