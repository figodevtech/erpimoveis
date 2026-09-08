// src/app/api/acompanhamento/ordens/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";


type StatusOS =
  | "ORCAMENTO"
  | "EM_ANDAMENTO"
  | "PAGAMENTO"
  | "FATURAMENTO"
  | "CONCLUIDO"
  | "CANCELADO"
  | "APROVACAO_ORCAMENTO"
  | "ORCAMENTO_APROVADO"
  | "ORCAMENTO_RECUSADO";

const SET_AGUARDANDO: StatusOS[] = ["ORCAMENTO", "ORCAMENTO_RECUSADO", "APROVACAO_ORCAMENTO", "ORCAMENTO_APROVADO"];
const SET_EXECUCAO: StatusOS[] = ["EM_ANDAMENTO"];
const SET_FATURAMENTO: StatusOS[] = ["PAGAMENTO", "FATURAMENTO"];
const SET_FINALIZADAS: StatusOS[] = ["CONCLUIDO", "CANCELADO"];

/**
 * campos/joins usados pelo painel
 * - inclui itens de orçamento (osproduto e osservico)
 *
 * Observação: ajuste `usuario:usuarioid` caso o nome da FK na sua tabela
 * `osservico_realizador` seja diferente (ex.: idusuario, user_id, etc.).
 */
const BASE_SELECT = `
  id,
  descricao,
  status,
  prioridade,
  alvo_tipo,
  dataentrada,
  datasaida,
  updatedat,

  execucao_inicio_em,
  execucao_fim_em,

  cliente:clienteid ( id, nomerazaosocial ),
  veiculo:veiculoid ( id, placa, modelo, marca, cor ),
  peca:pecaid ( id, titulo, descricao, lacre ),
  setor:setorid ( id, nome ),

  produtos:osproduto (
    quantidade,
    precounitario,
    subtotal,
    produto:produtoid ( id, titulo )
  ),

  servicos:osservico (
    quantidade,
    precounitario,
    subtotal,

    realizadores:osservico_realizador (
      usuario:usuarioid ( id, nome )
    ),

    servico:servicoid ( id, descricao )
  )
`;

function httpError(err: any, fallback = "Falha ao carregar painel", code = 500) {
  const msg = err?.message || fallback;
  return NextResponse.json({ error: msg }, { status: err?.statusCode || code });
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const limit = Math.min(500, Math.max(1, Number(searchParams.get("limit") || "300")));
    const horasRecentes = Math.min(72, Math.max(1, Number(searchParams.get("horasRecentes") || "12")));
    const setorIdRaw = searchParams.get("setorId");
    const setorId = setorIdRaw ? Number(setorIdRaw) : null;
    const hasSetor = Number.isFinite(setorId as number) && (setorId as number) > 0;

    let qAguard = supabaseAdmin.from("ordemservico").select(BASE_SELECT).in("status", SET_AGUARDANDO);
    if (hasSetor) qAguard = qAguard.eq("setorid", setorId as number);
    qAguard = qAguard.order("dataentrada", { ascending: true }).limit(limit);

    let qExec = supabaseAdmin.from("ordemservico").select(BASE_SELECT).in("status", SET_EXECUCAO);
    if (hasSetor) qExec = qExec.eq("setorid", setorId as number);
    qExec = qExec
      .order("execucao_inicio_em", { ascending: true })
      .order("dataentrada", { ascending: true })
      .limit(limit);

    let qFat = supabaseAdmin.from("ordemservico").select(BASE_SELECT).in("status", SET_FATURAMENTO);
    if (hasSetor) qFat = qFat.eq("setorid", setorId as number);
    qFat = qFat.order("execucao_fim_em", { ascending: true }).order("updatedat", { ascending: true }).limit(limit);

    let qFin = supabaseAdmin.from("ordemservico").select(BASE_SELECT).in("status", SET_FINALIZADAS);
    if (hasSetor) qFin = qFin.eq("setorid", setorId as number);

    qFin = qFin.order("datasaida", { ascending: true }).limit(limit);

    const [rAguard, rExec, rFat, rFin] = await Promise.all([qAguard, qExec, qFat, qFin]);

    for (const r of [rAguard, rExec, rFat, rFin]) {
      if (r.error) throw r.error;
    }

    return NextResponse.json(
      {
        aguardando: rAguard.data ?? [],
        emAndamento: rExec.data ?? [],
        aguardandoPagamento: rFat.data ?? [],
        concluidasRecentes: rFin.data ?? [],
        meta: {
          limit,
          horasRecentes,
          finalizadas: "todas",
          setorId: hasSetor ? (setorId as number) : null,
          now: new Date().toISOString(),
        },
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[GET] /api/acompanhamento/ordens", err);
    return httpError(err);
  }
}
