/**
 * A comparação entre o extrato bancário e o financeiro do ERP.
 *
 * Função pura: recebe o movimento e os candidatos já carregados, devolve a
 * classificação e as sugestões. Nada aqui consulta banco, e é por isso que os
 * casos difíceis — líquido diferente do bruto, título parcialmente pago,
 * transferência entre contas — cabem em teste sem infraestrutura.
 *
 * A ORDEM É REGRA DE NEGÓCIO, não detalhe de implementação:
 *
 *   1º  o movimento já está no Fluxo de Caixa?  -> vincular, nada é criado
 *   2º  existe título em aberto que corresponda? -> oferecer a baixa
 *   3º  nada?                                    -> oferecer transação nova
 *
 * Procurar título pendente antes de olhar o Fluxo criaria a duplicidade que
 * este módulo existe para impedir: o mesmo dinheiro contado como baixa de um
 * título e como lançamento que já estava lá.
 */

import {
  antecipadoComLancamento,
  saldoEmAberto,
  tipoEhEntradaDeCaixa,
  valorLiquidoEfetivo,
} from "@/lib/financeiro/transacao";

import { diferencaEmDias, normalizarTexto, reaisParaCentavos, similaridadeDeTexto } from "./normalize";
import { metodoCompativel, textoDoMovimento } from "./payment-method";
import type { OfxMovimento } from "./types";

/** As colunas de `transacao` que a comparação precisa. */
export interface CandidatoTransacao {
  id: number;
  descricao: string | null;
  descricao_pagamento?: string | null;
  nomepagador?: string | null;
  valor: number | string | null;
  valorLiquido?: number | string | null;
  valor_descontos?: number | string | null;
  valor_baixado?: number | string | null;
  tipo: string;
  pendente: boolean;
  abonado?: boolean | null;
  banco_id?: number | null;
  metodopagamento?: string | null;
  /** `data` da transação, em ISO. Em título é vencimento; em liquidada, a baixa. */
  data: string;
  /** Coluna gerada `data_dia` (yyyy-mm-dd). Quando ausente, sai de `data`. */
  data_dia?: string | null;
  vencimento_em?: string | null;
  adiantamento_id?: number | null;
  eh_adiantamento?: boolean | null;
  transferencia_id?: number | null;
  baixa_de_transacao_id?: number | null;
  pagamento_multiplo_id?: number | null;
  ordemservicoid?: number | null;
  vendaid?: number | null;
  cliente?: { nome?: string | null } | null;
  fornecedor?: { nome?: string | null } | null;
}

export type SituacaoMovimento =
  | "MATCH_EXATO"
  | "MATCH_PROVAVEL"
  | "AMBIGUO"
  | "SEM_CORRESPONDENCIA"
  | "REVISAO_MANUAL";

export type AcaoConciliacao =
  | "VINCULAR"
  | "LIQUIDAR"
  | "BAIXA_PARCIAL"
  | "CRIAR"
  | "IGNORAR";

export interface SugestaoMatch {
  transacaoId: number;
  /** FLUXO = movimento já liquidado; TITULO = conta a pagar/receber em aberto. */
  origem: "FLUXO" | "TITULO";
  score: number;
  diferencaEmDias: number;
  /** O movimento cobre só parte do saldo do título. */
  parcial: boolean;
  /** Valor comparado, em centavos: líquido na liquidada, saldo no título. */
  valorCentavos: number;
  descricao: string;
  tipo: string;
  data: string;
  metodopagamento: string | null;
  contraparte: string | null;
  ordemservicoid: number | null;
  vendaid: number | null;
}

export interface AnaliseDeMovimento {
  situacao: SituacaoMovimento;
  score: number;
  sugestoes: SugestaoMatch[];
  acaoSugerida: AcaoConciliacao | null;
  /** Por que o movimento caiu em revisão manual, quando for o caso. */
  observacao: string | null;
}

/** Janela máxima entre o extrato e o vencimento de um título candidato. */
const JANELA_TITULO_EM_DIAS = 15;
/** Janela máxima entre o extrato e um movimento já liquidado. */
const JANELA_FLUXO_EM_DIAS = 3;
/** Abaixo disto o candidato é ruído, não sugestão. */
const SCORE_MINIMO = 60;
/** Diferença que ainda deixa dois candidatos empatados na prática. */
const MARGEM_DE_EMPATE = 5;

function diaDa(candidato: CandidatoTransacao): string {
  if (candidato.data_dia) return candidato.data_dia;
  // O ERP grava `data` com horas que variam conforme o caminho que criou a
  // linha; o dia no fuso da oficina (-03:00) é o mesmo critério de `data_dia`.
  const instante = new Date(candidato.data);
  if (Number.isNaN(instante.getTime())) return "";
  return new Date(instante.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function contraparteDe(candidato: CandidatoTransacao): string | null {
  return (
    candidato.cliente?.nome ??
    candidato.fornecedor?.nome ??
    (candidato.nomepagador ? candidato.nomepagador : null)
  );
}

/** Todo o texto do ERP que pode se parecer com o texto do extrato. */
function textoDoCandidato(candidato: CandidatoTransacao): string {
  return normalizarTexto(
    [candidato.descricao, candidato.descricao_pagamento, contraparteDe(candidato)]
      .filter(Boolean)
      .join(" "),
  );
}

/**
 * O movimento entra ou sai da conta?
 *
 * O sinal de `TRNAMT` é a única fonte: `TRNTYPE` varia demais entre bancos
 * (DEBIT, FEE, XFER, PIX) para servir de sentido.
 */
export function movimentoEhEntrada(movimento: Pick<OfxMovimento, "valorCentavos">): boolean {
  return movimento.valorCentavos > 0;
}

/**
 * O tipo da transação combina com o sentido do movimento?
 *
 * Crédito no extrato só casa com RECEITA ou DEPOSITO; débito, com DESPESA ou
 * SAQUE. Depósito e saque são as pernas de transferência entre contas próprias
 * — elas movem a conta de verdade e precisam conciliar, mesmo não sendo
 * resultado.
 */
function sentidoCombina(movimento: OfxMovimento, candidato: CandidatoTransacao): boolean {
  return tipoEhEntradaDeCaixa(candidato.tipo) === movimentoEhEntrada(movimento);
}

/**
 * A linha liquidada representa dinheiro que passou por esta conta?
 *
 * Título abonado, quitado com crédito do cliente ou antecipado sem repasse fica
 * com `pendente = false` e `banco_id` nulo justamente porque nenhum dinheiro
 * entrou em conta nenhuma. Exigir o banco da importação já os exclui — o teste
 * explícito aqui é para o caso ficar dito, e não deduzido de um `NULL`.
 */
function ehMovimentoDeCaixa(candidato: CandidatoTransacao, bancoId: number): boolean {
  if (candidato.pendente) return false;
  if (candidato.abonado === true) return false;
  if (Number(candidato.banco_id ?? 0) !== bancoId) return false;
  // Título antecipado só moveu a conta quando houve repasse — e aí quem moveu
  // foi a transação filha, que aparece na lista por conta própria.
  if (candidato.adiantamento_id != null && !antecipadoComLancamento(candidato)) return false;
  return true;
}

function bonusDeTexto(movimento: OfxMovimento, candidato: CandidatoTransacao): number {
  const semelhanca = similaridadeDeTexto(textoDoMovimento(movimento), textoDoCandidato(candidato));
  if (semelhanca >= 0.5) return 10;
  if (semelhanca >= 0.25) return 5;
  return 0;
}

function sugestaoDe(
  candidato: CandidatoTransacao,
  origem: "FLUXO" | "TITULO",
  score: number,
  dias: number,
  parcial: boolean,
  valorCentavos: number,
): SugestaoMatch {
  return {
    transacaoId: candidato.id,
    origem,
    score,
    diferencaEmDias: dias,
    parcial,
    valorCentavos,
    descricao: candidato.descricao ?? "",
    tipo: candidato.tipo,
    data: candidato.data,
    metodopagamento: candidato.metodopagamento ?? null,
    contraparte: contraparteDe(candidato),
    ordemservicoid: candidato.ordemservicoid ?? null,
    vendaid: candidato.vendaid ?? null,
  };
}

/**
 * Movimentos já registrados no Fluxo de Caixa que correspondem a esta linha.
 *
 * O valor comparado é `valorLiquidoEfetivo`, NUNCA `transacao.valor`: o extrato
 * mostra o dinheiro que realmente entrou, e numa venda no cartão isso é o bruto
 * menos a taxa. Comparar com o bruto faria toda venda com taxa aparecer como
 * movimento novo — e o usuário criaria a receita em dobro.
 */
export function casarComFluxo(
  movimento: OfxMovimento,
  candidatos: CandidatoTransacao[],
  bancoId: number,
): SugestaoMatch[] {
  const alvo = Math.abs(movimento.valorCentavos);

  const sugestoes: SugestaoMatch[] = [];
  for (const candidato of candidatos) {
    if (!ehMovimentoDeCaixa(candidato, bancoId)) continue;
    if (!sentidoCombina(movimento, candidato)) continue;

    const liquido = reaisParaCentavos(valorLiquidoEfetivo(candidato));
    if (liquido !== alvo) continue;

    const dias = diferencaEmDias(movimento.dataPostagem, diaDa(candidato));
    if (dias > JANELA_FLUXO_EM_DIAS) continue;

    // Mesmo dia é o caso normal: o Fluxo grava a data do pagamento, e o extrato
    // mostra o mesmo dia. Um ou dois dias de diferença acontece com PIX virado
    // e com compensação, e ainda é o mesmo movimento.
    const score = dias === 0 ? 100 : dias === 1 ? 92 : 85;
    sugestoes.push(sugestaoDe(candidato, "FLUXO", score, dias, false, liquido));
  }

  return sugestoes.sort((a, b) => b.score - a.score || a.diferencaEmDias - b.diferencaEmDias);
}

/**
 * Títulos em aberto que o movimento pode estar pagando.
 *
 * Data não precisa bater: título vence num dia e é pago em outro, e é
 * exatamente isso que o score mede. Valor, sim — em centavos exatos, sem
 * tolerância. Valor menor que o saldo é candidato a baixa PARCIAL, que o ERP já
 * sabe fazer; valor maior que o saldo não é candidato nenhum.
 */
export function casarComTitulos(
  movimento: OfxMovimento,
  candidatos: CandidatoTransacao[],
): SugestaoMatch[] {
  const alvo = Math.abs(movimento.valorCentavos);

  const sugestoes: SugestaoMatch[] = [];
  for (const candidato of candidatos) {
    if (!candidato.pendente) continue;
    if (candidato.abonado === true) continue;
    if (!sentidoCombina(movimento, candidato)) continue;

    const saldo = reaisParaCentavos(saldoEmAberto(candidato));
    if (saldo <= 0) continue;
    if (alvo > saldo) continue;

    const dias = diferencaEmDias(movimento.dataPostagem, diaDa(candidato));
    if (dias > JANELA_TITULO_EM_DIAS) continue;

    const parcial = alvo < saldo;

    let score = parcial ? 30 : 60;
    if (dias === 0) score += 30;
    else if (dias <= 1) score += 25;
    else if (dias <= 3) score += 15;
    else if (dias <= 7) score += 5;

    if (metodoCompativel(movimento, candidato.metodopagamento)) score += 10;
    score += bonusDeTexto(movimento, candidato);

    sugestoes.push(sugestaoDe(candidato, "TITULO", score, dias, parcial, saldo));
  }

  return sugestoes.sort((a, b) => b.score - a.score || a.diferencaEmDias - b.diferencaEmDias);
}

/**
 * O título exige decisão humana antes de qualquer baixa?
 *
 * Antecipação e pagamento múltiplo são liquidados em conjunto, por regras
 * próprias que a conciliação não deve reinventar. Quando são a única
 * correspondência possível, o movimento vai para revisão manual em vez de
 * receber uma sugestão que poderia ser aceita sem pensar.
 */
function exigeRevisaoManual(candidato: CandidatoTransacao): boolean {
  return (
    candidato.adiantamento_id != null ||
    candidato.eh_adiantamento === true ||
    candidato.pagamento_multiplo_id != null
  );
}

/**
 * A análise completa de um movimento.
 *
 * `candidatosFluxo` e `candidatosTitulos` podem ser a mesma lista: os filtros de
 * `pendente` de cada etapa já separam as duas populações.
 */
export function analisarMovimento(
  movimento: OfxMovimento,
  candidatos: CandidatoTransacao[],
  bancoId: number,
): AnaliseDeMovimento {
  const noFluxo = casarComFluxo(movimento, candidatos, bancoId);

  if (noFluxo.length === 1) {
    return {
      situacao: "MATCH_EXATO",
      score: noFluxo[0].score,
      sugestoes: noFluxo,
      acaoSugerida: "VINCULAR",
      observacao: null,
    };
  }

  if (noFluxo.length > 1) {
    return {
      situacao: "AMBIGUO",
      score: noFluxo[0].score,
      sugestoes: noFluxo,
      acaoSugerida: null,
      observacao: "Mais de um movimento do Fluxo bate com esta linha do extrato.",
    };
  }

  const emTitulos = casarComTitulos(movimento, candidatos);
  const aproveitaveis = emTitulos.filter(
    (sugestao) =>
      sugestao.score >= SCORE_MINIMO &&
      !exigeRevisaoManual(candidatos.find((candidato) => candidato.id === sugestao.transacaoId)!),
  );

  if (aproveitaveis.length === 0) {
    const havia = emTitulos.some((sugestao) => sugestao.score >= SCORE_MINIMO);
    if (havia) {
      return {
        situacao: "REVISAO_MANUAL",
        score: emTitulos[0]?.score ?? 0,
        sugestoes: emTitulos,
        acaoSugerida: null,
        observacao:
          "Os títulos parecidos são de antecipação ou de pagamento múltiplo, que se liquidam em conjunto. Resolva por lá antes de conciliar.",
      };
    }

    return {
      situacao: "SEM_CORRESPONDENCIA",
      score: 0,
      sugestoes: [],
      acaoSugerida: "CRIAR",
      observacao: null,
    };
  }

  const melhor = aproveitaveis[0];
  const empatados = aproveitaveis.filter(
    (sugestao) => melhor.score - sugestao.score <= MARGEM_DE_EMPATE,
  );

  if (empatados.length > 1) {
    return {
      situacao: "AMBIGUO",
      score: melhor.score,
      sugestoes: aproveitaveis,
      acaoSugerida: null,
      observacao: `${empatados.length} títulos em aberto batem com este movimento.`,
    };
  }

  return {
    situacao: "MATCH_PROVAVEL",
    score: melhor.score,
    sugestoes: aproveitaveis,
    acaoSugerida: melhor.parcial ? "BAIXA_PARCIAL" : "LIQUIDAR",
    observacao: null,
  };
}
