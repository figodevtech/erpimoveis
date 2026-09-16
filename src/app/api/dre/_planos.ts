// src/app/api/dre/_planos.ts
//
// Conta do plano de contas de cada transação avulsa, com o destino como a tela
// de planos de conta o explica.
//
// Fica aqui, e não dentro de uma rota, porque duas telas perguntam a mesma
// coisa: o detalhamento da linha (qual conta trouxe este lançamento) e as fontes
// da linha (quais contas caem nela). Quando a mesma regra existe em dois
// arquivos, elas divergem na primeira correção.

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { LinhaVisaoConta } from "@/app/api/tipos/planos-de-conta/_mapa";

export type PlanoDoLancamento = {
  id: number;
  codigo: string | null;
  nome: string;
  grupo: string;
  /** A conta tem linha própria; `false` é seguir o grupo (ou o mapeamento antigo). */
  linhaPropria: boolean;
};

/** A visão inteira do cadastro, do jeito que a soma resolve. */
export async function carregarVisaoDeContas() {
  const { data, error } = await supabaseAdmin.rpc("plano_contas_visao", { p_competencia: null });
  if (error) throw error;
  return (data ?? []) as LinhaVisaoConta[];
}

export function planoDaVisao(linha: LinhaVisaoConta): PlanoDoLancamento {
  return {
    id: Number(linha.conta_id),
    codigo: linha.conta_codigo ?? null,
    nome: linha.conta_nome,
    grupo: linha.grupo_nome,
    linhaPropria: Boolean(linha.classificacao_especifica),
  };
}

/**
 * Conta de cada transação, em lotes: centenas de ids numa query string só
 * estouram o limite da URL.
 */
export async function contasDasTransacoes(ids: number[]) {
  const contaDaTransacao = new Map<number, number>();
  for (let inicio = 0; inicio < ids.length; inicio += 200) {
    const { data, error } = await supabaseAdmin
      .from("transacao")
      .select("id, plano_de_conta_id")
      .in("id", ids.slice(inicio, inicio + 200));
    if (error) throw error;
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      if (row.plano_de_conta_id != null) contaDaTransacao.set(Number(row.id), Number(row.plano_de_conta_id));
    }
  }
  return contaDaTransacao;
}

/** Transação -> plano de conta, já resolvido para o que a tela mostra. */
export async function planosDasTransacoes(ids: number[]) {
  const resultado = new Map<number, PlanoDoLancamento>();
  if (!ids.length) return resultado;

  const contaDaTransacao = await contasDasTransacoes(ids);
  if (!contaDaTransacao.size) return resultado;

  const visao = await carregarVisaoDeContas();
  const contas = new Map(visao.map((l) => [Number(l.conta_id), l]));

  for (const [transacaoId, contaId] of contaDaTransacao) {
    const conta = contas.get(contaId);
    if (conta) resultado.set(transacaoId, planoDaVisao(conta));
  }
  return resultado;
}
