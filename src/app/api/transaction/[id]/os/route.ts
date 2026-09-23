// src/app/api/transacoes/[id]/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireFinanceiroDelete } from "@/app/api/_authz/perms";
import { calculateFinancialTotal } from "@/lib/financial-surcharge";
import { exigirAcessoATransacao } from "../../_lib/autoria";

type Params = { params: Promise<{ id: string }> };

/** Converte monetário (string/number) para centavos inteiros */
function toCents(v: any): number {
  if (v == null) return 0;
  if (typeof v === "number") return Math.round(v * 100);
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Lê e valida o :id da rota */
async function parseId(ctx: Params) {
  const { id: idParam } = await ctx.params;
  const id = Number((idParam ?? "").trim());
  if (!id) throw new Error("ID inválido.");
  return id;
}

// Ajuste se seus literais do enum forem diferentes
const STATUS_CONCLUIDO = "CONCLUIDO";
const STATUS_CONCLUIDA = "FINALIZADA"; // compatibilidade com registros legados
const STATUS_PAGAMENTO = "PAGAMENTO";

/* ========================= DELETE ========================= */
export async function DELETE(_: Request, ctx: Params) {
  try {
    await requireFinanceiroDelete();
    const id = await parseId(ctx);
    await exigirAcessoATransacao(id);

    // 1) Buscar a transação para obter OS ou VENDA e tipo
    const { data: tx, error: txErr } = await supabaseAdmin
      .from("transacao")
      .select("id, ordemservicoid, tipo, vendaid, evento_financeiro_id, pendente, eh_adiantamento")
      .eq("id", id)
      .maybeSingle();

    if (txErr) {
      return NextResponse.json(
        { error: "Erro ao buscar transação." },
        { status: 500 }
      );
    }
    if (!tx) {
      return NextResponse.json(
        { error: "Transação não encontrada." },
        { status: 404 }
      );
    }

    /*
     * A mesma trava de `DELETE /api/transaction/[id]`: título liquidado não se
     * exclui, porque a exclusão apaga o título e não a baixa.
     *
     * Precisa estar aqui também — esta é a rota que a tela de pagamentos de
     * venda usa, e é justamente ela que lista título quase sempre liquidado.
     * Uma trava só na outra rota deixaria a regra valendo por acaso, conforme a
     * tela de onde o clique veio.
     */
    if (tx.pendente === false && !tx.eh_adiantamento) {
      return NextResponse.json(
        {
          error:
            "Esta transação está liquidada e aparece no fluxo de caixa. Tire-a do fluxo primeiro: o título volta a ficar em aberto, e aí pode ser excluído.",
        },
        { status: 409 },
      );
    }

    const osId: number | null =
      tx?.ordemservicoid != null ? Number(tx.ordemservicoid) : null;
    const vendaId: number | null =
      tx?.vendaid != null ? Number(tx.vendaid) : null;

    const isReceita =
      typeof tx?.tipo === "string" && tx.tipo.toUpperCase() === "RECEITA";

    // 2) Deletar a transação
    const { error: delErr } = await supabaseAdmin
      .from("transacao")
      .delete()
      .eq("id", id);

    if (delErr) {
      return NextResponse.json(
        { error: "Erro ao deletar transação." },
        { status: 500 }
      );
    }

    // O trigger da exclusão recalcula a OS atomicamente, incluindo rateios e
    // o modo de faturamento. Não sobrescrever sua decisão em outra requisição.
    // 3) Se era VENDA vinculada a VENDA, revalidar status da VENDA após a exclusão
    if (vendaId && isReceita) {
      // 3.1 Orçamento e status atuais
      const { data: venda, error: osErr } = await supabaseAdmin
        .from("venda")
        .select("id, valortotal, status, acrescimo_financeiro_tipo, acrescimo_financeiro_valor")
        .eq("id", vendaId)
        .maybeSingle();

      if (!osErr && venda && venda.valortotal != null) {
        const orcCents = toCents(
          calculateFinancialTotal(
            venda.valortotal,
            venda.acrescimo_financeiro_tipo,
            venda.acrescimo_financeiro_valor,
          ),
        );

        if (orcCents > 0) {
          // 3.2 Soma das RECEITAS restantes
          const { data: receitas, error: recErr } = await supabaseAdmin
            .from("transacao")
            .select("valor")
            .eq("vendaid", vendaId)
            .eq("tipo", "RECEITA");

          if (!recErr) {
            const somaCents =
              receitas?.reduce((acc, t) => acc + toCents(t.valor), 0) ?? 0;

            const statusAtual = String(venda.status ?? "").toUpperCase();
            const estavaConcluida =
              statusAtual === STATUS_CONCLUIDO ||
              statusAtual === STATUS_CONCLUIDA;

            // 3.3 Se estava concluída e a soma ficou menor que o orçamento → volta para PAGAMENTO
            if (estavaConcluida && somaCents < orcCents) {
              const { error: updErr } = await supabaseAdmin
                .from("venda")
                .update({
                  status: STATUS_PAGAMENTO,
                  updatedat: new Date().toISOString(),
                })
                .eq("id", vendaId);

              if (updErr) {
                // Não invalida o DELETE; apenas loga
                console.error(
                  "Falha ao reabrir VENDA para PAGAMENTO após deletar transação:",
                  updErr
                );
              }
            }
          } else {
            console.error("Erro ao somar receitas da VENDA após delete:", recErr);
          }
        }
      } else if (osErr) {
        console.error("Erro ao buscar VENDA após delete:", osErr);
      }
    }

    // Sucesso sem corpo
    return new NextResponse(null, { status: 204 });
  } catch (e: any) {
    const msg = e?.message ?? "Erro ao deletar transação.";
    const statusAutorizacao = Number(e?.statusCode);
    const status =
      statusAutorizacao === 401 || statusAutorizacao === 403
        ? statusAutorizacao
        : msg.includes("ID inválido")
          ? 400
          : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
