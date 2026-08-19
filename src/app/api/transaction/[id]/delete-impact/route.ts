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
      .select("id, valor, valor_base, valor_acrescimos, tipo, pendente, ordemservicoid, vendaid, evento_financeiro_id, adiantamento_id, eh_adiantamento, pagamento_multiplo_id")
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
    let adiantamento:
      | {
          bloqueado: boolean;
          motivo: string;
          quantidade?: number;
          /** Verdadeiro no lançamento da antecipação: excluir reabre os títulos. */
          desfaz?: boolean;
          sentido?: "RECEBER" | "PAGAR";
          titulos?: Array<{ id: number; descricao: string | null; valor: number }>;
        }
      | null = null;

    if (transaction.eh_adiantamento) {
      const { data: titulos } = await supabaseAdmin
        .from("transacao")
        .select("id, descricao, valor")
        .eq("adiantamento_id", id)
        .eq("is_deleted", false)
        .order("id", { ascending: true });

      const lista = titulos ?? [];
      if (lista.length > 0) {
        const recebe = String(transaction.tipo ?? "").toUpperCase() === "RECEITA";
        adiantamento = {
          bloqueado: false,
          desfaz: true,
          sentido: recebe ? "RECEBER" : "PAGAR",
          quantidade: lista.length,
          titulos: lista.map((titulo: any) => ({
            id: Number(titulo.id),
            descricao: titulo.descricao ?? null,
            valor: Number(titulo.valor ?? 0),
          })),
          motivo: `Excluir esta antecipação devolve ${lista.length} título(s) para ${
            recebe ? "a receber" : "a pagar"
          }.`,
        };
      }
    } else if (transaction.adiantamento_id != null) {
      // A outra ponta continua fechada: o bruto da antecipação é a soma dos
      // líquidos dos títulos, e tirar um faria o lançamento cobrir valor que
      // ninguém deve. O caminho é desfazer a antecipação.
      // "Liquidado" não serve para os dois modos: no que mantém os títulos em
      // aberto o título pode estar justamente a receber, esperando o vencimento,
      // e a frase antiga contava outra história para quem a lia.
      adiantamento = {
        bloqueado: true,
        motivo:
          `Este título faz parte da antecipação #${transaction.adiantamento_id} e não sai sozinho. ` +
          `Exclua a antecipação primeiro: ela devolve este título e os demais para em aberto.`,
      };
    }

    /*
     * Pagamento múltiplo: a linha é uma perna de um pagamento maior. Excluir só
     * ela deixaria o grupo cobrindo um valor que ninguém mais deve, então o
     * caminho é desfazer o pagamento inteiro — que aqui, ao contrário do
     * adiantamento, existe como operação (`DELETE /api/pagamento-multiplo/[id]`).
     *
     * A exceção é o parcelado com parcela já baixada: aí some dinheiro recebido,
     * e a recusa é a mesma do adiantamento.
     */
    let pagamentoMultiplo:
      | {
          id: number;
          valorTotal: number;
          modo: string;
          documentos: Array<{ tipo: "OS" | "VENDA"; id: number }>;
          quantidadeBaixada: number;
          bloqueado: boolean;
          motivo?: string;
        }
      | null = null;

    if (transaction.pagamento_multiplo_id != null) {
      const grupoId = Number(transaction.pagamento_multiplo_id);
      const [{ data: grupo }, { data: irmas }, { data: rateio }] = await Promise.all([
        supabaseAdmin
          .from("pagamento_multiplo")
          .select("id, valor_total, modo, tipo_documento")
          .eq("id", grupoId)
          .maybeSingle(),
        supabaseAdmin
          .from("transacao")
          .select("id, pendente")
          .eq("pagamento_multiplo_id", grupoId)
          .eq("is_deleted", false),
        // Os documentos do grupo vivem no rateio: a transação do recebimento não
        // aponta para nenhum deles, justamente por cobrir vários.
        supabaseAdmin
          .from("pagamento_multiplo_rateio")
          .select("tipo_documento, documento_id")
          .eq("pagamento_multiplo_id", grupoId),
      ]);

      if (grupo) {
        const tipoDoGrupo = String(grupo.tipo_documento).toUpperCase() === "OS" ? "OS" : "VENDA";
        const documentos = [
          ...new Set((rateio ?? []).map((linha: any) => Number(linha.documento_id))),
        ].map((documentoId) => ({ tipo: tipoDoGrupo as "OS" | "VENDA", id: documentoId }));

        const quantidadeBaixada =
          String(grupo.modo).toUpperCase() === "PARCELADO"
            ? (irmas ?? []).filter((linha: any) => linha.pendente === false).length
            : 0;

        pagamentoMultiplo = {
          id: grupoId,
          valorTotal: Number(grupo.valor_total ?? 0),
          modo: String(grupo.modo),
          documentos,
          quantidadeBaixada,
          bloqueado: quantidadeBaixada > 0,
          motivo:
            quantidadeBaixada > 0
              ? `Este pagamento tem ${quantidadeBaixada} parcela(s) já baixada(s). Estorne essas baixas antes de excluir o pagamento.`
              : undefined,
        };
      }
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

    /*
     * Título liquidado não sai: excluí-lo apagaria a dívida junto com o
     * pagamento. Vem por último de propósito — antecipação e pagamento múltiplo
     * também são liquidados, e a recusa deles é mais específica, dizendo qual
     * operação desfaz aquele conjunto. Só sobra este aviso quando a baixa é
     * desta transação sozinha, que é o caso em que estornar resolve.
     */
    const liquidado =
      transaction.pendente === false &&
      !transaction.eh_adiantamento &&
      transaction.adiantamento_id == null &&
      transaction.pagamento_multiplo_id == null
        ? {
            bloqueado: true as const,
            estornavel: true as const,
            motivo:
              "Esta transação está liquidada e aparece no fluxo de caixa. Tire-a do fluxo primeiro: o título volta a ficar em aberto, e aí pode ser excluído.",
            sentido:
              String(transaction.tipo ?? "").toUpperCase() === "RECEITA"
                ? ("RECEBER" as const)
                : ("PAGAR" as const),
            // Juros e multa saem junto com o pagamento que os gerou, então o
            // título não reabre pelo valor que está na tela. Dizer por quanto
            // ele volta evita a surpresa de ver outro número depois.
            valorReaberto: Number(transaction.valor_base ?? transaction.valor ?? 0),
            acrescimos: Number(transaction.valor_acrescimos ?? 0),
          }
        : null;

    return NextResponse.json({
      reabriraPagamento: targets.length > 0,
      targets,
      adiantamento,
      pagamentoMultiplo,
      liquidado,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Erro ao verificar impacto da exclusão." }, { status: 500 });
  }
}
