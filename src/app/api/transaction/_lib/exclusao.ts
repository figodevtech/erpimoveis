import { calculateFinancialTotal } from "@/lib/financial-surcharge";
import { valorDeFace } from "@/lib/financeiro/transacao";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

import { attachmentPathsForTransactions, removeAttachmentObjects } from "./anexos";
import { traduzirErroExclusao } from "./erros-exclusao";
import { type ContextoDeAutoria } from "./autoria";
import { exigirAcessoAOperacao, exigirAcessoAPagamentoMultiplo } from "./autoria-afetadas";

/**
 * Excluir uma transação, sem HTTP no meio.
 *
 * Era o corpo do `DELETE /api/transaction/[id]`. Saiu de lá inteiro, sem uma
 * regra mudada, porque a exclusão em lote precisa da mesma árvore de decisão —
 * e mantê-la em dois lugares criaria duas verdades sobre o que é excluir uma
 * transação. Já aconteceu antes com a análise de impacto, que hoje repete a
 * mesma triagem com frases que já divergiram da rota.
 *
 * A rota virou adaptador: mapeia `efeito` para 204 ou para o JSON de sempre.
 */

/** O que a exclusão fez. Cada um vira uma resposta HTTP diferente na rota. */
export type ResultadoExclusao =
  | { ok: true; efeito: "TRANSFERENCIA" }
  | { ok: true; efeito: "SIMPLES" }
  | { ok: true; efeito: "LANCAMENTO"; resumo: unknown }
  | { ok: true; efeito: "ADIANTAMENTO_DESFEITO"; titulosRevertidos: number }
  | { ok: false; status: 404 | 409 | 500; erro: string };

export interface OpcoesDeExclusao {
  /** Quem está excluindo. As RPCs registram na trilha. */
  deletedBy: string | null;
  contexto?: ContextoDeAutoria;
  /**
   * Recalcular o status da OS ou da venda ao final?
   *
   * Ligado por padrão, que é o comportamento da exclusão individual. O lote
   * desliga e revalida uma vez por documento no fim: o recálculo toma
   * `pg_advisory_xact_lock` na OS, e repeti-lo por linha faz quarenta exclusões
   * da mesma ordem se enfileirarem umas atrás das outras. O gatilho
   * `trg_recalcular_status_financeiro_os` continua disparando de qualquer forma;
   * o que se evita aqui é a repetição explícita.
   */
  revalidarDocumento?: boolean;
}

function toCents(value: unknown) {
  const number = Number(String(value ?? 0).replace(",", "."));
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

export async function revalidarStatusOrdem(osId: number) {
  const { error } = await supabaseAdmin.rpc("recalcular_status_financeiro_os", {
    p_ordemservicoid: osId,
  });
  if (error) throw error;
}

export async function revalidarStatusVenda(vendaId: number) {
  const { data: venda, error } = await supabaseAdmin
    .from("venda")
    .select("id, valortotal, status, acrescimo_financeiro_tipo, acrescimo_financeiro_valor")
    .eq("id", vendaId)
    .maybeSingle();
  if (error || !venda) throw error ?? new Error("Venda não encontrada.");

  const { data: pagamentos, error: pagamentosError } = await supabaseAdmin
    .from("transacao")
    .select("valor, valor_acrescimos")
    .eq("vendaid", vendaId)
    .eq("tipo", "RECEITA")
    .eq("is_deleted", false);
  if (pagamentosError) throw pagamentosError;

  const totalDevido = toCents(calculateFinancialTotal(
    venda.valortotal,
    venda.acrescimo_financeiro_tipo,
    venda.acrescimo_financeiro_valor,
  ));
  // Mesma regra da OS: acrescimo e do pagamento, nao do documento.
  const totalPago = (pagamentos ?? []).reduce(
    (total, pagamento) => total + toCents(valorDeFace(pagamento)),
    0,
  );
  const status = String(venda.status ?? "").toUpperCase();

  if (["CONCLUIDO", "FINALIZADA"].includes(status) && totalPago < totalDevido) {
    const { error: updateError } = await supabaseAdmin
      .from("venda")
      .update({ status: "PAGAMENTO", updatedat: new Date().toISOString() })
      .eq("id", vendaId);
    if (updateError) throw updateError;
  }
}

export async function excluirTransacao(
  id: number,
  { deletedBy, revalidarDocumento = true, contexto }: OpcoesDeExclusao,
): Promise<ResultadoExclusao> {
  await exigirAcessoAOperacao([id], "EXCLUIR", contexto);
  /*
   * O select NÃO filtra `is_deleted`, e isso é como sempre foi.
   *
   * Diverge do `delete-impact`, que filtra e devolveria 404 para uma linha já
   * soft-deletada (o estado em que `desfazer_adiantamento` deixa a antecipação).
   * Consertar aqui misturaria correção com a extração; fica registrado.
   */
  const { data: transaction, error: transactionError } = await supabaseAdmin
    .from("transacao")
    .select("id, tipo, pendente, ordemservicoid, vendaid, evento_financeiro_id, lancamento_id, adiantamento_id, eh_adiantamento, transferencia_id")
    .eq("id", id)
    .maybeSingle();
  if (transactionError) throw transactionError;
  if (!transaction) {
    return { ok: false, status: 404, erro: "Transação não encontrada." };
  }

  /*
   * Transferência entre contas: excluir uma perna exclui a operação inteira.
   *
   * Vem antes da trava de "liquidada" porque as duas pernas nascem liquidadas,
   * e a trava mandaria tirar do fluxo de caixa primeiro — conselho que não se
   * aplica aqui: não há baixa a desfazer, há uma transferência a cancelar.
   *
   * Meia exclusão seria pior que nenhuma: sobraria uma conta com o dinheiro
   * saído e nenhuma com ele entrado. Por isso quem é apagado é o registro da
   * operação, e a FK `ON DELETE CASCADE` leva as duas pernas junto, no mesmo
   * comando.
   */
  if (transaction.transferencia_id != null) {
    const { data: pernas } = await supabaseAdmin
      .from("transacao")
      .select("id")
      .eq("transferencia_id", transaction.transferencia_id);

    const ids = (pernas ?? []).map((p: { id: number }) => Number(p.id));
    const attachmentPaths = await attachmentPathsForTransactions(
      ids.length > 0 ? ids : [id],
    );

    const { error: transferenciaError } = await supabaseAdmin
      .from("transacao_transferencia")
      .delete()
      .eq("id", transaction.transferencia_id);

    if (transferenciaError) {
      // Recusa do banco tem mensagem própria; só o que não for recusa
      // conhecida continua subindo como defeito.
      const recusa = traduzirErroExclusao(transferenciaError);
      return { ok: false, status: recusa.status, erro: recusa.mensagem };
    }

    try {
      await removeAttachmentObjects(attachmentPaths);
    } catch (storageError) {
      console.warn("Falha ao limpar anexos da transferência excluída", storageError);
    }

    return { ok: true, efeito: "TRANSFERENCIA" };
  }

  /*
   * Boleto de despesas da OS: excluir uma parcela desfaz o lançamento inteiro.
   *
   * O boleto do terceirizado é um compromisso só. Tirar uma parcela dele
   * deixaria as despesas de serviço quitadas por um valor que ninguém mais
   * deve — e, se fosse a última, deixaria despesas marcadas como lançadas sem
   * lançamento nenhum atrás delas.
   *
   * Vem antes da trava de "liquidada" de propósito. Aquela trava é por linha, e
   * aqui a regra é do grupo: com uma parcela paga, nem as pendentes saem. Quem
   * responde isso é `excluir_lancamento_de_eventos`, que também recusa quando a
   * OS já foi finalizada.
   */
  if (transaction.lancamento_id != null) {
    const { data: parcelas } = await supabaseAdmin
      .from("transacao")
      .select("id")
      .eq("lancamento_id", transaction.lancamento_id);

    const ids = (parcelas ?? []).map((p: { id: number }) => Number(p.id));
    const attachmentPaths = await attachmentPathsForTransactions(
      ids.length > 0 ? ids : [id],
    );

    const { data: resumo, error: lancamentoError } = await supabaseAdmin.rpc(
      "excluir_lancamento_de_eventos",
      { p_id: transaction.lancamento_id, p_deleted_by: deletedBy },
    );

    if (lancamentoError) {
      const status =
        lancamentoError.code === "P0001" ? 409 : lancamentoError.code === "P0002" ? 404 : 500;
      return { ok: false, status, erro: lancamentoError.message };
    }

    try {
      await removeAttachmentObjects(attachmentPaths);
    } catch (storageError) {
      console.warn("Falha ao limpar anexos do lançamento excluído", storageError);
    }

    return { ok: true, efeito: "LANCAMENTO", resumo };
  }

  /*
   * Título liquidado não se exclui.
   *
   * A exclusão apaga o título, não a baixa. Num lançamento de OS ou venda isso
   * passava despercebido porque o documento regera o título; num avulso ou
   * migrado, some a dívida junto com o pagamento — e o saldo do banco sobe
   * sozinho, sem que nada tenha acontecido no mundo. Foi assim que a Demir
   * perdeu um título a pagar de R$ 311,36 já quitado.
   *
   * Tirar do fluxo de caixa é o passo que faltava: desfeito o pagamento, o
   * título volta a em aberto e aí já não há dinheiro para se perder junto.
   *
   * A antecipação é exceção porque ela não é baixa de si mesma: excluí-la é
   * justamente a operação que devolve os títulos, logo abaixo.
   */
  if (transaction.pendente === false && !transaction.eh_adiantamento) {
    return {
      ok: false,
      status: 409,
      erro:
        "Esta transação está liquidada e aparece no fluxo de caixa. Tire-a do fluxo primeiro: o título volta a ficar em aberto, e aí pode ser excluído.",
    };
  }

  /*
   * Antecipação trava a exclusão nas duas pontas.
   *
   * A FK `adiantamento_id` é RESTRICT, então excluir o lançamento da
   * antecipação já falharia — só que com um erro cru de chave estrangeira, que
   * não diz nada a quem está usando. E excluir uma das parcelas passaria, mas
   * deixaria a antecipação cobrindo um valor que ninguém deve.
   */
  if (transaction.eh_adiantamento) {
    const { count } = await supabaseAdmin
      .from("transacao")
      .select("id", { count: "exact", head: true })
      .eq("adiantamento_id", id)
      .eq("is_deleted", false);

    if ((count ?? 0) > 0) {
      // Excluir a antecipação e reabrir os títulos é uma coisa só: metade
      // gravada deixaria título quitado sem origem, ou dinheiro no caixa sem
      // contrapartida. Por isso a operação inteira vive no banco.
      const { data, error: desfazerError } = await supabaseAdmin.rpc(
        "desfazer_adiantamento",
        { p_id: id, p_deleted_by: deletedBy },
      );

      if (desfazerError) {
        const status = desfazerError.code === "P0002" ? 404 : 409;
        return { ok: false, status, erro: desfazerError.message };
      }

      return {
        ok: true,
        efeito: "ADIANTAMENTO_DESFEITO",
        titulosRevertidos: Number(
          (data as { titulos_revertidos?: unknown } | null)?.titulos_revertidos ?? 0,
        ),
      };
    }
  }

  if (transaction.adiantamento_id != null) {
    return {
      ok: false,
      status: 409,
      // "Liquidado" não vale para o modo que mantém os títulos em aberto: ali
      // o título pode estar a receber, esperando o vencimento.
      erro: `Este título faz parte da antecipação #${transaction.adiantamento_id} e não pode ser excluído isoladamente.`,
    };
  }

  const attachmentPaths = await attachmentPathsForTransactions([id]);

  const { data, error } = await supabaseAdmin
    .from("transacao")
    .delete()
    .eq("id", id)
    .select("id");

  if (error) {
    const recusa = traduzirErroExclusao(error);
    return { ok: false, status: recusa.status, erro: recusa.mensagem };
  }

  if (!data || data.length === 0) {
    return { ok: false, status: 404, erro: "Transação não encontrada." };
  }

  const isPagamento = String(transaction.tipo ?? "").toUpperCase() === "RECEITA" &&
    transaction.evento_financeiro_id == null;

  if (isPagamento && revalidarDocumento) {
    if (transaction.ordemservicoid != null) {
      await revalidarStatusOrdem(Number(transaction.ordemservicoid));
    }
    if (transaction.vendaid != null) {
      await revalidarStatusVenda(Number(transaction.vendaid));
    }
  }

  try {
    await removeAttachmentObjects(attachmentPaths);
  } catch (storageError) {
    // A transação e os metadados já foram removidos. O bucket é privado;
    // uma falha de limpeza vira log para reconciliação, não uma falsa falha
    // da exclusão que acabou de ser concluída.
    console.warn("Falha ao limpar anexos da transação excluída", storageError);
  }

  return { ok: true, efeito: "SIMPLES" };
}

/**
 * Desfaz um pagamento múltiplo inteiro.
 *
 * Cópia do corpo de `DELETE /api/pagamento-multiplo/[id]`. O lote precisa dela,
 * e chamar a própria rota HTTP por dentro seria um salto de rede por item — sem
 * contar que o `fetch` para si mesmo precisaria carregar o cookie da sessão.
 */
export async function excluirPagamentoMultiplo(
  id: number,
  { deletedBy, contexto }: { deletedBy: string | null; contexto?: ContextoDeAutoria },
): Promise<ResultadoExclusao> {
  await exigirAcessoAPagamentoMultiplo(id, contexto);
  const { error } = await supabaseAdmin.rpc("excluir_pagamento_multiplo", {
    p_id: id,
    p_deleted_by: deletedBy,
  });

  if (error) {
    // P0001 aqui é a trava de parcela já baixada — pedido inválido, não erro nosso.
    const status = error.code === "P0001" ? 409 : error.code === "P0002" ? 404 : 500;
    return { ok: false, status: status as 404 | 409 | 500, erro: error.message };
  }

  return { ok: true, efeito: "SIMPLES" };
}
