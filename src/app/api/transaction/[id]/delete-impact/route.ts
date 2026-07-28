import { NextResponse } from "next/server";

import { requireFinanceiroDelete } from "@/app/api/_authz/perms";
import { calculateFinancialTotal } from "@/lib/financial-surcharge";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type Params = { params: Promise<{ id: string }> };

const toCents = (value: unknown) => Math.round((Number(value) || 0) * 100);

export async function GET(_: Request, { params }: Params) {
  try {
    await requireFinanceiroDelete();
    const id = Number((await params).id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "ID inválido." }, { status: 400 });
    }

    const { data: transaction, error } = await supabaseAdmin
      .from("transacao")
      .select("id, valor, tipo, ordemservicoid, vendaid, evento_financeiro_id")
      .eq("id", id)
      .eq("is_deleted", false)
      .maybeSingle();
    if (error) throw error;
    if (!transaction) return NextResponse.json({ error: "Transação não encontrada." }, { status: 404 });

    const targets: Array<{ tipo: "OS" | "VENDA"; id: number }> = [];
    const isPagamento = String(transaction.tipo).toUpperCase() === "RECEITA" && transaction.evento_financeiro_id == null;

    if (isPagamento && transaction.ordemservicoid != null) {
      const osId = Number(transaction.ordemservicoid);
      const [{ data: ordem }, { data: pagamentos }] = await Promise.all([
        supabaseAdmin.from("ordemservico").select("orcamentototal,status,acrescimo_financeiro_tipo,acrescimo_financeiro_valor").eq("id", osId).maybeSingle(),
        supabaseAdmin.from("transacao").select("id,valor").eq("ordemservicoid", osId).eq("tipo", "RECEITA").is("evento_financeiro_id", null).eq("is_deleted", false),
      ]);
      const totalDevido = toCents(calculateFinancialTotal(ordem?.orcamentototal, ordem?.acrescimo_financeiro_tipo, ordem?.acrescimo_financeiro_valor));
      const restante = (pagamentos ?? []).filter((item) => Number(item.id) !== id).reduce((sum, item) => sum + toCents(item.valor), 0);
      if (["CONCLUIDO", "FINALIZADA"].includes(String(ordem?.status ?? "").toUpperCase()) && restante < totalDevido) {
        targets.push({ tipo: "OS", id: osId });
      }
    }

    if (isPagamento && transaction.vendaid != null) {
      const vendaId = Number(transaction.vendaid);
      const [{ data: venda }, { data: pagamentos }] = await Promise.all([
        supabaseAdmin.from("venda").select("valortotal,status,acrescimo_financeiro_tipo,acrescimo_financeiro_valor").eq("id", vendaId).maybeSingle(),
        supabaseAdmin.from("transacao").select("id,valor").eq("vendaid", vendaId).eq("tipo", "RECEITA").eq("is_deleted", false),
      ]);
      const totalDevido = toCents(calculateFinancialTotal(venda?.valortotal, venda?.acrescimo_financeiro_tipo, venda?.acrescimo_financeiro_valor));
      const restante = (pagamentos ?? []).filter((item) => Number(item.id) !== id).reduce((sum, item) => sum + toCents(item.valor), 0);
      if (["CONCLUIDO", "FINALIZADA"].includes(String(venda?.status ?? "").toUpperCase()) && restante < totalDevido) {
        targets.push({ tipo: "VENDA", id: vendaId });
      }
    }

    return NextResponse.json({ reabriraPagamento: targets.length > 0, targets });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Erro ao verificar impacto da exclusão." }, { status: 500 });
  }
}
