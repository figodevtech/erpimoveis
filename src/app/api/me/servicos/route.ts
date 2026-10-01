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
 * A comissao entra na resposta a pedido do balcao: o realizador precisa ver o
 * quanto ganhou, nao so o quanto o servico valeu. Vem sempre do que esta
 * gravado em `osservico_realizador` — `valor_base` e `valor_comissao` —, nunca
 * de um calculo refeito aqui, para o que a Central mostra nunca divergir do que
 * o relatorio de comissao paga. Comissao corrigida no evento financeiro da OS ja
 * chega corrigida em `valor_comissao` (gatilho `tg_espelhar_comissao_ajustada`);
 * `valor_comissao_manual` so diz que houve a correcao.
 *
 * Junto vao os corealizadores: quando duas pessoas dividem o mesmo servico, a
 * linha precisa dizer com quem foi dividido e quanto coube a cada um, senao o
 * valor cheio na coluna e a comissao pela metade parecem contradicao.
 */
const SELECT = `
  ordemservicoid,
  servicoid,
  observacao_execucao,
  valor_base,
  valor_comissao,
  valor_comissao_manual,
  item:osservico!inner (
    descricao,
    quantidade,
    precounitario,
    subtotal,
    servico:servicoid ( id, codigo, descricao, gera_comissao ),
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

    /*
     * Os corealizadores de cada servico da pagina.
     *
     * A chave de `osservico_realizador` e composta (OS + servico), e o
     * PostgREST nao filtra por tupla — entao a busca vai pelos ids de OS da
     * pagina, que sao no maximo `limit`, e o pareamento por servico acontece
     * aqui. Uma consulta a mais por pagina, e so.
     */
    const idsDeOs = [...new Set((data ?? []).map((row) => Number((row as any).ordemservicoid)))].filter(
      Number.isFinite,
    );

    const porServico = new Map<string, Array<Record<string, unknown>>>();
    if (idsDeOs.length) {
      const { data: vinculos, error: erroVinculos } = await supabaseAdmin
        .from("osservico_realizador")
        .select("ordemservicoid, servicoid, usuarioid, valor_base, valor_comissao, valor_comissao_manual, usuario:usuarioid ( id, nome, email )")
        .in("ordemservicoid", idsDeOs);
      if (erroVinculos) throw erroVinculos;

      for (const vinculo of vinculos ?? []) {
        const registro = vinculo as unknown as Record<string, unknown>;
        const chave = `${registro.ordemservicoid}::${registro.servicoid}`;
        porServico.set(chave, [...(porServico.get(chave) ?? []), registro]);
      }
    }

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
        // A flag de hoje, do cadastro do servico. Servico apagado segue o
        // default da coluna, que e gerar comissao.
        geraComissao: (servicoBruto as { gera_comissao?: boolean } | null)?.gera_comissao !== false,
        quantidade: num(item?.quantidade) || 1,
        valorUnitario: num(item?.precounitario),
        subtotal: num(item?.subtotal),
        observacao: texto(linha.observacao_execucao),
        // O que este realizador ganhou nesta linha, como esta gravado.
        valorBase: num(linha.valor_base),
        valorComissao: num(linha.valor_comissao),
        comissaoAjustada: linha.valor_comissao_manual != null,
        realizadores: (porServico.get(`${linha.ordemservicoid}::${linha.servicoid}`) ?? []).map((vinculo) => {
          const usuario = primeiro(vinculo.usuario);
          return {
            usuarioId: String(vinculo.usuarioid ?? ""),
            nome: texto(usuario?.nome) || texto(usuario?.email) || "Realizador",
            valorBase: num(vinculo.valor_base),
            valorComissao: num(vinculo.valor_comissao),
            comissaoAjustada: vinculo.valor_comissao_manual != null,
            euMesmo: String(vinculo.usuarioid ?? "") === userId,
          };
        }),
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
