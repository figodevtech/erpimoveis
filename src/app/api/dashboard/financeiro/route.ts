import { NextResponse } from "next/server";

import { requireDashboardAccess } from "@/app/api/_authz/perms";
import { saldoEmAberto, valorLiquidoEfetivo } from "@/lib/financeiro/transacao";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchAllSupabaseRows } from "@/lib/supabase-pagination";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FORTALEZA_OFFSET = "-03:00";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ENTRY_TYPES = new Set(["RECEITA", "DEPOSITO"]);
const EXIT_TYPES = new Set(["DESPESA", "SAQUE"]);

type TransactionRow = {
  id: number;
  valor: number | string | null;
  valorLiquido: number | string | null;
  valor_descontos: number | string | null;
  data: string | null;
  created_at: string | null;
  metodopagamento: string | null;
  categoria: string | null;
  tipo: string | null;
  pendente: boolean | null;
  banco_id: number | null;
  valor_baixado: number | string | null;
  adiantamento_id: number | null;
  baixa_de_transacao_id: number | null;
};

function localDayStartToUtcIso(date: string) {
  return new Date(`${date}T00:00:00${FORTALEZA_OFFSET}`).toISOString();
}

function localNextDayStartToUtcIso(date: string) {
  const start = new Date(`${date}T00:00:00${FORTALEZA_OFFSET}`);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

function localDateKey(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Fortaleza",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function daysBetween(start: string, end: string) {
  const output: string[] = [];
  const cursor = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  while (cursor <= last) {
    output.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return output;
}

export async function GET(request: Request) {
  try {
    await requireDashboardAccess();

    const params = new URL(request.url).searchParams;
    const dateFrom = params.get("dateFrom") ?? "";
    const dateTo = params.get("dateTo") ?? "";
    if (!DATE_PATTERN.test(dateFrom) || !DATE_PATTERN.test(dateTo) || dateFrom > dateTo) {
      return NextResponse.json({ error: "Período inválido." }, { status: 400 });
    }

    const selectTransacao =
      'id, valor, "valorLiquido", valor_descontos, valor_baixado, data, created_at, metodopagamento, categoria, tipo, pendente, banco_id, adiantamento_id, baixa_de_transacao_id';
    const [rows, titulosPendentes] = await Promise.all([
      fetchAllSupabaseRows<TransactionRow>(() =>
        supabaseAdmin
          .from("transacao")
          .select(selectTransacao)
          .eq("is_deleted", false)
          .gte("data", localDayStartToUtcIso(dateFrom))
          .lt("data", localNextDayStartToUtcIso(dateTo))
          .order("id", { ascending: true }),
      ),
      fetchAllSupabaseRows<TransactionRow>(() =>
        supabaseAdmin
          .from("transacao")
          .select(selectTransacao)
          .eq("is_deleted", false)
          .eq("pendente", true)
          .is("baixa_de_transacao_id", null)
          .in("tipo", ["RECEITA", "DESPESA"])
          .order("data", { ascending: true })
          .order("id", { ascending: true }),
      ),
    ]);

    let receita = 0;
    let despesa = 0;
    let receitaPendente = 0;
    const perDay = new Map<string, { receita: number; despesa: number }>();
    const perCategory = new Map<string, { receita: number; despesa: number }>();
    const perMethod = new Map<string, number>();
    const normalizedTransactions: Array<TransactionRow & { valor: number; valorLiquido: number }> = [];
    const hoje = localDayStartToUtcIso(localDateKey(new Date().toISOString()));
    const em30DiasDate = new Date(hoje);
    em30DiasDate.setUTCDate(em30DiasDate.getUTCDate() + 30);
    const em30Dias = em30DiasDate.toISOString();
    const pendencias = {
      aPagar: 0,
      aPagarVencido: 0,
      aPagar30Dias: 0,
      aReceber: 0,
      aReceberVencido: 0,
    };

    for (const titulo of titulosPendentes) {
      const tipo = String(titulo.tipo ?? "").toUpperCase();
      if (tipo === "RECEITA" && titulo.adiantamento_id != null) continue;
      const valor = saldoEmAberto(titulo);
      if (valor <= 0) continue;
      const vencimento = String(titulo.data ?? "");
      if (tipo === "DESPESA") {
        pendencias.aPagar += valor;
        if (vencimento < hoje) pendencias.aPagarVencido += valor;
        if (vencimento >= hoje && vencimento < em30Dias) pendencias.aPagar30Dias += valor;
      } else if (tipo === "RECEITA") {
        pendencias.aReceber += valor;
        if (vencimento < hoje) pendencias.aReceberVencido += valor;
      }
    }

    for (const row of rows) {
      const tipo = String(row.tipo ?? "").toUpperCase();
      const isEntry = ENTRY_TYPES.has(tipo);
      const isExit = EXIT_TYPES.has(tipo);
      if (!isEntry && !isExit) continue;

      const effectiveValue = valorLiquidoEfetivo(row);
      if (!Number.isFinite(effectiveValue) || effectiveValue <= 0) continue;

      if (row.pendente === true) {
        if (tipo === "RECEITA" && row.adiantamento_id == null) {
          const openBalance = saldoEmAberto(row);
          if (openBalance > 0) {
            receitaPendente += openBalance;
            normalizedTransactions.push({ ...row, tipo, valor: openBalance, valorLiquido: openBalance });
          }
        }
        continue;
      }

      // Fluxo é dinheiro que efetivamente passou por uma conta. Títulos
      // liquidados por antecipação ficam sem banco e não podem ser somados de
      // novo ao lançamento do adiantamento.
      if (row.banco_id == null || !row.data) continue;

      normalizedTransactions.push({ ...row, tipo, valor: effectiveValue, valorLiquido: effectiveValue });
      if (isEntry) receita += effectiveValue;
      if (isExit) despesa += effectiveValue;

      const day = localDateKey(row.data);
      const dayBucket = perDay.get(day) ?? { receita: 0, despesa: 0 };
      if (isEntry) dayBucket.receita += effectiveValue;
      if (isExit) dayBucket.despesa += effectiveValue;
      perDay.set(day, dayBucket);

      const category = String(row.categoria ?? "Não informado");
      const categoryBucket = perCategory.get(category) ?? { receita: 0, despesa: 0 };
      if (isEntry) categoryBucket.receita += effectiveValue;
      if (isExit) categoryBucket.despesa += effectiveValue;
      perCategory.set(category, categoryBucket);

      if (isEntry) {
        const method = String(row.metodopagamento ?? "Não informado");
        perMethod.set(method, (perMethod.get(method) ?? 0) + effectiveValue);
      }
    }

    let accumulated = 0;
    const fluxoDiario = daysBetween(dateFrom, dateTo).map((data) => {
      const values = perDay.get(data) ?? { receita: 0, despesa: 0 };
      accumulated += values.receita - values.despesa;
      return { data, ...values, saldoAcumulado: accumulated };
    });

    return NextResponse.json(
      {
        periodo: { inicio: dateFrom, fim: dateTo },
        totais: { receita, despesa, saldo: receita - despesa, receitaPendente },
        pendencias,
        fluxoDiario,
        porCategoria: Array.from(perCategory, ([categoria, values]) => ({ categoria, ...values })),
        porMetodoPagamento: Array.from(perMethod, ([metodo, valor]) => ({ metodo, valor })),
        transacoes: normalizedTransactions,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: any) {
    const status = Number(error?.statusCode);
    return NextResponse.json(
      { error: error?.message ?? "Erro ao gerar dashboard financeiro." },
      { status: status === 401 || status === 403 ? status : 500 },
    );
  }
}
