export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { requireFinanceiroDelete } from "@/app/api/_authz/perms";
import { classificarExclusaoEmLote } from "@/app/api/transaction/_lib/classificar-exclusao";
import {
  excluirPagamentoMultiplo,
  excluirTransacao,
  revalidarStatusOrdem,
  revalidarStatusVenda,
} from "@/app/api/transaction/_lib/exclusao";
import { analisarImpacto } from "@/app/api/transaction/_lib/impacto-exclusao";
import { lerIdsDoCorpo } from "@/app/api/transaction/_lib/lote-exclusao";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { exigirAcessoATransacao } from "../_lib/autoria";

/**
 * Exclui várias transações de uma vez.
 *
 * NÃO É TUDO OU NADA, pela mesma razão da baixa em lote: cada exclusão é atômica
 * em si, e desfazer as que já passaram significaria recriar transação apagada. A
 * resposta diz exatamente o que saiu, o que foi pulado e o que falhou.
 *
 * O plano é RECALCULADO aqui, ignorando o que a tela mandou. A prévia é
 * informação, não contrato: entre ver e confirmar, outra pessoa pode ter baixado
 * ou estornado uma linha, e aí a classificação dela mudou.
 */

/** Traduz o código do Postgres que escapar até aqui. */
function traduzirEstorno(codigo: string | undefined, mensagem: string | undefined): string {
  if (codigo === "P0002") return "Não encontrada.";
  return mensagem ?? "Não foi possível tirar do fluxo de caixa.";
}

export async function POST(req: Request) {
  try {
    await requireFinanceiroDelete();

    const sessao = await auth().catch(() => null);
    const deletedBy = (sessao?.user as { id?: string } | undefined)?.id ?? null;

    const corpo = await req.json().catch(() => ({}));
    const ids = lerIdsDoCorpo((corpo as { ids?: unknown })?.ids);
    await exigirAcessoATransacao(ids);

    const impactos = await analisarImpacto(ids);
    const { itens, plano } = classificarExclusaoEmLote(ids, impactos);

    const excluidos: number[] = [];
    const estornados: number[] = [];
    const falhas: Array<{ id: number; erro: string }> = [];

    // Quem não é executável nunca chega ao laço: volta como pulado, com o motivo
    // que a prévia já mostrava.
    const pulados = itens
      .filter((item) => item.classificacao === "BLOQUEADO")
      .map((item) => ({ id: item.id, motivo: item.motivo }));

    /*
     * Os documentos tocados, para uma revalidação só no fim.
     *
     * Cada exclusão dispararia `recalcular_status_financeiro_os` de novo, e cada
     * recálculo trava a OS. Em quarenta pagamentos da mesma ordem isso vira uma
     * fila. O gatilho do banco continua cobrindo cada linha; o que se evita aqui
     * é a repetição explícita que a rota individual faz.
     */
    const ordensTocadas = new Set<number>();
    const vendasTocadas = new Set<number>();

    const jaRemovidos = new Set<number>();

    for (const passo of plano) {
      if (jaRemovidos.has(passo.alvo)) continue;

      const vinculos = impactos.get(passo.alvo)?.vinculos;
      if (vinculos?.ordemservicoId != null) ordensTocadas.add(vinculos.ordemservicoId);
      if (vinculos?.vendaId != null) vendasTocadas.add(vinculos.vendaId);

      /*
       * Estornar e excluir, nesta ordem, é a operação mais destrutiva daqui.
       *
       * O estorno devolve o título para em aberto; a exclusão o apaga em
       * seguida, e com ele a dívida. Falhando o estorno, a exclusão nem é
       * tentada — seria recusada pela trava de liquidada de qualquer forma, e
       * com uma mensagem que não explica o que houve.
       */
      if (passo.acao === "ESTORNAR_E_EXCLUIR") {
        const { error: erroDoEstorno } = await supabaseAdmin.rpc("estornar_baixa_transacao", {
          p_transacao_id: passo.alvo,
          p_estornado_por: deletedBy,
        });

        if (erroDoEstorno) {
          falhas.push({
            id: passo.alvo,
            erro: traduzirEstorno(erroDoEstorno.code, erroDoEstorno.message),
          });
          continue;
        }

        estornados.push(passo.alvo);
      }

      const resultado =
        passo.acao === "EXCLUIR_PAGAMENTO_MULTIPLO"
          ? await excluirPagamentoMultiplo(passo.alvo, { deletedBy })
          : await excluirTransacao(passo.alvo, { deletedBy, revalidarDocumento: false });

      /*
       * O 404 conta como sucesso, e é a decisão menos óbvia deste arquivo.
       *
       * É a segunda perna de uma transferência que o CASCADE já levou, a filha
       * de uma baixa parcial, ou a linha que outra pessoa apagou entre a prévia
       * e o confirmar. Em todos, o usuário pediu que aquilo não existisse mais —
       * e não existe. Chamar de falha faria a tela pedir para tentar de novo uma
       * coisa que já está feita.
       *
       * Numa baixa parcial há ainda o caso de o próprio estorno já ter apagado a
       * linha: a exclusão logo depois chega a um id que não está mais lá.
       */
      if (resultado.ok || resultado.status === 404) {
        for (const id of passo.cobre) {
          jaRemovidos.add(id);
          excluidos.push(id);
        }
        continue;
      }

      falhas.push({ id: passo.alvo, erro: resultado.erro });
    }

    /*
     * Uma revalidação por documento, agora que o lote acabou.
     *
     * Falha aqui não invalida o que já saiu: as transações foram excluídas de
     * verdade, e o gatilho do banco já ajustou o status a cada linha. Esta
     * chamada é a rede de segurança da rota individual, e vira log.
     */
    for (const osId of ordensTocadas) {
      try {
        await revalidarStatusOrdem(osId);
      } catch (erro) {
        console.warn(`Falha ao revalidar o status da OS #${osId} após o lote`, erro);
      }
    }
    for (const vendaId of vendasTocadas) {
      try {
        await revalidarStatusVenda(vendaId);
      } catch (erro) {
        console.warn(`Falha ao revalidar o status da venda #${vendaId} após o lote`, erro);
      }
    }

    return NextResponse.json({
      data: { excluidos, estornados, pulados, falhas },
    });
  } catch (error: unknown) {
    const erro = error as { statusCode?: number; message?: string };
    const statusAutorizacao = Number(erro?.statusCode);
    const status =
      statusAutorizacao === 401 || statusAutorizacao === 403
        ? statusAutorizacao
        : erro?.message?.includes("Informe") ||
            erro?.message?.includes("no máximo") ||
            erro?.message?.includes("identificador")
          ? 400
          : 500;

    return NextResponse.json(
      { error: erro?.message ?? "Erro ao excluir as transações." },
      { status },
    );
  }
}
