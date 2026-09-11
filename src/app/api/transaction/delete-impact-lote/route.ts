export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { requireFinanceiroDelete } from "@/app/api/_authz/perms";
import { classificarExclusaoEmLote } from "@/app/api/transaction/_lib/classificar-exclusao";
import { analisarImpacto } from "@/app/api/transaction/_lib/impacto-exclusao";
import { lerIdsDoCorpo } from "@/app/api/transaction/_lib/lote-exclusao";

/**
 * A prévia da exclusão em massa: o que acontece com cada linha marcada.
 *
 * POST e não GET porque a lista de ids não cabe confortavelmente numa URL — cem
 * identificadores estouram o limite prático de query string. Não escreve nada.
 *
 * O `plano` que sai daqui viaja para a tela apenas como informação. A rota de
 * execução refaz a conta: entre ver a prévia e apertar o botão, outra pessoa
 * pode ter baixado, estornado ou excluído uma das linhas.
 */
export async function POST(req: Request) {
  try {
    await requireFinanceiroDelete();

    const corpo = await req.json().catch(() => ({}));
    const ids = lerIdsDoCorpo((corpo as { ids?: unknown })?.ids);

    const impactos = await analisarImpacto(ids);
    const { itens, plano, resumo } = classificarExclusaoEmLote(ids, impactos);

    return NextResponse.json({ data: { itens, plano, resumo } });
  } catch (error: unknown) {
    const erro = error as { statusCode?: number; message?: string };
    const statusAutorizacao = Number(erro?.statusCode);
    const status =
      statusAutorizacao === 401 || statusAutorizacao === 403
        ? statusAutorizacao
        : erro?.message?.includes("Informe") ||
            erro?.message?.includes("no máximo") ||
            erro?.message?.includes("identificador")
          ? 400
          : 500;

    return NextResponse.json(
      { error: erro?.message ?? "Erro ao verificar o impacto da exclusão." },
      { status },
    );
  }
}
