import { valorLiquidoEfetivo } from "@/lib/financeiro/transacao";

export const COMPLETED_ORDER_STATUSES = ["PAGAMENTO", "CONCLUIDO"] as const;

export type CompletedOrderRow = {
  orcamentototal: number | string | null;
};

export type CashFlowRow = {
  tipo: string;
  valor: number | string | null;
  valorLiquido: number | string | null;
  valor_descontos: number | string | null;
  pendente: boolean;
  banco_id: number | null;
};

const CASH_ENTRY_TYPES = new Set(["RECEITA", "DEPOSITO"]);
const CASH_EXIT_TYPES = new Set(["DESPESA", "SAQUE"]);

export function summarizeCompletedOrders(rows: CompletedOrderRow[]) {
  return {
    count: rows.length,
    total: rows.reduce((sum, row) => {
      const value = Number(row.orcamentototal ?? 0);
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0),
  };
}

export function summarizeCashFlow(rows: CashFlowRow[]) {
  let entries = 0;
  let exits = 0;
  let entryCount = 0;
  let exitCount = 0;

  for (const row of rows) {
    if (row.pendente || row.banco_id === null) continue;
    const type = String(row.tipo).toUpperCase();
    const value = valorLiquidoEfetivo(row);
    if (!Number.isFinite(value) || value <= 0) continue;

    if (CASH_ENTRY_TYPES.has(type)) {
      entries += value;
      entryCount += 1;
    } else if (CASH_EXIT_TYPES.has(type)) {
      exits += value;
      exitCount += 1;
    }
  }

  return { entries, exits, balance: entries - exits, entryCount, exitCount };
}

export function dateFallsWithinPeriod(
  value: string | null | undefined,
  window: { start: string; end: string },
) {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp)
    && timestamp >= new Date(window.start).getTime()
    && timestamp < new Date(window.end).getTime();
}
