// src/app/api/me/ordens/route.ts
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
  resolverTextosServico,
  STATUS_OS_FINALIZADAS,
  texto,
  totalDePaginas,
} from "../_helpers";

/**
 * Produtos e servicos embutidos: a aba mostra o conteudo de cada OS sem passar
 * pelo /api/ordens/[id], que exige PERMS.ORDENS no middleware.
 */
const SELECT = `
  id,
  status,
  prioridade,
  alvo_tipo,
  dataentrada,
  datasaida,
  execucao_fim_em,
  subtotal,
  orcamentototal,
  createdat,
  cliente:clienteid ( id, nomerazaosocial ),
  veiculo:veiculoid ( id, placa, modelo, marca ),
  setor:setorid ( id, nome ),
  produtos:osproduto (
    produtoid,
    quantidade,
    precounitario,
    subtotal,
    produto:produtoid ( id, titulo, referencia, unidade )
  ),
  servicos:osservico (
    servicoid,
    descricao,
    quantidade,
    precounitario,
    subtotal,
    servico:servicoid ( id, codigo, descricao )
  )
`;

export async function GET(req: Request) {
  const userId = await getMeUserId(req);
  if (isNextResponse(userId)) return userId;

  try {
    const { searchParams } = new URL(req.url);
    const periodo = parsePeriodo(searchParams);
    const { page, limit, from, to } = parsePaginacao(searchParams);

    /*
     * A aba lista OS que o usuario abriu E cujo trabalho ja terminou.
     *
     * PAGAMENTO entra junto com CONCLUIDO: nesse estado o servico foi
     * finalizado e o veiculo liberado, faltando apenas a baixa do financeiro —
     * do ponto de vista de quem executou, a OS ja esta fechada.
     *
     * O eixo de tempo e `execucao_fim_em`, nao `dataentrada`: uma OS aberta em
     * um mes e fechada no seguinte precisa contar no mes em que fechou. Nao
     * usamos `datasaida` porque ela e digitada a mao e na base existem OS com
     * saida anterior a entrada; `execucao_fim_em` e carimbado pelo sistema.
     */
    let query = supabaseAdmin
      .from("ordemservico")
      .select(SELECT, { count: "exact" })
      .eq("usuariocriadorid", userId)
      .eq("is_deleted", false)
      .in("status", STATUS_OS_FINALIZADAS)
      .not("execucao_fim_em", "is", null);

    if (periodo.inicio) query = query.gte("execucao_fim_em", periodo.inicio);
    if (periodo.fimExclusivo) query = query.lt("execucao_fim_em", periodo.fimExclusivo);

    const { data, error, count } = await query
      .order("execucao_fim_em", { ascending: false, nullsFirst: false })
      .range(from, to);

    if (error) throw error;

    const items = (data ?? []).map((row) => {
      const ordem = row as unknown as Record<string, unknown>;

      const produtos = comoLista(ordem.produtos).map((item) => {
        const produto = relacaoNomeada(item.produto, "titulo");
        const produtoBruto = (Array.isArray(item.produto) ? item.produto[0] : item.produto) as
          | Record<string, unknown>
          | null
          | undefined;

        return {
          id: Number(item.produtoid),
          descricao: produto?.nome ?? "Produto removido",
          subdescricao: null,
          referencia: texto(produtoBruto?.referencia),
          unidade: texto(produtoBruto?.unidade),
          quantidade: num(item.quantidade),
          valorUnitario: num(item.precounitario),
          subtotal: num(item.subtotal),
        };
      });

      const servicos = comoLista(ordem.servicos).map((item) => {
        const servico = relacaoNomeada(item.servico, "descricao");
        const servicoBruto = (Array.isArray(item.servico) ? item.servico[0] : item.servico) as
          | Record<string, unknown>
          | null
          | undefined;
        const textos = resolverTextosServico(servico?.nome, item.descricao, "Serviço removido");

        return {
          id: Number(item.servicoid),
          descricao: textos.descricao,
          subdescricao: textos.subdescricao,
          codigo: texto(servicoBruto?.codigo),
          quantidade: num(item.quantidade),
          valorUnitario: num(item.precounitario),
          subtotal: num(item.subtotal),
        };
      });

      const veiculoBruto = (Array.isArray(ordem.veiculo) ? ordem.veiculo[0] : ordem.veiculo) as
        | Record<string, unknown>
        | null
        | undefined;

      return {
        id: Number(ordem.id),
        status: texto(ordem.status),
        prioridade: texto(ordem.prioridade),
        alvoTipo: texto(ordem.alvo_tipo),
        dataEntrada: texto(ordem.dataentrada),
        dataSaida: texto(ordem.datasaida),
        concluidaEm: texto(ordem.execucao_fim_em),
        subtotal: num(ordem.subtotal),
        valorTotal: num(ordem.orcamentototal),
        cliente: relacaoNomeada(ordem.cliente, "nomerazaosocial"),
        setor: relacaoNomeada(ordem.setor),
        veiculo: veiculoBruto?.id
          ? {
              id: Number(veiculoBruto.id),
              placa: texto(veiculoBruto.placa),
              modelo: texto(veiculoBruto.modelo),
              marca: texto(veiculoBruto.marca),
            }
          : null,
        produtos,
        servicos,
      };
    });

    const total = count ?? 0;

    return NextResponse.json(
      { items, page, limit, total, totalPages: totalDePaginas(total, limit) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return erroInterno("GET /api/me/ordens", e);
  }
}
