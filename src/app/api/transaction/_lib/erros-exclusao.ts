/**
 * Traduz a recusa do BANCO ao excluir uma transação.
 *
 * Duas constraints impedem exclusões legítimas hoje, e as duas chegam ao usuário
 * como "Erro ao deletar transação." com status 500 — que diz que o sistema
 * quebrou, quando na verdade o banco está protegendo um vínculo que existe. A
 * pessoa fica sem saber que existe um caminho: excluir o estorno.
 *
 * 409 e não 500 de propósito: é conflito com o estado atual do registro, não
 * defeito nosso. Mesmo raciocínio das demais recusas de regra da rota.
 *
 * Vale para a exclusão de uma linha e para a de um lote — no lote elas deixam de
 * ser raras, porque uma limpeza grande quase sempre encosta numa transação
 * conciliada.
 */

/** O formato de erro que o supabase-js devolve. */
export interface ErroDoBanco {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

export interface RecusaDeExclusao {
  status: 409 | 500;
  mensagem: string;
}

/** Constraint e FK vão em `message` ou em `details`, dependendo do caminho. */
function textoDoErro(erro: ErroDoBanco | null | undefined): string {
  return [erro?.message, erro?.details, erro?.hint]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function traduzirErroExclusao(
  erro: ErroDoBanco | null | undefined,
): RecusaDeExclusao {
  const codigo = String(erro?.code ?? "");
  const texto = textoDoErro(erro);

  /*
   * Movimento do extrato conciliado com esta transação.
   *
   * `ofx_movimento.transacao_id` é ON DELETE SET NULL, e
   * `ofx_movimento_conciliado_tem_transacao_check` exige que movimento
   * CONCILIADO tenha transação. O gatilho `trg_desconciliar_transacao_excluida`
   * devolve o movimento para pendente antes do SET NULL, então este caso só
   * aparece num banco em que a migration 20260930150000 ainda não foi aplicada.
   */
  if (codigo === "23514" && texto.includes("ofx_movimento_conciliado_tem_transacao")) {
    return {
      status: 409,
      mensagem:
        "Esta transação está conciliada com um movimento do extrato bancário e o banco recusou desfazer a conciliação. Falta aplicar a atualização do banco que permite essa exclusão.",
    };
  }

  /*
   * A transação já foi estornada, e o lançamento de estorno aponta para ela.
   *
   * `transacao.estorno_transacao_id` referencia `transacao(id)` com RESTRICT.
   * Quem tem de sair primeiro é o estorno; apagar o original deixaria o estorno
   * apontando para o nada.
   */
  if (codigo === "23503" && texto.includes("estorno_transacao_id")) {
    return {
      status: 409,
      mensagem:
        "Esta transação já foi estornada, e o lançamento de estorno aponta para ela. Exclua o estorno primeiro.",
    };
  }

  // Outra FK segurando a linha. Sem saber qual, o que dá para dizer com verdade
  // é que existe vínculo — melhor do que "erro ao deletar".
  if (codigo === "23503") {
    return {
      status: 409,
      mensagem:
        "Há registros ligados a esta transação que impedem a exclusão.",
    };
  }

  // O que não for recusa conhecida continua sendo defeito, e continua 500 com a
  // mensagem original — perder o texto do banco atrapalharia o diagnóstico.
  return {
    status: 500,
    mensagem: erro?.message ?? "Erro ao deletar transação.",
  };
}
