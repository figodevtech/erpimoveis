// src/app/api/me/servicos/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
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
 * `osservico_realizador` e o registro de quem de fato executou cada servico da
 * OS — o mesmo vinculo usado pelo modulo de execucao.
 *
 * A tabela NAO tem FK direta para `ordemservico`: sua chave estrangeira e
 * composta e aponta para `osservico`. Por isso a OS e alcancada em dois saltos
 * (`osservico -> ordemservico`), e o filtro de periodo usa o caminho aninhado.
 * O `!inner` em cada nivel transforma o embed em join, o que permite filtrar,
 * contar e paginar no banco em uma unica consulta.
 *
 * Nao expomos `valor_base` / `valor_comissao`: a Central mostra o valor do
 * servico, nao o calculo de comissao.
 */
const SELECT = `
  ordemservicoid,
  servicoid,
  observacao_execucao,
  item:osservico!inner (
    descricao,
    quantidade,
    precounitario,
    subtotal,
    servico:servicoid ( id, codigo, descricao ),
    ordem:ordemservicoid!inner (
      id,
      status,
      is_deleted,
      dataentrada,
      datasaida,
      execucao_fim_em,
      cliente:clienteid ( id, nomerazaosocial ),
      setor:setorid ( id, nome )
    )
  )
`;

function primeiro(valor: unknown): Record<string, unknown> | null {
  const registro = Array.isArray(valor) ? valor[0] : valor;
  return registro && typeof registro === "object" ? (registro as Record<string, unknown>) : null;
}

export async function GET(req: Request) {
  const userId = await getMeUserId(req);
  if (isNextResponse(userId)) return userId;

  try {
    const { searchParams } = new URL(req.url);
    const periodo = parsePeriodo(searchParams);
    const { page, limit, from, to } = parsePaginacao(searchParams);
    let query = supabaseAdmin
      .from("osservico_realizador")
      .select(SELECT, { count: "exact" })
      .eq("usuarioid", userId)
      .eq("item.ordem.is_deleted", false)
      .in("item.ordem.status", STATUS_OS_FINALIZADAS)
      .not("item.ordem.execucao_fim_em", "is", null);

    /*
     * Periodo pela conclusao da execucao da OS, nao pela entrada dela: o
     * trabalho precisa contar no mes em que foi encerrado.
     *
     * A regra desta aba e deliberadamente a da OS: todo servico atribuido ao
     * usuario entra quando a OS possui `execucao_fim_em` e permanece em
     * PAGAMENTO ou CONCLUIDO. O estado interno da atribuicao nao participa do
     * recorte, pois ha OS encerradas por fluxos que nao atualizam esse estado.
     */
    if (periodo.inicio) query = query.gte("item.ordem.execucao_fim_em", periodo.inicio);
    if (periodo.fimExclusivo) query = query.lt("item.ordem.execucao_fim_em", periodo.fimExclusivo);

    // Ordenacao deterministica: a PK e composta e nao ha coluna de data
    // preenchida em todas as linhas (servico so atribuido fica sem iniciado_em).
    const { data, error, count } = await query
      .order("ordemservicoid", { ascending: false })
      .order("servicoid", { ascending: true })
      .range(from, to);

    if (error) throw error;

    const items = (data ?? []).map((row) => {
      const linha = row as unknown as Record<string, unknown>;
      const item = primeiro(linha.item);
      const servico = relacaoNomeada(item?.servico, "descricao");
      const servicoBruto = primeiro(item?.servico);
      const ordem = primeiro(item?.ordem);
      const textos = resolverTextosServico(
        servico?.nome,
        item?.descricao,
        "Serviço removido da OS",
      );

      return {
        ordemId: Number(linha.ordemservicoid),
        servicoId: Number(linha.servicoid),
        descricao: textos.descricao,
        subdescricao: textos.subdescricao,
        codigo: texto(servicoBruto?.codigo),
        quantidade: num(item?.quantidade) || 1,
        valorUnitario: num(item?.precounitario),
        subtotal: num(item?.subtotal),
        observacao: texto(linha.observacao_execucao),
        ordem: {
          status: texto(ordem?.status),
          dataEntrada: texto(ordem?.dataentrada),
          dataSaida: texto(ordem?.datasaida),
          concluidaEm: texto(ordem?.execucao_fim_em),
          cliente: relacaoNomeada(ordem?.cliente, "nomerazaosocial"),
          setor: relacaoNomeada(ordem?.setor),
        },
      };
    });

    const total = count ?? 0;

    return NextResponse.json(
      { items, page, limit, total, totalPages: totalDePaginas(total, limit) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return erroInterno("GET /api/me/servicos", e);
  }
}
