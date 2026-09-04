export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireFinanceiroCreate, requireFinanceirosAccess } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  comCriadoPor,
  criarEventoDaOs,
  idValido,
  responder,
  responderFalha,
} from "@/app/api/ordens/[id]/eventos-financeiros/_lib/servico";
import {
  excedeLimiteSelecaoDeEventos,
  LIMITE_SELECAO_EVENTOS,
} from "@/lib/financeiro/eventos-financeiros-selection";

import {
  aplicarElegibilidadeDePagamento,
  aplicarFiltrosDeEventos,
  lerFiltrosDeEventos,
} from "./_lib/filtros";

/**
 * Todos os eventos financeiros de OS num lugar só.
 *
 * A recepção lança despesa na OS o dia inteiro; quem transforma isso em título
 * no a pagar é o financeiro. Sem esta lista, o único caminho até um evento era
 * abrir a OS — e o que ninguém abria, ninguém lançava: a despesa ficava só no
 * evento, fora do caixa, e reaparecia na DRE sem contrapartida.
 *
 * Por isso o filtro nasce em `NAO_LANCADO`. A tela é uma fila de trabalho antes
 * de ser um relatório.
 */

const EVENTO_FIELDS =
  "id, ordemservicoid, origem, natureza, natureza_dre, status, descricao, detalhe, valor, "
  + "data_evento, competencia_em, produtoid, servicoid, chave_origem, dados_snapshot, is_manual, "
  + "created_by, usuarioid, pode_gerar_transacao, transacaoid, lancamento_id, consumo_saida_id, "
  + "consumo_usoconsumo_saida_id, quantidade_snapshot";

const ORDEM_FIELDS =
  "ordem:ordemservicoid!inner ( id, status, is_deleted, dataentrada, "
  + "cliente:clienteid ( id, nomerazaosocial ) )";

const ORDENAVEIS = new Set(["data_evento", "valor", "ordemservicoid", "id"]);

export async function GET(req: NextRequest) {
  try {
    await requireFinanceirosAccess();
    const { searchParams } = new URL(req.url);

    const page = Math.max(Number(searchParams.get("page") ?? 1) || 1, 1);
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 50) || 50, 1), 200);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const ordenarBruto = String(searchParams.get("ordenarPor") ?? "");
    const ordenarPor = ORDENAVEIS.has(ordenarBruto) ? ordenarBruto : "data_evento";
    const ascending = String(searchParams.get("ordem") ?? "desc").toLowerCase() === "asc";

    const filtros = lerFiltrosDeEventos(searchParams);

    if (filtros.selecionarTodos) {
      const consultaSelecionaveis = aplicarElegibilidadeDePagamento(
        aplicarFiltrosDeEventos(
          supabaseAdmin
            .from("eventos_financeiros")
            .select(
              "id, ordemservicoid, descricao, valor, ordem:ordemservicoid!inner ( id, is_deleted )",
              { count: "exact" },
            ),
          filtros,
        ),
      )
        .order("data_evento", { ascending: false })
        .order("id", { ascending: false })
        // Busca uma linha além do limite também quando o count não estiver
        // disponível, para nunca selecionar parcialmente em silêncio.
        .range(0, LIMITE_SELECAO_EVENTOS);

      const { data, error, count } = await consultaSelecionaveis;
      if (error) throw error;

      const total = count ?? data?.length ?? 0;
      if (excedeLimiteSelecaoDeEventos(total)) {
        return NextResponse.json(
          {
            error: `O filtro encontrou ${total} despesas elegíveis. Refine o filtro para selecionar no máximo ${LIMITE_SELECAO_EVENTOS}.`,
            total,
            limite: LIMITE_SELECAO_EVENTOS,
          },
          { status: 422 },
        );
      }

      return NextResponse.json({
        data: (data ?? []).map((evento: any) => ({
          id: Number(evento.id),
          ordemservicoid: Number(evento.ordemservicoid),
          descricao: String(evento.descricao ?? "Despesa"),
          valor: Number(evento.valor ?? 0),
        })),
        total,
        limite: LIMITE_SELECAO_EVENTOS,
      });
    }

    let query = aplicarFiltrosDeEventos(
      supabaseAdmin
        .from("eventos_financeiros")
        .select(`${EVENTO_FIELDS}, ${ORDEM_FIELDS}`, { count: "exact" }),
      filtros,
    );

    query = filtros.agruparPorOs
      ? query
          .order("ordemservicoid", { ascending: false })
          .order(ordenarPor, { ascending })
          .order("id", { ascending: true })
      : query
          .order("data_evento", { ascending: false })
          .order("id", { ascending: false });

    query = query.range(from, to);

    const { data, error, count } = await query;
    if (error) throw error;

    const eventos = await comCriadoPor(data ?? []);

    // Os totais valem para o filtro inteiro, não para a página: o financeiro abre
    // a tela para saber quanto falta lançar, e o número da página responderia
    // outra pergunta. Vem sem `range` e só com as colunas da soma.
    const { data: paraTotais, error: totaisError } = await aplicarFiltrosDeEventos(
      // Os filtros de OS exigem que `ordem` seja um recurso embutido no
      // PostgREST, ainda que seus campos não participem da soma.
      supabaseAdmin
        .from("eventos_financeiros")
        .select(
          "natureza, status, valor, ordemservicoid, pode_gerar_transacao, transacaoid, lancamento_id, ordem:ordemservicoid!inner ( id )",
        ),
      filtros,
    );
    if (totaisError) throw totaisError;

    const linhas = paraTotais ?? [];
    const somar = (natureza: string) =>
      Math.round(
        linhas
          .filter((linha: any) => linha.natureza === natureza)
          .reduce((soma: number, linha: any) => soma + Number(linha.valor ?? 0), 0) * 100,
      ) / 100;
    const receita = somar("RECEITA");
    const despesa = somar("DESPESA");
    const selecionaveis = linhas.filter(
      (linha: any) =>
        linha.natureza === "DESPESA"
        && linha.status === "ATIVO"
        && linha.pode_gerar_transacao === true
        && linha.transacaoid == null
        && linha.lancamento_id == null,
    ).length;

    return NextResponse.json({
      data: eventos,
      pagination: {
        total: count ?? 0,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil((count ?? 0) / limit)),
      },
      totais: {
        receita,
        despesa,
        liquido: Math.round((receita - despesa) * 100) / 100,
        quantidade: linhas.length,
        ordens: new Set(linhas.map((linha: any) => linha.ordemservicoid)).size,
        selecionaveis,
      },
      filters: filtros,
    });
  } catch (error: any) {
    return responderFalha(error, "Erro ao listar eventos financeiros.");
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireFinanceiroCreate();
    const body = await req.json().catch(() => ({}));
    const osId = idValido(body?.ordemServicoId);
    if (!osId) {
      return responder({ ok: false, error: "Informe a ordem de serviço do lançamento.", status: 400 });
    }

    const session = await auth();
    const usuarioId = (session?.user as any)?.id ?? null;
    return responder(await criarEventoDaOs(osId, body, usuarioId), 201);
  } catch (error: any) {
    return responderFalha(error, "Erro ao criar evento financeiro.");
  }
}
