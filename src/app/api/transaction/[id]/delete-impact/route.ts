import { NextResponse } from "next/server";

import { requireFinanceiroDelete } from "@/app/api/_authz/perms";
import { analisarImpacto } from "@/app/api/transaction/_lib/impacto-exclusao";
import { exigirAcessoATransacao } from "../../_lib/autoria";

type Params = { params: Promise<{ id: string }> };

/**
 * O que acontece se esta transação for excluída.
 *
 * A triagem inteira mudou-se para `_lib/impacto-exclusao.ts`, que nasceu plural
 * para servir também à prévia da exclusão em massa. Aqui sobrou o adaptador: o
 * payload é exatamente o de antes, e por isso `transaction-delete-alert.tsx` não
 * precisou saber de nada.
 *
 * Dois campos novos vieram junto — `conciliadoNoExtrato` e `estornoApontando` —,
 * aditivos e ignorados por quem não os lê, como já acontece com
 * `lancamentoDeEventos`.
 */
export async function GET(_: Request, { params }: Params) {
  try {
    await requireFinanceiroDelete();
    const id = Number((await params).id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "ID inválido." }, { status: 400 });
    }
    await exigirAcessoATransacao(id);

    const mapa = await analisarImpacto([id]);
    const impacto = mapa.get(id);

    if (!impacto) {
      return NextResponse.json({ error: "Transação não encontrada." }, { status: 404 });
    }

    // O contrato desta rota, escrito por extenso. `vinculos` e
    // `filhasDeBaixaParcial` servem à classificação em lote e ficam de fora: o
    // cliente individual nunca os leu, e listar campo a campo deixa visível o
    // que quebraria a tela se sumisse daqui.
    return NextResponse.json({
      reabriraPagamento: impacto.reabriraPagamento,
      targets: impacto.targets,
      adiantamento: impacto.adiantamento,
      pagamentoMultiplo: impacto.pagamentoMultiplo,
      transferencia: impacto.transferencia,
      lancamentoDeEventos: impacto.lancamentoDeEventos,
      liquidado: impacto.liquidado,
      conciliadoNoExtrato: impacto.conciliadoNoExtrato,
      estornoApontando: impacto.estornoApontando,
    });
  } catch (error: any) {
    const statusAutorizacao = Number(error?.statusCode);
    const status =
      statusAutorizacao === 401 || statusAutorizacao === 403 ? statusAutorizacao : 500;
    return NextResponse.json(
      { error: error?.message ?? "Erro ao verificar impacto da exclusão." },
      { status },
    );
  }
}
