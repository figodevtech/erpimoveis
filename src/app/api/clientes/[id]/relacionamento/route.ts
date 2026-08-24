export const runtime = "nodejs";

import { requireFinanceirosAccess } from "@/app/api/_authz/perms";
import { calcularScoreCliente } from "@/lib/financeiro/score-cliente";
import { carregarTitulosDoCliente } from "@/lib/financeiro/titulos-cliente";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { NextRequest, NextResponse } from "next/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const LIMITE_VENDAS = 20;
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

    const [clienteResult, vendasResult, titulos] = await Promise.all([
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
      carregarTitulosDoCliente(clienteId),
    ]);

    if (clienteResult.error) throw clienteResult.error;
    if (!clienteResult.data) {
      return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
    }
    if (vendasResult.error) throw vendasResult.error;

    const resumoCompleto = calcularScoreCliente(titulos);
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
