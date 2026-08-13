export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireEstoqueAccess } from "@/app/api/_authz/perms";
import { entradasComXmlCompleto } from "@/lib/fiscal/xml-disponibilidade";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Razao de movimentacao do estoque de produtos.
 *
 * Fonte unica das quatro origens que mexem em saldo: entrada, saida manual,
 * venda e ordem de servico. Antes desta rota so entrada e saida apareciam em
 * tela, porque venda e OS nao tinham registro de movimento - apenas a baixa
 * vigente, que some quando estornada.
 *
 * A consulta roda sobre `estoque_movimento_financeiro_historico`, a visao que
 * traz status derivado, marca de nota fiscal, autor, texto de busca e a
 * existencia de lancamento financeiro. Busca, filtro e paginacao acontecem no
 * banco: a pagina devolvida e a pagina real, e `pagination.total` conta o
 * resultado inteiro, nao o lote baixado.
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
const STATUS = new Set(["CONFIRMADA", "CANCELADA"]);

const LIMITE_MAXIMO = 500;
/** Termos alem disso nao estreitam mais nada e so custam varredura. */
const MAX_TERMOS_BUSCA = 6;

/**
 * Quebra a busca em termos e limpa os curingas do LIKE.
 *
 * O PostgREST nao aceita clausula ESCAPE, entao `%` e `_` digitados pelo
 * usuario viram espaco: o termo continua valendo como texto, sem virar curinga.
 */
function termosDeBusca(valor: string | null) {
  return (valor ?? "")
    .replace(/[%_*(),]/g, " ")
    .trim()
    .toLocaleLowerCase("pt-BR")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_TERMOS_BUSCA);
}

/**
 * Consulta a disponibilidade do XML em lote para a pagina atual. Uma entrada
 * pode gerar varias linhas no razao (uma por produto), por isso os IDs sao
 * deduplicados antes da consulta.
 */
async function entradasFiscaisComXml(linhas: any[]) {
  const entradaIds = [
    ...new Set(
      linhas
        .filter((linha) => linha.fiscal === true && linha.entrada_id != null)
        .map((linha) => Number(linha.entrada_id))
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  ];

  if (!entradaIds.length) return new Set<number>();

  const entradasResult = await supabaseAdmin
    .from("entrada")
    .select("id,fiscal_dfe_documento_id,notachave")
    .in("id", entradaIds);
  if (entradasResult.error) throw entradasResult.error;

  return entradasComXmlCompleto(
    (entradasResult.data ?? []).map((entrada) => ({
      entradaId: Number(entrada.id),
      documentoId: entrada.fiscal_dfe_documento_id,
      chave: entrada.notachave,
    })),
  );
}

/** Devolve a linha da visao no formato aninhado que as telas ja consomem. */
function paraMovimento(
  linha: any,
  entradasComXml: Set<number>,
) {
  return {
    id: linha.id,
    produto_id: linha.produto_id,
    sentido: linha.sentido,
    origem: linha.origem,
    acao: linha.acao,
    quantidade: linha.quantidade,
    saldo_anterior: linha.saldo_anterior,
    saldo_resultante: linha.saldo_resultante,
    entrada_id: linha.entrada_id,
    saida_id: linha.saida_id,
    venda_id: linha.venda_id,
    ordemservicoid: linha.ordemservicoid,
    documento_label: linha.documento_label,
    observacao: linha.observacao,
    reconstruido: linha.reconstruido,
    created_by: linha.created_by,
    created_at: linha.created_at,
    status: linha.status,
    fiscal: linha.fiscal,
    financeiro_lancado:
      linha.fiscal === true && linha.entrada_id != null
        ? linha.financeiro_lancado === true
        : null,
    xml_disponivel:
      linha.fiscal === true && linha.entrada_id != null
        ? entradasComXml.has(Number(linha.entrada_id))
        : false,
    produto: linha.produto_id
      ? {
          id: linha.produto_id,
          titulo: linha.produto_titulo,
          referencia: linha.produto_referencia,
          unidade: linha.produto_unidade,
        }
      : null,
    entrada: linha.entrada_id
      ? {
          id: linha.entrada_id,
          status: linha.entrada_status,
          origem: linha.entrada_origem,
          fiscal: linha.entrada_fiscal,
          numero_nota: linha.entrada_numero_nota,
          fornecedor: linha.fornecedor_nome ? { nomerazaosocial: linha.fornecedor_nome } : null,
        }
      : null,
    saida: linha.saida_id
      ? {
          id: linha.saida_id,
          status: linha.saida_status,
          motivo: linha.saida_motivo,
          observacao: linha.saida_observacao,
        }
      : null,
    criador: linha.created_by ? { id: linha.created_by, nome: linha.criador_nome } : null,
  };
}

export async function GET(req: NextRequest) {
  try {
    await requireEstoqueAccess();

    const params = req.nextUrl.searchParams;
    const page = Math.max(Number(params.get("page")) || 1, 1);
    const limit = Math.min(Math.max(Number(params.get("limit")) || 50, 1), LIMITE_MAXIMO);
    const from = (page - 1) * limit;

    let query = supabaseAdmin
      .from("estoque_movimento_financeiro_historico")
      .select("*", { count: "exact" })
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

    const status = (params.get("status") ?? "").toUpperCase();
    if (STATUS.has(status)) query = query.eq("status", status);

    // com_nf / sem_nf: a marca fiscal ja vem resolvida pela visao (bandeira da
    // entrada, numero de nota ou origem de NF-e).
    const fiscal = (params.get("fiscal") ?? "").toLowerCase();
    if (fiscal === "com_nf") query = query.eq("fiscal", true);
    if (fiscal === "sem_nf") query = query.eq("fiscal", false);

    const financeiro = (params.get("financeiro") ?? "").toLowerCase();
    if (financeiro === "sem_lancamento") {
      query = query
        .eq("sentido", "ENTRADA")
        .eq("origem", "ENTRADA")
        .eq("acao", "REGISTRO")
        .eq("status", "CONFIRMADA")
        .eq("financeiro_lancado", false);
    }

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

    // Todos os termos precisam aparecer na linha, em qualquer campo: quem digita
    // "nf 1200" quer a nota 1200, nao tudo que tem "nf".
    for (const termo of termosDeBusca(params.get("q"))) {
      query = query.ilike("busca", `%${termo}%`);
    }

    const { data, error, count } = await query.range(from, from + limit - 1);
    if (error) throw error;

    const linhas = data ?? [];
    const entradasComXml = await entradasFiscaisComXml(linhas);
    const total = count ?? 0;
    return NextResponse.json({
      data: linhas.map((linha) => paraMovimento(linha, entradasComXml)),
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
