export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireEstoqueAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { carregarAutores } from "@/lib/movement-authors";

/**
 * Razao de movimentacao do estoque de produtos.
 *
 * Fonte unica das quatro origens que mexem em saldo: entrada, saida manual,
 * venda e ordem de servico. Antes desta rota so entrada e saida apareciam em
 * tela, porque venda e OS nao tinham registro de movimento - apenas a baixa
 * vigente, que some quando estornada.
 */

const SENTIDOS = new Set(["ENTRADA", "SAIDA"]);
const ORIGENS = new Set([
  "ENTRADA",
  "SAIDA_MANUAL",
  "VENDA",
  "ORDEM_SERVICO",
  "NAO_IDENTIFICADA",
]);
const ACOES = new Set(["REGISTRO", "ESTORNO"]);

// entrada e saida vem embutidas porque a tela precisa do status delas para
// habilitar as acoes de cancelamento e de emissao de nota. Venda e OS ficam
// apenas pelo id e pelo rotulo congelado: o documento pode ter sido excluido, e
// o razao tem que continuar exibindo a linha mesmo assim.
const SELECT = `
  id, produto_id, sentido, origem, acao, quantidade,
  saldo_anterior, saldo_resultante,
  entrada_id, saida_id, venda_id, ordemservicoid,
  documento_label, observacao, reconstruido, created_by, created_at,
  produto:produto_id (id, titulo, referencia, unidade),
  entrada:entrada_id (id, status, origem, fiscal, numero_nota,
    fornecedor:fornecedorid (nomerazaosocial)),
  saida:saida_id (id, status, motivo, observacao)
`;

export async function GET(req: NextRequest) {
  try {
    await requireEstoqueAccess();

    const params = req.nextUrl.searchParams;
    const page = Math.max(Number(params.get("page")) || 1, 1);
    const limit = Math.min(Math.max(Number(params.get("limit")) || 50, 1), 200);
    const from = (page - 1) * limit;

    let query = supabaseAdmin
      .from("estoque_movimento")
      .select(SELECT, { count: "exact" })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    const produtoId = Number(params.get("produtoId"));
    if (Number.isInteger(produtoId) && produtoId > 0) {
      query = query.eq("produto_id", produtoId);
    }

    const sentido = (params.get("sentido") ?? "").toUpperCase();
    if (SENTIDOS.has(sentido)) query = query.eq("sentido", sentido);

    const acao = (params.get("acao") ?? "").toUpperCase();
    if (ACOES.has(acao)) query = query.eq("acao", acao);

    // Aceita varias origens separadas por virgula, para a tela poder filtrar
    // "somente venda e OS" numa consulta so.
    const origens = (params.get("origem") ?? "")
      .split(",")
      .map((valor) => valor.trim().toUpperCase())
      .filter((valor) => ORIGENS.has(valor));
    if (origens.length === 1) query = query.eq("origem", origens[0]);
    if (origens.length > 1) query = query.in("origem", origens);

    const vendaId = Number(params.get("vendaId"));
    if (Number.isInteger(vendaId) && vendaId > 0) query = query.eq("venda_id", vendaId);

    const ordemServicoId = Number(params.get("ordemServicoId"));
    if (Number.isInteger(ordemServicoId) && ordemServicoId > 0) {
      query = query.eq("ordemservicoid", ordemServicoId);
    }

    const desde = params.get("desde");
    if (desde) query = query.gte("created_at", desde);

    const ate = params.get("ate");
    if (ate) query = query.lte("created_at", ate);

    const { data, error, count } = await query.range(from, from + limit - 1);
    if (error) throw error;

    const linhas = data ?? [];
    const autores = await carregarAutores(linhas.map((linha: any) => linha.created_by));

    const total = count ?? 0;
    return NextResponse.json({
      data: linhas.map((linha: any) => ({
        ...linha,
        criador: autores.get(String(linha.created_by ?? "")) ?? null,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error: any) {
    const message = error?.message ?? "Não foi possível carregar as movimentações de estoque.";
    return NextResponse.json({ error: message }, { status: error?.statusCode ?? 500 });
  }
}
