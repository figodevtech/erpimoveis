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
  "SEM_COBRANCA",
  "CONCLUIDO",
  "CANCELADO",
];

async function countByStatus(status: StatusOS) {
  const { count, error } = await supabaseAdmin
    .from("ordemservico")
    .select("*", { count: "exact", head: true })
    .eq("status", status);

  if (error) throw error;
  return count ?? 0;
}

export async function GET() {
  try {
    const counts = await Promise.all(ALL_STATUSES.map((s) => countByStatus(s)));

    const counters = ALL_STATUSES.reduce((acc, status, idx) => {
      acc[status] = counts[idx] ?? 0;
      return acc;
    }, {} as Record<StatusOS, number>);

    return NextResponse.json({ counters });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro ao calcular estatísticas" }, { status: 500 });
  }
}
