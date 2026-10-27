// src/app/api/venda/status-counter/route.ts

export const runtime = "nodejs";

import { createApiTiming } from "@/lib/api-timing";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Linha bruta vinda do banco
type VendaRow = {
  valortotal: number | string;
  sub_total: number | string;
  desconto_valor: number | string | null;
  status: string;
  datavenda: string | null;
};

// Métricas de um grupo (geral ou por status)
type StatusMetrics = {
  totalValor: number;
  totalSubTotal: number;
  totalDesconto: number;
  totalPedidos: number;
  ticketMedio: number;
};

// byStatus no formato que você quer usar no front
type ByStatusObject = {
  abertas?: StatusMetrics;
  finalizadas?: StatusMetrics;
  canceladas?: StatusMetrics;
  pagamento?: StatusMetrics;
  [key: string]: StatusMetrics | undefined; // fallback p/ outros status
};

/**
 * Calcula o range [início, fim) de um mês.
 * - Se monthParam vier no formato "YYYY-MM" (ex: "2025-11"), usa esse mês.
 * - Caso contrário, usa o mês atual (UTC).
 */
function getMonthRange(monthParam: string | null) {
  const now = new Date();

  let year = now.getUTCFullYear();
  let monthIndex = now.getUTCMonth(); // 0-11

  if (monthParam) {
    const match = /^(\d{4})-(\d{2})$/.exec(monthParam);
    if (match) {
      const y = Number(match[1]);
      const m = Number(match[2]); // 1-12
      if (!Number.isNaN(y) && !Number.isNaN(m) && m >= 1 && m <= 12) {
        year = y;
        monthIndex = m - 1;
      }
    }
  }

  const start = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, monthIndex + 1, 1, 0, 0, 0, 0));

  const monthStr = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;

  return {
    year,
    monthIndex,
    monthStr,
    startISO: start.toISOString(),
    endISO: end.toISOString(),
  };
}

// Mapeia o enum do banco para a chave “bonita” que você quer usar no front
function mapStatusKey(status: string): string {
  switch (status) {
    case "PAGAMENTO":
    case "PENDENTE":
    case "AUTORIZADO":
      return "pagamento";
    case "PAGO":
    case "FINALIZADA":
      return "finalizadas";
    case "ABERTA":
      return "abertas";
    case "CANCELADA":
    case "CANCELADO":
      return "canceladas";
    default:
      return status.toLowerCase();
  }
}

/* ========================= GET ========================= */
/**
 * GET /api/venda/status-counter
 *
 * Query params:
 *  - month=YYYY-MM (opcional). Ex: month=2025-11
 *
 * Métricas retornadas:
 *  - period: info do período usado (mês, início, fim)
 *  - totals (geral do mês):
 *      - totalValor
 *      - totalSubTotal
 *      - totalDesconto
 *      - totalPedidos
 *      - ticketMedio
 *  - byStatus: objeto com chaves (abertas, finalizadas, canceladas, ...)
 *      - ex: byStatus.finalizadas.totalValor
 */
export async function GET(req: Request) {
  const timing = createApiTiming();
  try {
    const { searchParams } = new URL(req.url);
    const monthParam = searchParams.get("month"); // ex: "2025-11"

    const { monthStr, startISO, endISO } = getMonthRange(monthParam);

    // ========= 1) Buscar todas as vendas do mês =========
    const { data, error } = await timing.measure("query", () => supabaseAdmin
      .from("venda")
      .select("valortotal, sub_total, desconto_valor, status, datavenda")
      .gte("datavenda", startISO)
      .lt("datavenda", endISO));

    if (error) {
      console.error("Erro ao buscar vendas para métricas:", error);
      return timing.json(
        { error: "Erro ao buscar vendas para métricas." },
        { status: 500 }
      );
    }

    const rows = (data ?? []) as VendaRow[];

    // ========= 2) Calcular totais gerais do mês =========
    let totalValor = 0;
    let totalSubTotal = 0;
    let totalDesconto = 0;
    const totalPedidos = rows.length;

    for (const row of rows) {
      const valorTotalNum = Number(row.valortotal ?? 0);
      const subTotalNum = Number(row.sub_total ?? 0);
      const descontoNum = Number(row.desconto_valor ?? 0);

      totalValor += valorTotalNum;
      totalSubTotal += subTotalNum;
      totalDesconto += descontoNum;
    }

    const ticketMedio =
      totalPedidos > 0 ? Number((totalValor / totalPedidos).toFixed(2)) : 0;

    const totals: StatusMetrics = {
      totalValor,
      totalSubTotal,
      totalDesconto,
      totalPedidos,
      ticketMedio,
    };

    // ========= 3) Calcular métricas por status =========
    type Agg = {
      totalValor: number;
      totalSubTotal: number;
      totalDesconto: number;
      totalPedidos: number;
    };

    const byStatusMap = new Map<string, Agg>();

    for (const row of rows) {
      const statusEnum = row.status || "DESCONHECIDO";
      const valorTotalNum = Number(row.valortotal ?? 0);
      const subTotalNum = Number(row.sub_total ?? 0);
      const descontoNum = Number(row.desconto_valor ?? 0);

      if (!byStatusMap.has(statusEnum)) {
        byStatusMap.set(statusEnum, {
          totalValor: 0,
          totalSubTotal: 0,
          totalDesconto: 0,
          totalPedidos: 0,
        });
      }

      const agg = byStatusMap.get(statusEnum)!;
      agg.totalValor += valorTotalNum;
      agg.totalSubTotal += subTotalNum;
      agg.totalDesconto += descontoNum;
      agg.totalPedidos += 1;
    }

    const byStatus: ByStatusObject = {};

    for (const [statusEnum, agg] of byStatusMap.entries()) {
      const key = mapStatusKey(statusEnum);

      const metrics: StatusMetrics = {
        totalValor: agg.totalValor,
        totalSubTotal: agg.totalSubTotal,
        totalDesconto: agg.totalDesconto,
        totalPedidos: agg.totalPedidos,
        ticketMedio:
          agg.totalPedidos > 0
            ? Number((agg.totalValor / agg.totalPedidos).toFixed(2))
            : 0,
      };

      byStatus[key] = metrics;
    }

    // ========= 4) Payload de resposta =========
    const payload = {
      period: {
        month: monthStr, // ex: "2025-11"
        start: startISO,
        end: endISO,
      },
      totals,
      byStatus,
    };

    return timing.json({ data: payload });
  } catch (e: any) {
    console.error("Erro inesperado no GET /venda/status-counter:", e);
    return timing.json(
      { error: e?.message || "Erro interno do servidor." },
      { status: 500 }
    );
  }
}
