import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * A ponte entre a decisão que veio da tela e a RPC atômica que a executa.
 *
 * Nenhuma regra financeira mora aqui: a função valida a forma do que chegou,
 * chama `conciliar_movimento_ofx` e traduz o erro do banco para uma frase em
 * português. Baixa, baixa parcial e criação continuam sendo do SQL, onde a
 * operação inteira cai junto se qualquer etapa falhar.
 */

export type AcaoDecisao = "VINCULAR" | "LIQUIDAR" | "CRIAR" | "IGNORAR";

const ACOES = new Set<AcaoDecisao>(["VINCULAR", "LIQUIDAR", "CRIAR", "IGNORAR"]);

/** As ações que mexem em transação existente, e por isso exigem permissão de edição. */
export const ACOES_DE_EDICAO = new Set<AcaoDecisao>(["VINCULAR", "LIQUIDAR"]);

export interface NovaTransacao {
  descricao?: string | null;
  tipo?: string | null;
  categoria?: string | null;
  categoria_id?: number | null;
  plano_de_conta_id?: number | null;
  centro_custo_id?: number | null;
  cliente_id?: number | null;
  fornecedor_id?: number | null;
  nomepagador?: string | null;
  cpfcnpjpagador?: string | null;
  competencia_em?: string | null;
}

export interface Decisao {
  fingerprint?: string;
  movimentoId?: number;
  acao: AcaoDecisao;
  transacaoId?: number | null;
  /** Quanto está sendo baixado. Ausente na baixa integral. */
  valor?: number | null;
  metodopagamento?: string | null;
  planoContaId?: number | null;
  centroCustoId?: number | null;
  nova?: NovaTransacao | null;
  observacao?: string | null;
}

export interface ResultadoDecisao {
  movimentoId: number;
  fingerprint: string | null;
  ok: boolean;
  acao: AcaoDecisao;
  transacaoId: number | null;
  erro: string | null;
}

function inteiroOuNulo(valor: unknown): number | null {
  if (valor == null || valor === "") return null;
  const numero = Number(valor);
  return Number.isSafeInteger(numero) && numero > 0 ? numero : null;
}

/**
 * Normaliza uma decisão vinda do corpo da requisição.
 *
 * Devolve `null` quando a forma não fecha — ação desconhecida, baixa sem
 * título, valor negativo. Recusar aqui evita chamar a RPC só para receber de
 * volta o mesmo "não". */
export function normalizarDecisao(bruta: any): Decisao | null {
  if (!bruta || typeof bruta !== "object") return null;

  const acao = String(bruta.acao ?? "").toUpperCase() as AcaoDecisao;
  if (!ACOES.has(acao)) return null;

  const transacaoId = inteiroOuNulo(bruta.transacaoId);
  if ((acao === "VINCULAR" || acao === "LIQUIDAR") && transacaoId == null) return null;

  let valor: number | null = null;
  if (bruta.valor != null && bruta.valor !== "") {
    const numero = Number(bruta.valor);
    if (!Number.isFinite(numero) || numero <= 0) return null;
    valor = Math.round(numero * 100) / 100;
  }

  const fingerprint =
    typeof bruta.fingerprint === "string" && bruta.fingerprint.trim()
      ? bruta.fingerprint.trim()
      : undefined;

  return {
    fingerprint,
    movimentoId: inteiroOuNulo(bruta.movimentoId) ?? undefined,
    acao,
    transacaoId,
    valor,
    metodopagamento:
      typeof bruta.metodopagamento === "string" && bruta.metodopagamento.trim()
        ? bruta.metodopagamento.trim().toUpperCase()
        : null,
    planoContaId: inteiroOuNulo(bruta.planoContaId),
    centroCustoId: inteiroOuNulo(bruta.centroCustoId),
    nova: bruta.nova && typeof bruta.nova === "object" ? (bruta.nova as NovaTransacao) : null,
    observacao:
      typeof bruta.observacao === "string" && bruta.observacao.trim()
        ? bruta.observacao.trim().slice(0, 500)
        : null,
  };
}

/** Traduz a recusa do banco para uma frase que serve na tela. */
function mensagemDoErro(error: { code?: string; message?: string }): string {
  if (error.code === "23505") {
    // A RPC usa este código tanto para "já resolvido" quanto para o índice que
    // impede duas linhas do extrato apontarem para a mesma transação.
    return error.message?.includes("já")
      ? error.message
      : "Esta transação já responde por outro movimento do extrato.";
  }
  if (error.code === "22023" || error.code === "P0002") {
    return error.message ?? "Não foi possível conciliar o movimento.";
  }
  if (error.code === "23503") {
    return "Plano de conta, centro de custo ou cadastro informado não existe.";
  }
  return "Não foi possível conciliar o movimento.";
}

/** Executa uma decisão. A atomicidade é da RPC; aqui só se relata o resultado. */
export async function aplicarDecisao(
  movimentoId: number,
  decisao: Decisao,
  usuarioId: string | null,
): Promise<ResultadoDecisao> {
  const { data, error } = await supabaseAdmin.rpc("conciliar_movimento_ofx", {
    p_movimento_id: movimentoId,
    p_acao: decisao.acao,
    p_transacao_id: decisao.transacaoId ?? null,
    p_valor: decisao.valor ?? null,
    p_metodopagamento: decisao.metodopagamento ?? null,
    p_plano_de_conta_id: decisao.planoContaId ?? null,
    p_centro_custo_id: decisao.centroCustoId ?? null,
    p_nova: decisao.nova ?? null,
    p_usuario: usuarioId,
    p_observacao: decisao.observacao ?? null,
  });

  if (error) {
    return {
      movimentoId,
      fingerprint: decisao.fingerprint ?? null,
      ok: false,
      acao: decisao.acao,
      transacaoId: null,
      erro: mensagemDoErro(error),
    };
  }

  return {
    movimentoId,
    fingerprint: decisao.fingerprint ?? null,
    ok: true,
    acao: decisao.acao,
    transacaoId: (data as any)?.transacao_id ?? null,
    erro: null,
  };
}
