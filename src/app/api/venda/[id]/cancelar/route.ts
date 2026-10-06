import { isSiteSale } from "@/lib/integrations/site-sale-guard";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireVendasEdit } from "@/app/api/_authz/perms";
import { syncPendingMercadoLivreStock } from "@/lib/integrations/mercadolivre-stock-sync";

type Context = { params: Promise<{ id: string }> };

function statusDoErro(error: any) {
  const code = String(error?.code ?? "");
  if (code === "P0002") return 404;
  if (["22023", "23514"].includes(code)) return 409;
  return Number(error?.statusCode) || 500;
}

export async function GET(_req: Request, context: Context) {
  try {
    await requireVendasEdit();
    const vendaId = Number((await context.params).id);
    if (!Number.isInteger(vendaId) || vendaId <= 0) {
      return NextResponse.json({ error: "Venda inválida." }, { status: 400 });
    }

    const [venda, baixas, transacoes, nfes] = await Promise.all([
      supabaseAdmin.from("venda").select("id, status, valortotal").eq("id", vendaId).maybeSingle(),
      supabaseAdmin.from("vendaproduto_baixa").select("produtoid, quantidade").eq("venda_id", vendaId),
      supabaseAdmin.from("transacao").select("id, valor, pendente, tipo, is_deleted, estorno_transacao_id").eq("vendaid", vendaId).eq("is_deleted", false),
      supabaseAdmin.from("nfe").select("id, numero, status").eq("vendaid", vendaId),
    ]);
    if (venda.error) throw venda.error;
    if (!venda.data) return NextResponse.json({ error: "Venda não encontrada." }, { status: 404 });
    if (baixas.error) throw baixas.error;
    if (transacoes.error) throw transacoes.error;
    if (nfes.error) throw nfes.error;

    const originais = (transacoes.data ?? []).filter((item) => item.estorno_transacao_id == null);
    const bloqueioFiscal = (nfes.data ?? []).find(
      (nota) => !["RASCUNHO", "CANCELADA", "REJEITADA"].includes(String(nota.status).toUpperCase()),
    );

    return NextResponse.json({
      venda: venda.data,
      produtos: { itens: baixas.data?.length ?? 0, quantidade: (baixas.data ?? []).reduce((s, i) => s + Number(i.quantidade ?? 0), 0) },
      transacoes: {
        pendentes: originais.filter((item) => item.pendente).length,
        concluidas: originais.filter((item) => !item.pendente).length,
        valorConcluido: originais.filter((item) => !item.pendente).reduce((s, i) => s + Number(i.valor ?? 0), 0),
      },
      nfes: nfes.data ?? [],
      bloqueio: bloqueioFiscal ? `A NF-e ${bloqueioFiscal.numero ?? bloqueioFiscal.id} está ${bloqueioFiscal.status}. Cancele-a antes.` : null,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Erro ao preparar cancelamento." }, { status: statusDoErro(error) });
  }
}

export async function POST(req: Request, context: Context) {
  try {
    await requireVendasEdit();
    const vendaId = Number((await context.params).id);
    if (!Number.isInteger(vendaId) || vendaId <= 0) {
      return NextResponse.json({ error: "Venda inválida." }, { status: 400 });
    }
    if (await isSiteSale(vendaId)) {
      return NextResponse.json({ error: "Cancele o pedido do site pelo Marketplace para confirmar o estorno no Asaas." }, { status: 409 });
    }
    const body = await req.json().catch(() => ({}));
    const motivo = String(body?.motivo ?? "").trim();
    if (motivo.length < 3) {
      return NextResponse.json({ error: "Informe um motivo com pelo menos 3 caracteres." }, { status: 400 });
    }
    const session = await auth();
    const usuarioId = String((session?.user as any)?.id ?? "") || null;
    const { data, error } = await supabaseAdmin.rpc("cancelar_venda", {
      p_venda_id: vendaId,
      p_motivo: motivo,
      p_cancelada_by: usuarioId,
    });
    if (error) throw error;

    const { data: baixas } = await supabaseAdmin.from("vendaproduto_baixa").select("produtoid").eq("venda_id", vendaId);
    const productIds = Array.from(new Set((baixas ?? []).map((item) => Number(item.produtoid)).filter(Number.isFinite)));
    const marketplaceStockSync = await syncPendingMercadoLivreStock({ productIds, limit: productIds.length || 1 }).catch(() => []);

    return NextResponse.json({ message: "Venda cancelada com sucesso.", data, marketplaceStockSync });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Erro ao cancelar venda." }, { status: statusDoErro(error) });
  }
}
