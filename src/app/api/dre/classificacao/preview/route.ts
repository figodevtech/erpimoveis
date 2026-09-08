export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireFinanceirosAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { mensagemDoErro, statusDoErro } from "@/lib/financeiro/plano-contas/erros";

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * POST /api/dre/classificacao/preview
 *
 * Diz para onde um lançamento nesta conta vai, sem gravar nada. Alimenta a
 * prévia do seletor do financeiro e o formulário de conta.
 *
 * Usa `dre_previa_da_conta`, a mesma resolução da soma. Se a explicação fosse
 * calculada aqui, a tela poderia prometer uma linha que a DRE não usa — e o
 * usuário só descobriria no fechamento.
 *
 * `INCOMPATIVEL` é o caso que a tela precisa bloquear antes do envio; a rota de
 * gravação e o gatilho do banco repetem a validação, porque nem toda escrita
 * passa por esta tela.
 */
export async function POST(req: Request) {
  try {
    await requireFinanceirosAccess();

    const body = await req.json().catch(() => ({}));
    const contaId = Number(body.conta_id);
    const natureza = String(body.natureza ?? "").trim().toUpperCase();
    const competencia = String(body.competencia ?? "").trim();

    if (!Number.isInteger(contaId) || contaId <= 0) {
      return NextResponse.json({ error: "Informe a conta do plano de contas." }, { status: 400 });
    }
    if (natureza !== "RECEITA" && natureza !== "DESPESA") {
      return NextResponse.json({ error: "Natureza deve ser RECEITA ou DESPESA." }, { status: 400 });
    }
    if (competencia && !DATA_ISO.test(competencia)) {
      return NextResponse.json({ error: "Competência deve estar no formato AAAA-MM-DD." }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .rpc("dre_previa_da_conta", {
        p_conta_id: contaId,
        p_natureza: natureza,
        p_competencia: competencia || null,
      })
      .maybeSingle();
    if (error) throw error;

    const previa = (data ?? null) as {
      resultado?: string;
      classificacao?: string | null;
      classificacao_nome?: string | null;
      linha_codigo?: string | null;
      linha_nome?: string | null;
      origem?: string | null;
      motivo?: string | null;
    } | null;

    if (!previa) {
      return NextResponse.json({ error: "Conta não encontrada." }, { status: 404 });
    }

    return NextResponse.json(
      {
        resultado: previa.resultado ?? "PENDENTE",
        classificacao: previa.classificacao ?? null,
        classificacao_nome: previa.classificacao_nome ?? null,
        linha_codigo: previa.linha_codigo ?? null,
        linha_nome: previa.linha_nome ?? null,
        origem: previa.origem ?? null,
        motivo: previa.motivo ?? null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[POST /api/dre/classificacao/preview]", error);
    return NextResponse.json(
      { error: mensagemDoErro(error, "Erro ao prever a classificação") },
      { status: statusDoErro(error) },
    );
  }
}
