// src/app/api/ordens/stats/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type StatusOS =
  | "AGUARDANDO_CHECKLIST"
  | "ORCAMENTO"
  | "ORCAMENTO_RECUSADO"
  | "APROVACAO_ORCAMENTO"
  | "ORCAMENTO_APROVADO"
  | "EM_ANDAMENTO"
  | "PAGAMENTO"
  | "FATURAMENTO"
  | "SEM_COBRANCA"
  | "CONCLUIDO"
  | "CANCELADO";

const ALL_STATUSES: StatusOS[] = [
  "AGUARDANDO_CHECKLIST",
  "ORCAMENTO",
  "ORCAMENTO_RECUSADO",
  "APROVACAO_ORCAMENTO",
  "ORCAMENTO_APROVADO",
  "EM_ANDAMENTO",
  "PAGAMENTO",
  "FATURAMENTO",
  "SEM_COBRANCA",
  "CONCLUIDO",
  "CANCELADO",
];

type LinhaContagem = { status_os: string | null; total: number | string | null };

// Uma varredura agrupada no lugar de onze COUNT(*) paralelos: status ausente na
// resposta simplesmente nao tem OS, e o contador dele fica zero.
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin.rpc("ordens_contagem_por_status");
    if (error) throw error;

    const totais = new Map<string, number>(
      ((data ?? []) as LinhaContagem[]).map((linha) => [
        String(linha.status_os ?? ""),
        Number(linha.total) || 0,
      ])
    );

    const counters = ALL_STATUSES.reduce((acc, status) => {
      acc[status] = totais.get(status) ?? 0;
      return acc;
    }, {} as Record<StatusOS, number>);

    return NextResponse.json({ counters });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro ao calcular estatísticas" }, { status: 500 });
  }
}
