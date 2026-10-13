import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { exigirAcessoATransacao, type ContextoDeAutoria } from "@/app/api/transaction/_lib/autoria";

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
  /**
   * Conciliação N:1 — as linhas do extrato que respondem juntas por um
   * lançamento só, quando o banco quebra em duas o que a empresa lançou numa.
   *
   * `grupo` são as fingerprints, e serve à importação, onde os movimentos ainda
   * não têm id. `movimentoIds` serve à importação já gravada. Uma decisão de uma
   * linha só chega com os dois vazios — é o mesmo caminho, com um elemento.
   */
  grupo?: string[] | null;
  movimentoIds?: number[] | null;
}

export interface ResultadoDecisao {
  /** O primeiro do ato. `movimentoIds` tem todos. */
  movimentoId: number;
  movimentoIds: number[];
  fingerprint: string | null;
  fingerprints: string[];
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
 * Teto do tamanho de um grupo.
 *
 * Não há razão de negócio para um lançamento responder por dezenas de linhas do
 * extrato, e o limite impede que um corpo de requisição peça uma trava sobre
 * meia tabela de movimentos.
 */
const MAXIMO_POR_GRUPO = 50;

function textosUnicos(valor: unknown): string[] | null {
  if (!Array.isArray(valor)) return null;
  const limpos = valor
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, MAXIMO_POR_GRUPO);
  const unicos = [...new Set(limpos)];
  return unicos.length ? unicos : null;
}

function inteirosUnicos(valor: unknown): number[] | null {
  if (!Array.isArray(valor)) return null;
  const limpos = valor
    .map((item) => inteiroOuNulo(item))
    .filter((item): item is number => item != null)
    .slice(0, MAXIMO_POR_GRUPO);
  const unicos = [...new Set(limpos)];
  return unicos.length ? unicos : null;
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

  /*
   * O grupo entra pela própria fingerprint junto: uma decisão de duas linhas
   * chega com as duas, e o dono da decisão não é caso especial. Assim a rota
   * resolve o conjunto inteiro de uma vez, sem ter que lembrar de somar o dono
   * aos outros.
   */
  const grupo = textosUnicos(bruta.grupo);
  const movimentoIds = inteirosUnicos(bruta.movimentoIds);

  return {
    fingerprint,
    grupo,
    movimentoIds,
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

/**
 * As linhas do extrato que esta decisão resolve, pelas fingerprints.
 *
 * O grupo já inclui a própria — quem monta a decisão manda o conjunto inteiro —,
 * então uma decisão de uma linha só cai na fingerprint sozinha e o resto do
 * caminho não precisa distinguir os dois casos.
 */
export function chavesDaDecisao(decisao: Decisao): string[] {
  if (decisao.grupo?.length) return decisao.grupo;
  return decisao.fingerprint ? [decisao.fingerprint] : [];
}

/** Os ids das linhas que esta decisão resolve, numa importação já gravada. */
export function idsDaDecisao(decisao: Decisao): number[] {
  if (decisao.movimentoIds?.length) return decisao.movimentoIds;
  return decisao.movimentoId ? [decisao.movimentoId] : [];
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

/**
 * Executa uma decisão. A atomicidade é da RPC; aqui só se relata o resultado.
 *
 * `movimentoIds` é o ato inteiro: uma linha no caso de sempre, várias quando o
 * banco quebrou em duas o que o ERP lançou numa só. A RPC confere a soma e
 * grava as linhas todas de uma vez — se qualquer uma falhar, nenhuma é marcada.
 */
export async function aplicarDecisao(
  movimentoIds: number[],
  decisao: Decisao,
  usuarioId: string | null,
  contexto?: ContextoDeAutoria,
): Promise<ResultadoDecisao> {
  await validarAcessoDasDecisoes([decisao], contexto);
  const fingerprints = decisao.grupo?.length
    ? decisao.grupo
    : decisao.fingerprint
      ? [decisao.fingerprint]
      : [];

  const { data, error } = await supabaseAdmin.rpc("conciliar_movimentos_ofx", {
    p_movimento_ids: movimentoIds,
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
      movimentoId: movimentoIds[0] ?? 0,
      movimentoIds,
      fingerprint: decisao.fingerprint ?? null,
      fingerprints,
      ok: false,
      acao: decisao.acao,
      transacaoId: null,
      erro: mensagemDoErro(error),
    };
  }

  return {
    movimentoId: movimentoIds[0] ?? 0,
    movimentoIds,
    fingerprint: decisao.fingerprint ?? null,
    fingerprints,
    ok: true,
    acao: decisao.acao,
    transacaoId: (data as any)?.transacao_id ?? null,
    erro: null,
  };
}

/** Confere o envio inteiro antes de importar ou conciliar qualquer linha. */
export async function validarAcessoDasDecisoes(
  decisoes: Decisao[],
  contexto?: ContextoDeAutoria,
): Promise<void> {
  const ids = decisoes.flatMap((decisao) =>
    ACOES_DE_EDICAO.has(decisao.acao) && decisao.transacaoId != null ? [decisao.transacaoId] : []);
  if (ids.length) await exigirAcessoATransacao(ids, contexto);
}
