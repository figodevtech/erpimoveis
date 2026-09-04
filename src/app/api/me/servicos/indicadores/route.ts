// src/app/api/me/servicos/indicadores/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  chaveComissaoDeServico,
  comissoesConfirmadas,
  erroInterno,
  getMeUserId,
  isNextResponse,
  num,
  parsePeriodo,
  STATUS_OS_FINALIZADAS,
} from "../../_helpers";

/**
 * Totais da aba "Serviços realizados".
 *
 * Vive fora de /api/me/servicos pelo mesmo motivo dos irmãos: os números cobrem
 * o período inteiro, não a página.
 *
 * Os valores somam o **subtotal cheio do serviço**, o mesmo número que a coluna
 * "Valor" da lista mostra em cada linha. Serviço dividido com outro realizador
 * entra inteiro para os dois: o card responde "quanto de serviço passou pelas
 * minhas mãos", não "qual a minha fatia" — e assim card e tabela somam igual.
 *
 * A comissão é a exceção, e tem de ser: ela sai de `valor_comissao` gravado no
 * vínculo, que em serviço dividido já é a fatia desta pessoa. Somar o valor
 * cheio ali pagaria o mesmo trabalho duas vezes no papel.
 */
const TETO_SERVICOS = 2000;

const SELECT = `
  ordemservicoid,
  servicoid,
  valor_comissao,
  item:osservico!inner (
    subtotal,
    servico:servicoid ( gera_comissao ),
    ordem:ordemservicoid!inner ( id, status, is_deleted, execucao_fim_em )
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

    // Mesmo recorte da lista, e é o que faz os cards baterem com a tabela.
    let query = supabaseAdmin
      .from("osservico_realizador")
      .select(SELECT, { count: "exact" })
      .eq("usuarioid", userId)
      .eq("item.ordem.is_deleted", false)
      .in("item.ordem.status", STATUS_OS_FINALIZADAS)
      .not("item.ordem.execucao_fim_em", "is", null);

    if (periodo.inicio) query = query.gte("item.ordem.execucao_fim_em", periodo.inicio);
    if (periodo.fimExclusivo) query = query.lt("item.ordem.execucao_fim_em", periodo.fimExclusivo);

    const { data, error, count } = await query.range(0, TETO_SERVICOS - 1);
    if (error) throw error;

    const linhas = data ?? [];
    const totalServicos = count ?? linhas.length;

    // A comissão se divide em duas leituras: a que já virou evento, e a que
    // ainda depende de a OS andar. Somar tudo junto faz o total não bater com
    // o que de fato foi gerado — e é o total que a pessoa confere.
    const confirmadas = await comissoesConfirmadas(
      linhas.map((registro) => Number((registro as Record<string, unknown>).ordemservicoid)),
    );

    let valorTotal = 0;
    let valorComComissao = 0;
    let comissao = 0;
    let comissaoConfirmada = 0;

    for (const registro of linhas) {
      const linha = registro as unknown as Record<string, unknown>;
      const item = primeiro(linha.item);
      const servico = primeiro(item?.servico);

      const valor = num(item?.subtotal);
      valorTotal += valor;
      // Sempre o que esta gravado no vinculo: em servico dividido ja e a fatia
      // desta pessoa, entao somar as linhas nao conta a comissao de ninguem duas
      // vezes.
      const daLinha = num(linha.valor_comissao);
      comissao += daLinha;
      if (
        confirmadas.has(
          chaveComissaoDeServico(
            Number(linha.ordemservicoid),
            Number(linha.servicoid),
            userId,
          ),
        )
      ) {
        comissaoConfirmada += daLinha;
      }

      // Serviço sem cadastro vinculado segue o default da coluna: gera comissão.
      if ((servico as { gera_comissao?: boolean } | null)?.gera_comissao !== false) {
        valorComComissao += valor;
      }
    }

    return NextResponse.json(
      {
        servicos: totalServicos,
        valorTotal,
        valorComComissao,
        comissao,
        comissaoConfirmada,
        parcial: totalServicos > linhas.length,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return erroInterno("GET /api/me/servicos/indicadores", e);
  }
}
