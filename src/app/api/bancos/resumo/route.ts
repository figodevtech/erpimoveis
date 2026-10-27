export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireFinanceirosAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { saldosAposCadaMovimento, valorAssinadoNoBanco } from "@/lib/financeiro/saldo-bancario";
import {
  aplicarRecorteDeAutoria,
  recorteDeAutoria,
  type RecorteDeAutoria,
} from "@/app/api/transaction/_lib/autoria";

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

type MovimentoRow = Pick<TransacaoRow, "id" | "tipo" | "valor" | "valorLiquido">;

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

function valorDoMovimento(transacao: Pick<TransacaoRow, "valor" | "valorLiquido">) {
  return toMoney(transacao.valorLiquido ?? transacao.valor);
}

/** Os totais somam em centavos para que saldo anterior + entradas − saídas feche no centavo exibido. */
function centavos(valor: number) {
  return Math.round(valor * 100);
}

const CAMPOS_EM_CENTAVOS = [
  "valorinicial",
  "saldoAnterior",
  "entradas",
  "saidas",
  "pendenteEntrada",
  "pendenteSaida",
  "saldoAtual",
] as const;

type ValoresEmCentavos = Record<(typeof CAMPOS_EM_CENTAVOS)[number], number>;

function emReais<T extends ValoresEmCentavos>(valores: T): T {
  const copia = { ...valores };
  for (const campo of CAMPOS_EM_CENTAVOS) (copia as ValoresEmCentavos)[campo] = valores[campo] / 100;
  return copia;
}

function applyDateFilters<T>(query: T, dateFrom?: string | null, dateTo?: string | null) {
  let nextQuery = query as any;
  if (dateFrom) nextQuery = nextQuery.gte("data", localDayStartToUtcIso(dateFrom));
  if (dateTo) nextQuery = nextQuery.lt("data", localNextDayStartToUtcIso(dateTo));
  return nextQuery as T;
}

function mapTransacao(transacao: TransacaoRow, saldoApos: number | null) {
  const valor = valorDoMovimento(transacao);
  return {
    id: Number(transacao.id),
    descricao: transacao.descricao,
    nomepagador: transacao.nomepagador,
    tipo: transacao.tipo,
    categoria: transacao.categoria,
    metodopagamento: transacao.metodopagamento,
    valor,
    valorAssinado: valorAssinadoNoBanco(String(transacao.tipo), valor),
    saldoApos,
    data: transacao.data,
  };
}

async function fetchAllTransactions(recorte: RecorteDeAutoria, dateFrom?: string | null, dateTo?: string | null) {
  const rows: TransacaoResumoRow[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;

    let query = supabaseAdmin
      .from("transacao")
      .select("banco_id, tipo, valor, valorLiquido, pendente, data")
      .not("banco_id", "is", null)
      .eq("is_deleted", false)
      .order("data", { ascending: false })
      // Sem desempate, páginas de `data` repetida podem pular ou repetir linhas.
      .order("id", { ascending: false });

    query = applyDateFilters(query, dateFrom, dateTo);
    query = aplicarRecorteDeAutoria(query, recorte);

    const { data, error } = await query.range(from, to);

    if (error) throw error;

    const batch = (data ?? []) as TransacaoResumoRow[];
    rows.push(...batch);

    if (batch.length < PAGE_SIZE) break;
  }

  return rows;
}

/**
 * Centavos que cada conta movimentou antes de `dateFrom`, por banco.
 *
 * Somados ao saldo inicial, dão o saldo da conta na abertura do período. Sem
 * isso, o saldo de um período que começa em março ignoraria tudo até fevereiro e
 * não fecharia com a coluna "Saldo" das transações, que acumula a história toda.
 * Usa o mesmo corte de dia (`data` em -03:00) que o filtro do período.
 */
async function fetchMovimentoAntesDoPeriodo(recorte: RecorteDeAutoria, dateFrom: string) {
  const porBanco = new Map<number, number>();

  for (let from = 0; ; from += PAGE_SIZE) {
    const query = supabaseAdmin
      .from("transacao")
      .select("id, banco_id, tipo, valor, valorLiquido")
      .not("banco_id", "is", null)
      .eq("is_deleted", false)
      .not("pendente", "is", true)
      .lt("data", localDayStartToUtcIso(dateFrom))
      .order("id", { ascending: true });

    const { data, error } = await aplicarRecorteDeAutoria(query, recorte).range(from, from + PAGE_SIZE - 1);

    if (error) throw error;

    const batch = (data ?? []) as Pick<TransacaoRow, "id" | "banco_id" | "tipo" | "valor" | "valorLiquido">[];
    for (const row of batch) {
      const bancoId = Number(row.banco_id);
      const valor = centavos(valorAssinadoNoBanco(String(row.tipo), valorDoMovimento(row)));
      porBanco.set(bancoId, (porBanco.get(bancoId) ?? 0) + valor);
    }

    if (batch.length < PAGE_SIZE) break;
  }

  return porBanco;
}

/**
 * Saldo da conta depois de cada movimento liquidado, por id.
 *
 * Lê a história inteira da conta, sem o recorte do filtro: o saldo depois de uma
 * transação de março inclui tudo o que veio antes dela, mesmo com o período
 * começando em março.
 *
 * O recorte de autoria, ao contrário, vale aqui também: um saldo acumulado sobre
 * a conta inteira, ao lado de uma lista recortada, entrega por diferença o que a
 * lista esconde. Recortado, o saldo de cada linha fecha com as linhas visíveis.
 */
async function fetchSaldosAposMovimentos(bancoId: number, recorte: RecorteDeAutoria) {
  const bancoPromise = supabaseAdmin.from("bancoconta").select("valorinicial").eq("id", bancoId).maybeSingle();
  const movimentos: { id: number; valorAssinado: number }[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const query = supabaseAdmin
      .from("transacao")
      .select("id, tipo, valor, valorLiquido")
      .eq("banco_id", bancoId)
      .eq("is_deleted", false)
      .not("pendente", "is", true)
      .order("data_dia", { ascending: true })
      .order("movimento_registrado_em", { ascending: true })
      .order("id", { ascending: true });

    const { data, error } = await aplicarRecorteDeAutoria(query, recorte).range(from, from + PAGE_SIZE - 1);

    if (error) throw error;

    const batch = (data ?? []) as MovimentoRow[];
    for (const row of batch) {
      movimentos.push({
        id: Number(row.id),
        valorAssinado: valorAssinadoNoBanco(String(row.tipo), valorDoMovimento(row)),
      });
    }

    if (batch.length < PAGE_SIZE) break;
  }

  const { data: banco, error: bancoError } = await bancoPromise;
  if (bancoError) throw bancoError;

  return saldosAposCadaMovimento(toMoney(banco?.valorinicial), movimentos);
}

async function fetchTransactionsPage({
  bancoId,
  dateFrom,
  dateTo,
  page,
  limit,
  recorte,
}: {
  bancoId: number | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  page: number;
  limit: number;
  recorte: RecorteDeAutoria;
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
    // Pendente é título a receber ou a pagar: ainda não movimentou a conta.
    .not("pendente", "is", true)
    // Ordem do extrato, a mesma do Fluxo: dia do movimento, depois registro, depois
    // id. É também a ordem em que o saldo de cada linha é acumulado.
    .order("data_dia", { ascending: false })
    .order("movimento_registrado_em", { ascending: false })
    .order("id", { ascending: false });

  query = applyDateFilters(query, dateFrom, dateTo);
  query = aplicarRecorteDeAutoria(query, recorte);

  const [{ data, error, count }, saldos] = await Promise.all([
    query.range(from, to),
    fetchSaldosAposMovimentos(bancoId, recorte),
  ]);
  if (error) throw error;

  const total = count ?? 0;

  return {
    bancoId,
    // Linha liquidada entre as duas leituras fica sem saldo até recarregar.
    items: ((data ?? []) as TransacaoRow[]).map((transacao) =>
      mapTransacao(transacao, saldos.get(Number(transacao.id)) ?? null)
    ),
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
    // Mesmo recorte do Fluxo: compartilha lançamentos de criadores sem Caixa
    // administrativo e registros sem autor. Vale para a lista, os totais e os
    // saldos — um cartão com o caixa inteiro revelaria o que a lista esconde.
    const recorte = await recorteDeAutoria(false);

    if (onlyTransactions) {
      const transacoesPaginadas = await fetchTransactionsPage({
        bancoId: Number.isFinite(bancoId) ? bancoId : null,
        dateFrom,
        dateTo,
        page,
        limit,
        recorte,
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

    const [{ data: bancos, error: bancosError }, transacoes, movimentoAntes, transacoesPaginadas] = await Promise.all([
      supabaseAdmin
        .from("bancoconta")
        .select("id, titulo, valorinicial, agencia, contanumero, tipo, proprietario, ativo")
        .order("titulo", { ascending: true }),
      fetchAllTransactions(recorte, dateFrom, dateTo),
      dateFrom ? fetchMovimentoAntesDoPeriodo(recorte, dateFrom) : new Map<number, number>(),
      fetchTransactionsPage({ bancoId: Number.isFinite(bancoId) ? bancoId : null, dateFrom, dateTo, page, limit, recorte }),
    ]);

    if (bancosError) throw bancosError;

    // Valores em centavos até a montagem da resposta.
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

      const signed = centavos(valorAssinadoNoBanco(String(transacao.tipo), valorDoMovimento(transacao)));
      const isEntrada = signed >= 0;
      const abs = Math.abs(signed);

      // Conta o mesmo que a tabela de transações do banco lista: só o liquidado.
      if (!transacao.pendente) current.totalTransacoes += 1;

      // Pendente (a receber/a pagar) não movimentou a conta; costuma ter data futura de vencimento.
      if (
        !transacao.pendente &&
        (!current.ultimaMovimentacao || new Date(transacao.data) > new Date(current.ultimaMovimentacao))
      ) {
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
      const valorInicial = centavos(toMoney(banco.valorinicial));
      // Saldo na abertura do período; sem início de período, é o saldo inicial.
      const saldoAnterior = valorInicial + (movimentoAntes.get(Number(banco.id)) ?? 0);
      // Saldo no fim do período: o mesmo da coluna "Saldo" na última transação dele.
      const saldoAtual = saldoAnterior + resumo.entradas - resumo.saidas;

      return {
        id: Number(banco.id),
        titulo: banco.titulo,
        valorinicial: valorInicial,
        agencia: banco.agencia,
        contanumero: banco.contanumero,
        tipo: banco.tipo,
        proprietario: banco.proprietario,
        ativo: banco.ativo !== false,
        saldoAnterior,
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
        saldoAnterior: acc.saldoAnterior + item.saldoAnterior,
        entradas: acc.entradas + item.entradas,
        saidas: acc.saidas + item.saidas,
        pendenteEntrada: acc.pendenteEntrada + item.pendenteEntrada,
        pendenteSaida: acc.pendenteSaida + item.pendenteSaida,
        saldoAtual: acc.saldoAtual + item.saldoAtual,
      }),
      {
        valorinicial: 0,
        saldoAnterior: 0,
        entradas: 0,
        saidas: 0,
        pendenteEntrada: 0,
        pendenteSaida: 0,
        saldoAtual: 0,
      }
    );

    return NextResponse.json({
      items: items.map(emReais),
      totals: emReais(totals),
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
