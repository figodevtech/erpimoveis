import { NextResponse } from "next/server";

import { requireFinanceiroDelete } from "@/app/api/_authz/perms";
import { valorDeFace } from "@/lib/financeiro/transacao";
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
      .select("id, valor, valor_acrescimos, tipo, ordemservicoid, vendaid, evento_financeiro_id, adiantamento_id, eh_adiantamento")
      .eq("id", id)
      .eq("is_deleted", false)
      .maybeSingle();
    if (error) throw error;
    if (!transaction) return NextResponse.json({ error: "Transação não encontrada." }, { status: 404 });

    /*
     * Adiantamento: as duas pontas travam a exclusão, e por motivos diferentes.
     *
     * A antecipação não sai porque as parcelas apontam para ela (FK RESTRICT) —
     * sem ela, elas ficariam pagas por um dinheiro que não existe mais. E uma
     * parcela não sai porque o bruto da antecipação é a soma dos líquidos delas:
     * tirar uma faria o lançamento cobrir valor que ninguém deve.
     *
     * O caminho é desfazer a antecipação inteira, que ainda não existe como
     * operação. Melhor recusar com o motivo explícito do que deixar passar e
     * quebrar a conta.
     */
    let adiantamento: { bloqueado: true; motivo: string; quantidade?: number } | null = null;

    if (transaction.eh_adiantamento) {
      const { count } = await supabaseAdmin
        .from("transacao")
        .select("id", { count: "exact", head: true })
        .eq("adiantamento_id", id)
        .eq("is_deleted", false);

      if ((count ?? 0) > 0) {
        adiantamento = {
          bloqueado: true,
          quantidade: count ?? 0,
          motivo: `Este lançamento liquidou ${count} título(s) por antecipação. Excluí-lo deixaria esses títulos pagos por um dinheiro que não existe mais.`,
        };
      }
    } else if (transaction.adiantamento_id != null) {
      adiantamento = {
        bloqueado: true,
        motivo: `Este título foi liquidado pela antecipação #${transaction.adiantamento_id}. Removê-lo faria a antecipação cobrir um valor que ninguém deve.`,
      };
    }

    const targets: Array<{ tipo: "OS" | "VENDA"; id: number }> = [];
    const isPagamento = String(transaction.tipo).toUpperCase() === "RECEITA" && transaction.evento_financeiro_id == null;

    if (isPagamento && transaction.ordemservicoid != null) {
      const osId = Number(transaction.ordemservicoid);
      const [{ data: ordem }, { data: pagamentos }] = await Promise.all([
        supabaseAdmin.from("ordemservico").select("orcamentototal,status,acrescimo_financeiro_tipo,acrescimo_financeiro_valor").eq("id", osId).maybeSingle(),
        supabaseAdmin.from("transacao").select("id,valor,valor_acrescimos").eq("ordemservicoid", osId).eq("tipo", "RECEITA").is("evento_financeiro_id", null).eq("is_deleted", false),
      ]);
      const totalDevido = toCents(calculateFinancialTotal(ordem?.orcamentototal, ordem?.acrescimo_financeiro_tipo, ordem?.acrescimo_financeiro_valor));
      const restante = (pagamentos ?? []).filter((item) => Number(item.id) !== id).reduce((sum, item) => sum + toCents(valorDeFace(item)), 0);
      if (["CONCLUIDO", "FINALIZADA"].includes(String(ordem?.status ?? "").toUpperCase()) && restante < totalDevido) {
        targets.push({ tipo: "OS", id: osId });
      }
    }

    if (isPagamento && transaction.vendaid != null) {
      const vendaId = Number(transaction.vendaid);
      const [{ data: venda }, { data: pagamentos }] = await Promise.all([
        supabaseAdmin.from("venda").select("valortotal,status,acrescimo_financeiro_tipo,acrescimo_financeiro_valor").eq("id", vendaId).maybeSingle(),
        supabaseAdmin.from("transacao").select("id,valor,valor_acrescimos").eq("vendaid", vendaId).eq("tipo", "RECEITA").eq("is_deleted", false),
      ]);
      const totalDevido = toCents(calculateFinancialTotal(venda?.valortotal, venda?.acrescimo_financeiro_tipo, venda?.acrescimo_financeiro_valor));
      const restante = (pagamentos ?? []).filter((item) => Number(item.id) !== id).reduce((sum, item) => sum + toCents(valorDeFace(item)), 0);
      if (["CONCLUIDO", "FINALIZADA"].includes(String(venda?.status ?? "").toUpperCase()) && restante < totalDevido) {
        targets.push({ tipo: "VENDA", id: vendaId });
      }
    }

    return NextResponse.json({ reabriraPagamento: targets.length > 0, targets, adiantamento });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Erro ao verificar impacto da exclusão." }, { status: 500 });
  }
}
