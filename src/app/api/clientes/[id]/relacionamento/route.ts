export const runtime = "nodejs";

import { requireFinanceirosAccess } from "@/app/api/_authz/perms";
import {
  calcularScoreCliente,
  type TituloClienteInput,
} from "@/lib/financeiro/score-cliente";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { NextRequest, NextResponse } from "next/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const LIMITE_VENDAS = 20;
const LOTE_TRANSACOES = 1_000;
const LIMITE_TITULOS_EXIBIDOS = 100;

function numero(valor: unknown) {
  const convertido = Number(valor);
  return Number.isFinite(convertido) ? convertido : 0;
}

function inteiroPositivo(valor: string | null, padrao: number, maximo: number) {
  const convertido = Number(valor);
  if (!Number.isInteger(convertido) || convertido <= 0) return padrao;
  return Math.min(convertido, maximo);
}

async function carregarTransacoesPorOrigem(
  clienteId: number,
  origem: "ordem" | "venda",
) {
  const transacoes: any[] = [];
  const relacao = origem === "ordem"
    ? "ordem:ordemservicoid!inner(clienteid)"
    : "venda:vendaid!inner(clienteid)";

  for (let inicio = 0; ; inicio += LOTE_TRANSACOES) {
    const { data, error } = await supabaseAdmin
      .from("transacao")
      .select(
        `id, valor, valor_acrescimos, pendente, data, vencimento_em, pago_em, ordemservicoid, vendaid, metodopagamento, ${relacao}`,
      )
      .eq(`${origem}.clienteid`, clienteId)
      .eq("tipo", "RECEITA")
      .eq("is_deleted", false)
      .is("evento_financeiro_id", null)
      .order("data", { ascending: false })
      .range(inicio, inicio + LOTE_TRANSACOES - 1);

    if (error) throw error;

    const lote = (data ?? []) as any[];
    transacoes.push(...lote);
    if (lote.length < LOTE_TRANSACOES) break;
  }

  return transacoes;
}

async function carregarTransacoesDoCliente(clienteId: number) {
  const [transacoesOs, transacoesVendas] = await Promise.all([
    carregarTransacoesPorOrigem(clienteId, "ordem"),
    carregarTransacoesPorOrigem(clienteId, "venda"),
  ]);

  return Array.from(
    new Map(
      [...transacoesOs, ...transacoesVendas].map((transacao) => [
        Number(transacao.id),
        transacao,
      ]),
    ).values(),
  );
}

function respostaDeErro(error: any) {
  const status = Number(error?.statusCode)
    || (error?.message === "Não autenticado" ? 401 : 500);

  return NextResponse.json(
    { error: error?.message || "Falha ao carregar o relacionamento financeiro do cliente." },
    { status },
  );
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    await requireFinanceirosAccess();

    const { id } = await context.params;
    const clienteId = Number(id);
    if (!Number.isInteger(clienteId) || clienteId <= 0) {
      return NextResponse.json({ error: "Cliente inválido." }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const pagina = inteiroPositivo(searchParams.get("page"), 1, 100_000);
    const limite = inteiroPositivo(searchParams.get("limit"), LIMITE_VENDAS, 50);
    const inicio = (pagina - 1) * limite;

    const [clienteResult, vendasResult, transacoes] = await Promise.all([
      supabaseAdmin
        .from("cliente")
        .select("id, nomerazaosocial, cpfcnpj")
        .eq("id", clienteId)
        .eq("is_deleted", false)
        .maybeSingle(),
      supabaseAdmin
        .from("venda")
        .select(
          "id, status, valortotal, datavenda, forma_pagamento, valor_frete, itens:vendaproduto(id)",
          { count: "exact" },
        )
        .eq("clienteid", clienteId)
        .order("datavenda", { ascending: false })
        .order("id", { ascending: false })
        .range(inicio, inicio + limite - 1),
      carregarTransacoesDoCliente(clienteId),
    ]);

    if (clienteResult.error) throw clienteResult.error;
    if (!clienteResult.data) {
      return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
    }
    if (vendasResult.error) throw vendasResult.error;

    const entradasScore: TituloClienteInput[] = transacoes.map((transacao) => ({
      id: Number(transacao.id),
      valor: numero(transacao.valor),
      valorAcrescimos: numero(transacao.valor_acrescimos),
      pendente: Boolean(transacao.pendente),
      data: String(transacao.data),
      vencimentoEm: transacao.vencimento_em ?? null,
      pagoEm: transacao.pago_em ?? null,
      ordemServicoId: transacao.ordemservicoid == null
        ? null
        : Number(transacao.ordemservicoid),
      vendaId: transacao.vendaid == null ? null : Number(transacao.vendaid),
      metodoPagamento: transacao.metodopagamento ?? null,
    }));
    const resumoCompleto = calcularScoreCliente(entradasScore);
    const totalVendas = vendasResult.count ?? 0;

    return NextResponse.json(
      {
        data: {
          cliente: {
            id: Number(clienteResult.data.id),
            nome: clienteResult.data.nomerazaosocial,
            cpfCnpj: clienteResult.data.cpfcnpj,
          },
          vendas: ((vendasResult.data ?? []) as any[]).map((venda) => ({
            id: Number(venda.id),
            status: venda.status,
            valorTotal: numero(venda.valortotal),
            dataVenda: venda.datavenda,
            formaPagamento: venda.forma_pagamento ?? null,
            valorFrete: numero(venda.valor_frete),
            quantidadeItens: Array.isArray(venda.itens) ? venda.itens.length : 0,
          })),
          financeiro: {
            ...resumoCompleto,
            titulos: resumoCompleto.titulos.slice(0, LIMITE_TITULOS_EXIBIDOS),
            quantidadeTitulosExibidos: Math.min(
              resumoCompleto.titulos.length,
              LIMITE_TITULOS_EXIBIDOS,
            ),
            quantidadeTitulos: resumoCompleto.titulos.length,
          },
        },
        pagination: {
          page: pagina,
          limit: limite,
          total: totalVendas,
          totalPages: Math.ceil(totalVendas / limite),
          hasNextPage: inicio + limite < totalVendas,
        },
      },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    console.error("Erro ao carregar relacionamento do cliente:", error);
    return respostaDeErro(error);
  }
}
