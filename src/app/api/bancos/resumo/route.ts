export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireFinanceirosAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type BancoRow = {
  id: number;
  titulo: string;
  valorinicial: number | string | null;
  agencia: string | null;
  contanumero: string | null;
  tipo: string;
  proprietario: string | null;
  ativo: boolean | null;
};

type TransacaoRow = {
  id: number;
  banco_id: number | null;
  descricao: string;
  nomepagador: string | null;
  tipo: string;
  categoria: string | null;
  metodopagamento: string | null;
  valor: number | string | null;
  valorLiquido: number | string | null;
  pendente: boolean | null;
  data: string;
};

type TransacaoResumoRow = Pick<
  TransacaoRow,
  "banco_id" | "tipo" | "valor" | "valorLiquido" | "pendente" | "data"
>;

const PAGE_SIZE = 1000;
const FORTALEZA_OFFSET = "-03:00";

function localDayStartToUtcIso(dateStr: string) {
  return new Date(`${dateStr}T00:00:00${FORTALEZA_OFFSET}`).toISOString();
}

function localNextDayStartToUtcIso(dateStr: string) {
  const day = new Date(`${dateStr}T00:00:00${FORTALEZA_OFFSET}`);
  return new Date(day.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

function toMoney(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function signedAmount(tipo: string, value: number) {
  const normalized = tipo.toUpperCase();
  if (normalized === "RECEITA" || normalized === "DEPOSITO") return value;
  if (normalized === "DESPESA" || normalized === "SAQUE") return -value;
  return 0;
}

function applyDateFilters<T>(query: T, dateFrom?: string | null, dateTo?: string | null) {
  let nextQuery = query as any;
  if (dateFrom) nextQuery = nextQuery.gte("data", localDayStartToUtcIso(dateFrom));
  if (dateTo) nextQuery = nextQuery.lt("data", localNextDayStartToUtcIso(dateTo));
  return nextQuery as T;
}

function mapTransacao(transacao: TransacaoRow) {
  const valor = toMoney(transacao.valorLiquido ?? transacao.valor);
  return {
    id: Number(transacao.id),
    descricao: transacao.descricao,
    nomepagador: transacao.nomepagador,
    tipo: transacao.tipo,
    categoria: transacao.categoria,
    metodopagamento: transacao.metodopagamento,
    valor,
    valorAssinado: signedAmount(String(transacao.tipo), valor),
    pendente: Boolean(transacao.pendente),
    data: transacao.data,
  };
}

async function fetchAllTransactions(dateFrom?: string | null, dateTo?: string | null) {
  const rows: TransacaoResumoRow[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;

    let query = supabaseAdmin
      .from("transacao")
      .select("banco_id, tipo, valor, valorLiquido, pendente, data")
      .not("banco_id", "is", null)
      .eq("is_deleted", false)
      .order("data", { ascending: false });

    query = applyDateFilters(query, dateFrom, dateTo);

    const { data, error } = await query.range(from, to);

    if (error) throw error;

    const batch = (data ?? []) as TransacaoResumoRow[];
    rows.push(...batch);

    if (batch.length < PAGE_SIZE) break;
  }

  return rows;
}

async function fetchTransactionsPage({
  bancoId,
  dateFrom,
  dateTo,
  page,
  limit,
}: {
  bancoId: number | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  page: number;
  limit: number;
}) {
  if (!bancoId) {
    return { bancoId: null, items: [], page, limit, total: 0, totalPages: 1 };
  }

  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabaseAdmin
    .from("transacao")
    .select("id, banco_id, descricao, nomepagador, tipo, categoria, metodopagamento, valor, valorLiquido, pendente, data", {
      count: "exact",
    })
    .eq("banco_id", bancoId)
    .eq("is_deleted", false)
    .order("data", { ascending: false });

  query = applyDateFilters(query, dateFrom, dateTo);

  const { data, error, count } = await query.range(from, to);
  if (error) throw error;

  const total = count ?? 0;

  return {
    bancoId,
    items: ((data ?? []) as TransacaoRow[]).map(mapTransacao),
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

export async function GET(req: Request) {
  try {
    await requireFinanceirosAccess();
    const { searchParams } = new URL(req.url);
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const bancoIdParam = searchParams.get("bancoId");
    const bancoId = bancoIdParam ? Number(bancoIdParam) : null;
    const page = Math.max(Number(searchParams.get("page") ?? 1), 1);
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 10), 1), 100);
    const onlyTransactions = searchParams.get("onlyTransactions") === "true";

    if (onlyTransactions) {
      const transacoesPaginadas = await fetchTransactionsPage({
        bancoId: Number.isFinite(bancoId) ? bancoId : null,
        dateFrom,
        dateTo,
        page,
        limit,
      });

      return NextResponse.json({
        transacoes: transacoesPaginadas,
        filters: {
          dateFrom,
          dateTo,
          bancoId,
          page,
          limit,
        },
      });
    }

    const [{ data: bancos, error: bancosError }, transacoes, transacoesPaginadas] = await Promise.all([
      supabaseAdmin
        .from("bancoconta")
        .select("id, titulo, valorinicial, agencia, contanumero, tipo, proprietario, ativo")
        .order("titulo", { ascending: true }),
      fetchAllTransactions(dateFrom, dateTo),
      fetchTransactionsPage({ bancoId: Number.isFinite(bancoId) ? bancoId : null, dateFrom, dateTo, page, limit }),
    ]);

    if (bancosError) throw bancosError;

    const resumoPorBanco = new Map<
      number,
      {
        entradas: number;
        saidas: number;
        pendenteEntrada: number;
        pendenteSaida: number;
        totalTransacoes: number;
        ultimaMovimentacao: string | null;
      }
    >();

    for (const transacao of transacoes) {
      if (transacao.banco_id == null) continue;

      const bancoId = Number(transacao.banco_id);
      const current =
        resumoPorBanco.get(bancoId) ??
        {
          entradas: 0,
          saidas: 0,
          pendenteEntrada: 0,
          pendenteSaida: 0,
          totalTransacoes: 0,
          ultimaMovimentacao: null,
        };

      const valor = toMoney(transacao.valorLiquido ?? transacao.valor);
      const signed = signedAmount(String(transacao.tipo), valor);
      const isEntrada = signed >= 0;
      const abs = Math.abs(signed);

      current.totalTransacoes += 1;
      if (!current.ultimaMovimentacao || new Date(transacao.data) > new Date(current.ultimaMovimentacao)) {
        current.ultimaMovimentacao = transacao.data;
      }

      if (transacao.pendente) {
        if (isEntrada) current.pendenteEntrada += abs;
        else current.pendenteSaida += abs;
      } else if (isEntrada) {
        current.entradas += abs;
      } else {
        current.saidas += abs;
      }

      resumoPorBanco.set(bancoId, current);
    }

    const items = ((bancos ?? []) as BancoRow[]).map((banco) => {
      const resumo = resumoPorBanco.get(Number(banco.id)) ?? {
        entradas: 0,
        saidas: 0,
        pendenteEntrada: 0,
        pendenteSaida: 0,
        totalTransacoes: 0,
        ultimaMovimentacao: null,
      };
      const valorInicial = toMoney(banco.valorinicial);
      const saldoAtual = valorInicial + resumo.entradas - resumo.saidas;

      return {
        id: Number(banco.id),
        titulo: banco.titulo,
        valorinicial: valorInicial,
        agencia: banco.agencia,
        contanumero: banco.contanumero,
        tipo: banco.tipo,
        proprietario: banco.proprietario,
        ativo: banco.ativo !== false,
        entradas: resumo.entradas,
        saidas: resumo.saidas,
        pendenteEntrada: resumo.pendenteEntrada,
        pendenteSaida: resumo.pendenteSaida,
        saldoAtual,
        totalTransacoes: resumo.totalTransacoes,
        ultimaMovimentacao: resumo.ultimaMovimentacao,
      };
    });

    const totals = items.reduce(
      (acc, item) => ({
        valorinicial: acc.valorinicial + item.valorinicial,
        entradas: acc.entradas + item.entradas,
        saidas: acc.saidas + item.saidas,
        pendenteEntrada: acc.pendenteEntrada + item.pendenteEntrada,
        pendenteSaida: acc.pendenteSaida + item.pendenteSaida,
        saldoAtual: acc.saldoAtual + item.saldoAtual,
      }),
      {
        valorinicial: 0,
        entradas: 0,
        saidas: 0,
        pendenteEntrada: 0,
        pendenteSaida: 0,
        saldoAtual: 0,
      }
    );

    return NextResponse.json({
      items,
      totals,
      transacoes: transacoesPaginadas,
      filters: {
        dateFrom,
        dateTo,
        bancoId,
        page,
        limit,
      },
    });
  } catch (error: any) {
    const status = Number(error?.statusCode ?? 500);
    return NextResponse.json(
      { error: error?.message ?? "Erro ao carregar resumo dos bancos" },
      { status: status === 403 ? 403 : status === 401 ? 401 : 500 }
    );
  }
}
