// src/app/api/me/vendas/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  comoLista,
  erroInterno,
  getMeUserId,
  isNextResponse,
  num,
  parsePaginacao,
  parsePeriodo,
  relacaoNomeada,
  texto,
  totalDePaginas,
} from "../_helpers";

/**
 * Itens ja vem embutidos: a Central Pessoal e aberta a qualquer autenticado e
 * nao pode cair no /api/venda/[id], que exige PERMS.VENDAS no middleware.
 */
const SELECT = `
  id,
  status,
  canal,
  datavenda,
  valortotal,
  sub_total,
  valor_frete,
  forma_pagamento,
  cliente:clienteid ( id, nomerazaosocial ),
  itens:vendaproduto (
    id,
    quantidade,
    sub_total,
    valor_total,
    valor_desconto,
    produto:produtoid ( id, titulo, referencia, unidade )
  )
`;

export async function GET(req: Request) {
  const userId = await getMeUserId(req);
  if (isNextResponse(userId)) return userId;

  try {
    const { searchParams } = new URL(req.url);
    const periodo = parsePeriodo(searchParams);
    const { page, limit, from, to } = parsePaginacao(searchParams);
    const status = (searchParams.get("status") ?? "").trim().toUpperCase();

    // "Venda realizada pelo usuario" = venda.vendedor, a coluna semantica de
    // quem vendeu (created_by e apenas quem lancou no sistema).
    let query = supabaseAdmin
      .from("venda")
      .select(SELECT, { count: "exact" })
      .eq("vendedor", userId);

    if (periodo.inicio) query = query.gte("datavenda", periodo.inicio);
    if (periodo.fim) query = query.lte("datavenda", periodo.fim);
    if (status && status !== "TODOS") query = query.eq("status", status);

    const { data, error, count } = await query
      .order("datavenda", { ascending: false })
      .range(from, to);

    if (error) throw error;

    const items = (data ?? []).map((row) => {
      const venda = row as unknown as Record<string, unknown>;
      const itens = comoLista(venda.itens).map((item) => {
        const produto = relacaoNomeada(item.produto, "titulo");
        const produtoBruto = (Array.isArray(item.produto) ? item.produto[0] : item.produto) as
          | Record<string, unknown>
          | null
          | undefined;

        return {
          id: Number(item.id),
          produtoId: produto?.id ?? null,
          titulo: produto?.nome ?? "Produto removido",
          referencia: texto(produtoBruto?.referencia),
          unidade: texto(produtoBruto?.unidade),
          quantidade: num(item.quantidade),
          valorUnitario: num(item.sub_total) / Math.max(num(item.quantidade), 1),
          valorTotal: num(item.valor_total),
        };
      });

      return {
        id: Number(venda.id),
        status: texto(venda.status),
        canal: texto(venda.canal),
        dataVenda: texto(venda.datavenda),
        formaPagamento: texto(venda.forma_pagamento),
        subTotal: num(venda.sub_total),
        valorFrete: num(venda.valor_frete),
        valorTotal: num(venda.valortotal),
        cliente: relacaoNomeada(venda.cliente, "nomerazaosocial"),
        itens,
        quantidadeItens: itens.reduce((acc, item) => acc + item.quantidade, 0),
      };
    });

    const total = count ?? 0;

    return NextResponse.json(
      { items, page, limit, total, totalPages: totalDePaginas(total, limit) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return erroInterno("GET /api/me/vendas", e);
  }
}
