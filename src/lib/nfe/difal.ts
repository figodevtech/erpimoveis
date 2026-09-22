import type { NFeItem } from './types';
import {
  casarRegrasDifal,
  normalizarNcm,
  type CampoResolvido,
  type OrigemValorDifal,
  type RegraDifal,
} from './difalRegras';

/**
 * DIFAL — partilha do ICMS para a UF de destino (grupo ICMSUFDest, NF-e 4.00).
 *
 * Obrigatorio na saida interestadual para consumidor final NAO contribuinte do
 * ICMS (EC 87/2015). A ausencia do grupo gera a rejeicao 694: "Nao informado o
 * grupo de ICMS para a UF de destino".
 *
 * CST 60 não dispensa o DIFAL por si só. Isenção/não incidência e as exceções
 * da RV NA01-20 precisam ser consideradas por item, sem trocar classificações.
 */

export type ICMSUFDest = {
  vBCUFDest: number;
  vBCFCPUFDest: number;
  pFCPUFDest: number;
  pICMSUFDest: number;
  pICMSInter: number;
  pICMSInterPart: number;
  vFCPUFDest: number;
  vICMSUFDest: number;
  vICMSUFRemet: number;
};

export type ContextoDifal = {
  ufEmitente: string;
  ufDestinatario: string;
  indFinal: number | string;
  indIEDest: number | string;
  tpNF?: number | string;
  finNFe?: number;
  ufEntrega?: string | null;
  crt?: number | string | null;
  modelo?: number | string | null;
  /** Data fiscal do documento (YYYY-MM-DD), usada para escolher a regra vigente. */
  dataEmissao?: string | null;
};

/**
 * Fatos estruturais usados quando o DIFAL canônico foi decidido. Alíquotas e
 * valores ficam no próprio grupo ICMSUFDest: mudar um padrão depois da decisão
 * não autoriza o builder a recalcular ou sobrescrever o snapshot.
 */
export type ContextoDifalCanonico = {
  ufEmitente: string;
  ufDestino: string;
  indFinal: string;
  indIEDest: string;
  tpNF: string;
  finNFe: number;
  ufEntrega: string | null;
  /** Ausentes nos snapshots gravados antes do motor de regras. */
  crt?: string | null;
  modelo?: string | null;
};

/**
 * Aliquota interna padrao de ICMS por UF de destino, em percentual.
 *
 * FALLBACK CONTROLADO, nao verdade fiscal. A aliquota real varia por NCM, CEST,
 * beneficio fiscal e data de vigencia. Sempre que o item trouxer a aliquota do
 * seu cadastro fiscal, ela tem prioridade sobre esta tabela.
 */
export const ALIQUOTA_INTERNA_POR_UF: Record<string, number> = {
  AC: 19, AL: 20, AM: 20, AP: 18, BA: 20.5, CE: 20, DF: 20, ES: 17,
  GO: 19, MA: 23, MG: 18, MS: 17, MT: 17, PA: 19, PB: 20, PE: 20.5,
  PI: 22.5, PR: 19.5, RJ: 20, RN: 20, RO: 19.5, RR: 20, RS: 17,
  SC: 17, SE: 20, SP: 18, TO: 20,
};

const UFS_VALIDAS = new Set(Object.keys(ALIQUOTA_INTERNA_POR_UF));

/** UFs das regioes Sul e Sudeste, exceto ES — origem da aliquota de 7%. */
const SUL_SUDESTE_EXCETO_ES = new Set(["SP", "RJ", "MG", "PR", "SC", "RS"]);

/**
 * Origens sujeitas a aliquota interestadual de 4% (Resolucao do Senado 13/2012).
 *
 * 1 estrangeira, importacao direta
 * 2 estrangeira, adquirida no mercado interno
 * 3 nacional, conteudo de importacao acima de 40% ate 70%
 * 8 nacional, conteudo de importacao acima de 70%
 *
 * As origens 6 e 7 (sem similar nacional, lista CAMEX) estao EXPRESSAMENTE
 * excluidas pelo art. 1o, §4o, I da mesma resolucao — nao entram nos 4%.
 */
const ORIGENS_ALIQUOTA_4 = new Set(["1", "2", "3", "8"]);

export function normalizarUf(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

function validarPercentual(nome: string, valor: unknown, minimo = 0, maximo = 100): number {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) throw new Error(`${nome} não informado ou inválido.`);
  if (numero < minimo || numero > maximo) {
    throw new Error(`${nome} deve estar entre ${minimo} e ${maximo}. Recebido: ${numero}.`);
  }
  return numero;
}

function validarValorMonetario(nome: string, valor: unknown): number {
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero < 0) throw new Error(`${nome} inválida: ${String(valor)}.`);
  return numero;
}

function arredondarMoeda(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

/**
 * idDest: 1 interna, 2 interestadual, 3 exterior.
 *
 * UF ausente e erro de cadastro, nao operacao interna: tratar como interna
 * mascararia o problema e produziria nota sem o DIFAL devido.
 */
export function calcularIdDest(ufEmitente: string, ufDestinatario: string): 1 | 2 | 3 {
  const origem = normalizarUf(ufEmitente);
  const destino = normalizarUf(ufDestinatario);

  if (!origem) throw new Error("UF do emitente não informada.");
  if (!destino) throw new Error("UF do destinatário não informada.");
  if (destino === "EX") return 3;

  return origem === destino ? 1 : 2;
}

/**
 * Aliquota interestadual: 4% para as origens da Resolucao 13/2012, 7% de
 * Sul/Sudeste (exceto ES) para as demais regioes, 12% nos outros casos.
 */
export function aliquotaInterestadual(
  ufEmitente: string,
  ufDestinatario: string,
  origemMercadoria?: string | number | null,
): number {
  const origem = String(origemMercadoria ?? "0").trim();
  if (ORIGENS_ALIQUOTA_4.has(origem)) return 4;

  const de = normalizarUf(ufEmitente);
  const para = normalizarUf(ufDestinatario);
  if (SUL_SUDESTE_EXCETO_ES.has(de) && !SUL_SUDESTE_EXCETO_ES.has(para)) return 7;
  return 12;
}

/**
 * CFOPs de saida que NAO caracterizam venda a consumidor final e por isso nao
 * geram DIFAL, mesmo atendendo as demais condicoes.
 *
 * Sao os finais mais comuns de devolucao, remessa, retorno e transferencia. A
 * lista cobre os casos correntes e nao substitui analise fiscal: operacoes com
 * regime especial ou beneficio podem exigir tratamento proprio.
 */
export const FINAIS_CFOP_SEM_DIFAL = new Set([
  "201", "202", "208", "209", // devolucao de compra / transferencia
  "552", "553", "554", "555", "556", "557", // 6551 é VENDA de ativo, não dispensa por si só
  "901", "902", "903", "904", "905", "906", "907", "908", "909", // remessas e retornos
  "910", "911", "912", "913", "914", "915", "916", "917", "918", "919",
  "920", "921", "922", "923", "924", "925",
  "934",
  "929", // NA01-20, exceção 9
  "151", "152", "153", "155", "156", // transferencias
]);

/**
 * O CFOP e ignorado quando vazio: a validacao de CFOP obrigatorio ja acontece
 * em outro ponto, e travar aqui esconderia o erro real.
 */
export function cfopDispensaDifal(cfop: unknown): boolean {
  const digitos = String(cfop ?? "").replace(/\D/g, "");
  if (digitos.length !== 4) return false;
  return FINAIS_CFOP_SEM_DIFAL.has(digitos.slice(1));
}

/**
 * O grupo entra apenas na saida interestadual a consumidor final nao
 * contribuinte, com item fora do ISSQN e CFOP que caracterize venda.
 *
 * As dispensas seguem as exceções da NA01-20 como publicadas na NT 2025.002-RTC
 * v1.33 (dez/2025), a versão vigente da regra:
 *
 *   exceção 5   NF-e de entrada (tpNF=0)
 *   exceção 7   UF do local de entrega igual à do emitente
 *   exceção 9   CFOP 6.552, 6.922 e 6.929
 *   exceção 10  isentas, imunes e não tributadas (CST 40/41, CSOSN 103/300/400)
 *   exceção 11  finNFe 2 (complementar), 3 (ajuste), 5 (crédito) e 6 (débito)
 *   exceção 12  emitente optante pelo Simples Nacional (CRT 1 ou 4)
 *
 * As exceções 4 e 8 (CFOP de retorno e de remessa, pelos indicadores indRetor e
 * indRemes da tabela CFOP) entram por FINAIS_CFOP_SEM_DIFAL, que lista os
 * finais correntes em vez de carregar a tabela inteira.
 */
export function deveGerarICMSUFDest(params: {
  ufEmitente: string;
  ufDestinatario: string;
  indFinal: number | string;
  indIEDest: number | string;
  tpNF?: number | string;
  possuiISSQN?: boolean;
  cfop?: string | number | null;
  cst?: string | null;
  csosn?: string | null;
  finNFe?: number;
  ufEntrega?: string | null;
  /** CRT do emitente. 1 e 4 (Simples Nacional e MEI) dispensam o grupo. */
  crt?: number | string | null;
  /** Modelo do documento. A NFC-e (65) não leva o grupo. */
  modelo?: number | string | null;
}): boolean {
  const destino = normalizarUf(params.ufDestinatario);

  // Exportacao tem regime proprio; nao gera partilha de ICMS interestadual.
  if (destino === "EX") return false;

  // NA01-10: NFC-e com o grupo é rejeição 807. O modelo é opcional para não
  // quebrar chamadas antigas, que sempre foram de NF-e.
  if (params.modelo != null && String(params.modelo) === "65") return false;

  // NA01-20, exceção 12: o Simples Nacional não recolhe o DIFAL da EC 87/2015
  // (cláusula nona do Convênio ICMS 93/2015, suspensa pelo STF na ADI 5464), e
  // a regra de validação dispensa o grupo para CRT 1 e 4. Ausente o CRT, o
  // comportamento é o de antes: decide pelos demais critérios.
  if (params.crt != null && ["1", "4"].includes(String(params.crt))) return false;

  // Entrada nao gera DIFAL de saida. Default 1 preserva chamadas antigas.
  if (String(params.tpNF ?? 1) !== "1") return false;
  if (params.possuiISSQN) return false;
  // NA01-20, exceções 7, 10 e 11; não inferir benefício a partir de alíquota.
  if (params.ufEntrega && normalizarUf(params.ufEntrega) === normalizarUf(params.ufEmitente)) return false;
  if (['40', '41'].includes(params.cst ?? '') || ['103', '300', '400'].includes(params.csosn ?? '')) return false;
  if ([2, 3, 5, 6].includes(Number(params.finNFe))) return false;
  // Devolucao, remessa, retorno e transferencia nao sao venda a consumidor final.
  if (cfopDispensaDifal(params.cfop)) return false;

  const idDest = calcularIdDest(params.ufEmitente, destino);
  if (idDest !== 2) return false;

  return String(params.indFinal) === "1" && String(params.indIEDest) === "9";
}

export type CalcularDifalInput = {
  baseCalculo: number;
  baseCalculoFcp?: number;
  aliquotaInternaDestino: number;
  aliquotaInterestadual: number;
  /** Desde 2019 a partilha e 100% para a UF de destino. */
  percentualPartilhaDestino?: number;
  aliquotaFcpDestino?: number;
};

export function calcularDifal({
  baseCalculo,
  baseCalculoFcp,
  aliquotaInternaDestino,
  aliquotaInterestadual: pInter,
  percentualPartilhaDestino = 100,
  aliquotaFcpDestino = 0,
}: CalcularDifalInput): ICMSUFDest {
  const base = validarValorMonetario("Base de cálculo do DIFAL", baseCalculo);
  const baseFcp = baseCalculoFcp == null
    ? base
    : validarValorMonetario("Base de cálculo do FCP", baseCalculoFcp);

  const pInterna = validarPercentual("Alíquota interna da UF de destino", aliquotaInternaDestino);
  const pInterestadual = validarPercentual("Alíquota interestadual", pInter);
  const pPartilha = validarPercentual("Percentual de partilha da UF de destino", percentualPartilhaDestino);
  const pFcp = validarPercentual("Alíquota do FCP da UF de destino", aliquotaFcpDestino);

  // Aliquota interna abaixo da interestadual nao gera credito: o DIFAL e zero.
  const diferenca = Math.max(0, pInterna - pInterestadual);
  const difalTotal = base * (diferenca / 100);

  const vICMSUFDest = difalTotal * (pPartilha / 100);
  const vICMSUFRemet = difalTotal - vICMSUFDest;
  const vFCPUFDest = baseFcp * (pFcp / 100);

  return {
    vBCUFDest: arredondarMoeda(base),
    vBCFCPUFDest: arredondarMoeda(baseFcp),
    pFCPUFDest: pFcp,
    pICMSUFDest: pInterna,
    pICMSInter: pInterestadual,
    pICMSInterPart: pPartilha,
    vFCPUFDest: arredondarMoeda(vFCPUFDest),
    vICMSUFDest: arredondarMoeda(vICMSUFDest),
    vICMSUFRemet: arredondarMoeda(vICMSUFRemet),
  };
}

export type OrigemAliquotaInterna = "ITEM" | "TABELA";

/**
 * Resolve a aliquota interna do destino. A do cadastro fiscal do item tem
 * prioridade; a tabela por UF e fallback e vem sinalizada, para que o chamador
 * possa registrar que nao usou dado configurado.
 */
export function resolverAliquotaInternaDestino(
  ufDestinatario: string,
  aliquotaInformada?: number | null,
): { aliquota: number; origem: OrigemAliquotaInterna } {
  const destino = normalizarUf(ufDestinatario);
  if (!destino) throw new Error("UF do destinatário não informada.");
  if (!UFS_VALIDAS.has(destino)) throw new Error(`UF de destino desconhecida: ${destino}.`);

  const informada = Number(aliquotaInformada);
  if (aliquotaInformada != null) {
    return { aliquota: validarPercentual("Alíquota interna da UF de destino", informada), origem: "ITEM" };
  }

  const daTabela = ALIQUOTA_INTERNA_POR_UF[destino];
  if (!Number.isFinite(daTabela) || daTabela <= 0) {
    throw new Error(
      `Alíquota interna do ICMS não informada para a UF ${destino}. `
        + "Preencha o campo na aba fiscal do item antes de emitir.",
    );
  }
  return { aliquota: daTabela, origem: "TABELA" };
}

/**
 * Monta o grupo a partir do item e das UFs envolvidas, resolvendo as aliquotas
 * quando o item nao as informa explicitamente.
 */
export function montarICMSUFDest(params: {
  baseCalculo: number;
  baseCalculoFcp?: number | null;
  ufEmitente: string;
  ufDestinatario: string;
  origemMercadoria?: string | number | null;
  aliquotaInternaDestino?: number | null;
  aliquotaInterestadual?: number | null;
  aliquotaFcpDestino?: number | null;
  percentualPartilhaDestino?: number | null;
  /** Recebe aviso quando a aliquota interna veio da tabela e nao do cadastro. */
  onAliquotaPadrao?: (uf: string, aliquota: number) => void;
}): ICMSUFDest {
  const destino = normalizarUf(params.ufDestinatario);
  const { aliquota: interna, origem } = resolverAliquotaInternaDestino(
    destino,
    params.aliquotaInternaDestino,
  );
  if (origem === "TABELA") {
    params.onAliquotaPadrao?.(destino, interna);
  }

  const informadaInter = Number(params.aliquotaInterestadual);
  const inter = params.aliquotaInterestadual != null
    ? informadaInter
    : aliquotaInterestadual(params.ufEmitente, destino, params.origemMercadoria);

  const partilha = Number(params.percentualPartilhaDestino);
  const fcp = Number(params.aliquotaFcpDestino);

  return calcularDifal({
    baseCalculo: params.baseCalculo,
    baseCalculoFcp: params.baseCalculoFcp ?? undefined,
    aliquotaInternaDestino: interna,
    aliquotaInterestadual: inter,
    percentualPartilhaDestino: params.percentualPartilhaDestino != null ? partilha : 100,
    aliquotaFcpDestino: params.aliquotaFcpDestino != null ? fcp : 0,
  });
}

function contextoCanonico(contexto: ContextoDifal): ContextoDifalCanonico {
  return {
    ufEmitente: normalizarUf(contexto.ufEmitente),
    ufDestino: normalizarUf(contexto.ufDestinatario),
    indFinal: String(contexto.indFinal),
    indIEDest: String(contexto.indIEDest),
    tpNF: String(contexto.tpNF ?? 1),
    finNFe: Number(contexto.finNFe ?? 1),
    ufEntrega: contexto.ufEntrega ? normalizarUf(contexto.ufEntrega) : null,
    crt: contexto.crt == null ? null : String(contexto.crt),
    modelo: contexto.modelo == null ? null : String(contexto.modelo),
  };
}

function erroDifalCanonico(item: NFeItem, motivo: string): never {
  throw new Error(
    `NFE_DIFAL_CANONICO_DESATUALIZADO: item ${item.numeroItem}; ${motivo} `
      + 'O DIFAL deste item foi calculado para um contexto fiscal diferente do atual. '
      + 'Recalcule/regrave o item fiscal antes de emitir.',
  );
}

/**
 * Confere somente a coerência estrutural do grupo já decidido. Não recalcula
 * valores nem compara alíquotas: o canônico presente continua sendo a fonte de
 * verdade, desde que pertença ao mesmo contexto fiscal.
 */
export function validarDifalCanonicoDoItem(item: NFeItem, contexto: ContextoDifal): void {
  const deveGerar = deveGerarICMSUFDest({
    ...contexto,
    cfop: item.cfop,
    cst: item.cstIcms ?? item.cst,
    csosn: item.csosn,
  });
  const possuiGrupo = Boolean(item.icmsUfDest);

  if (deveGerar !== possuiGrupo) {
    erroDifalCanonico(
      item,
      deveGerar
        ? 'o contexto atual exige ICMSUFDest, mas o grupo canônico não está presente.'
        : 'o grupo ICMSUFDest está presente, mas o contexto atual dispensa DIFAL.',
    );
  }
  if (!possuiGrupo) return;

  const gravado = item.difalDecisao?.contexto;
  if (!gravado) {
    erroDifalCanonico(item, 'o grupo ICMSUFDest não possui o snapshot do contexto em que foi decidido.');
  }

  const atual = contextoCanonico(contexto);
  // crt e modelo passaram a ser gravados junto com o motor de regras. Quando o
  // snapshot não os registrou — nota decidida antes disso, ou por um caminho
  // que não conhecia o CRT —, não há o que comparar: ausência é "não sei",
  // não divergência. Tratá-la como divergência invalidaria rascunhos corretos.
  const opcionais: Array<keyof ContextoDifalCanonico> = ['crt', 'modelo'];
  const divergencias = (Object.keys(atual) as Array<keyof ContextoDifalCanonico>)
    .filter((campo) => {
      if (opcionais.includes(campo) && gravado[campo] == null) return false;
      return gravado[campo] !== atual[campo];
    });
  if (item.difalDecisao?.ufDestino !== atual.ufDestino && !divergencias.includes('ufDestino')) {
    divergencias.push('ufDestino');
  }
  if (divergencias.length > 0) {
    erroDifalCanonico(item, `contexto divergente em: ${divergencias.join(', ')}.`);
  }
}

/**
 * Resolve um campo do DIFAL na ordem: override manual explícito, regra fiscal
 * versionada, valor que veio no item, tabela de referência.
 *
 * A regra vem ANTES do valor do item de propósito. A tela resolve o DIFAL no
 * carregamento e devolve os mesmos números no payload; se o valor do item
 * ganhasse, o servidor gravaria "22,5 veio do ITEM" para um número que veio da
 * regra do PI — e o snapshot perderia regraId, vigência, fonte e fundamento,
 * que são justamente o que responde "por que esta nota usou 22,5%?". Pior: o
 * navegador passaria a ditar alíquota sem deixar rastro.
 *
 * O valor do item só vence quando vem marcado como override manual, e aí a
 * proveniência diz isso. Sem marca e sem regra, ele ainda serve de último
 * recurso — é o caso da NF-e avulsa numa UF que ainda não tem regra cadastrada.
 */
function resolverCampoDifal(params: {
  valorDoItem: number | null | undefined;
  overrideManual: boolean | undefined;
  daRegra: CampoResolvido | null;
}): { valor: number | null; origem: OrigemValorDifal; regra: CampoResolvido | null } {
  if (params.valorDoItem != null && params.overrideManual) {
    return { valor: Number(params.valorDoItem), origem: 'MANUAL', regra: null };
  }
  if (params.daRegra) {
    return { valor: params.daRegra.valor, origem: params.daRegra.origem, regra: params.daRegra };
  }
  if (params.valorDoItem != null) {
    return { valor: Number(params.valorDoItem), origem: 'ITEM', regra: null };
  }
  return { valor: null, origem: 'NAO_CONFIGURADO', regra: null };
}

/**
 * Decide o DIFAL do item e grava a proveniência junto: qual regra respondeu por
 * cada campo, em que vigência, com que fonte e fundamento.
 *
 * O snapshot gravado aqui é o que vai para a prévia e para o XML. Alterar uma
 * regra em fiscal_difal_regra depois disso não mexe em nota nenhuma: quem
 * recalcula é uma nova resolução, disparada por mudança de contexto fiscal.
 */
export function resolverDifalDoItem(
  item: NFeItem,
  contexto: ContextoDifal,
  opcoes?: {
    regras?: RegraDifal[];
    /**
     * O NCM do item existe na NCM oficial? `undefined` quer dizer que o
     * catálogo não foi consultado (tabela fiscal_ncm ainda vazia) — nesse caso
     * a checagem de existência fica desligada e vale só o formato.
     */
    ncmConhecido?: boolean;
  },
): NFeItem {
  if (!deveGerarICMSUFDest({ ...contexto, cfop: item.cfop, cst: item.cstIcms ?? item.cst, csosn: item.csosn })) return item;

  const ufDestino = normalizarUf(contexto.ufDestinatario);
  const dataEmissao = String(contexto.dataEmissao ?? '').slice(0, 10);
  const casamento = casarRegrasDifal(opcoes?.regras ?? [], {
    ufDestino,
    dataEmissao,
    ncm: item.ncm,
    cest: item.cest,
  });

  const override = item.overrideDifalManual;
  const interna = resolverCampoDifal({
    valorDoItem: item.aliquotaInternaDestino,
    overrideManual: override?.aliquotaInterna,
    daRegra: casamento.aliquotaInterna,
  });
  const fcp = resolverCampoDifal({
    valorDoItem: item.aliquotaFcpDestino,
    overrideManual: override?.aliquotaFcp,
    daRegra: casamento.aliquotaFcp,
  });

  // Último recurso: a tabela genérica por UF. Ela preenche o cálculo para a
  // prévia não quebrar, mas fica marcada como referência e bloqueia a emissão.
  let internaValor = interna.valor;
  let internaOrigem = interna.origem;
  if (internaValor == null) {
    const daTabela = ALIQUOTA_INTERNA_POR_UF[ufDestino];
    if (Number.isFinite(daTabela) && daTabela > 0) {
      internaValor = daTabela;
      internaOrigem = 'TABELA_REFERENCIA';
    }
  }

  const ncmNormalizado = normalizarNcm(item.ncm);
  const pendencias: DifalPendencia[] = [];
  if (!ufDestino || !dataEmissao) {
    pendencias.push('CONTEXTO_INCOMPLETO');
  }
  if (!ncmNormalizado) {
    pendencias.push('NCM_INVALIDO');
  } else if (opcoes?.ncmConhecido === false) {
    pendencias.push('NCM_INEXISTENTE');
  }
  if (casamento.conflitos.length > 0) {
    pendencias.push('REGRA_CONFLITANTE');
  }
  if (internaValor == null) {
    pendencias.push('ALIQUOTA_INTERNA_NAO_DETERMINADA');
  } else if (internaOrigem === 'TABELA_REFERENCIA') {
    pendencias.push('ALIQUOTA_INTERNA_SEM_REGRA');
  }
  if (fcp.valor == null) {
    pendencias.push('FCP_NAO_DETERMINADO');
  }

  return {
    ...item,
    difalDecisao: {
      ufDestino,
      dataResolucao: dataEmissao || null,
      aliquotaInterna: internaValor,
      origemAliquotaInterna: internaOrigem,
      regraAliquotaInterna: interna.regra,
      aliquotaFcp: fcp.valor,
      origemFcp: fcp.origem,
      regraFcp: fcp.regra,
      conflitos: casamento.conflitos,
      pendencias,
      resolvidoAutomaticamente:
        pendencias.length === 0 && (internaOrigem !== 'ITEM' || fcp.origem !== 'ITEM'),
      contexto: contextoCanonico(contexto),
    },
    icmsUfDest: montarICMSUFDest({
      baseCalculo: item.icmsDecisao?.composicaoBase?.baseIcmsProprio ?? valorOperacaoDifal(item),
      baseCalculoFcp: item.baseCalculoFcpDestino,
      ufEmitente: contexto.ufEmitente,
      ufDestinatario: contexto.ufDestinatario,
      origemMercadoria: item.orig,
      aliquotaInternaDestino: internaValor,
      aliquotaInterestadual: item.aliquotaInterestadual,
      aliquotaFcpDestino: fcp.valor,
      percentualPartilhaDestino: item.percentualPartilhaDestino,
    }),
  };
}

/** Motivos pelos quais o DIFAL de um item não fecha sozinho. */
export type DifalPendencia =
  | 'CONTEXTO_INCOMPLETO'
  | 'NCM_INVALIDO'
  | 'NCM_INEXISTENTE'
  | 'REGRA_CONFLITANTE'
  | 'ALIQUOTA_INTERNA_NAO_DETERMINADA'
  | 'ALIQUOTA_INTERNA_SEM_REGRA'
  | 'FCP_NAO_DETERMINADO';

const MENSAGEM_PENDENCIA: Record<DifalPendencia, { code: string; field: string; message: string }> = {
  CONTEXTO_INCOMPLETO: {
    code: 'NFE_DIFAL_CONTEXTO_INCOMPLETO',
    field: 'aliquotaInternaDestino',
    message:
      'Contexto fiscal incompleto para resolver o DIFAL: faltam a UF de destino ou a data de emissão.',
  },
  NCM_INVALIDO: {
    code: 'NFE_DIFAL_NCM_INVALIDO',
    field: 'ncm',
    message:
      'NCM ausente ou inválido (são 8 dígitos). Sem ele não dá para saber se a mercadoria tem regra própria de alíquota ou de FCP na UF de destino, e o motor não escolhe por semelhança.',
  },
  NCM_INEXISTENTE: {
    code: 'NFE_DIFAL_NCM_INEXISTENTE',
    field: 'ncm',
    message:
      'O NCM informado tem 8 dígitos mas não existe na Nomenclatura Comum do Mercosul. Um código inexistente nunca casa com regra por mercadoria e cairia na regra geral da UF, tributando errado sem avisar. Corrija o NCM no cadastro do produto.',
  },
  REGRA_CONFLITANTE: {
    code: 'NFE_DIFAL_REGRA_CONFLITANTE',
    field: 'aliquotaInternaDestino',
    message:
      'Duas regras fiscais igualmente específicas valem nesta data e discordam do valor. A escolha é de quem mantém o cadastro fiscal, não do sistema: ajuste a vigência ou a prioridade de uma delas.',
  },
  ALIQUOTA_INTERNA_NAO_DETERMINADA: {
    code: 'NFE_DIFAL_ALIQUOTA_INTERNA_NAO_DETERMINADA',
    field: 'aliquotaInternaDestino',
    message:
      'Não foi possível determinar automaticamente a alíquota interna da UF de destino nesta data. Informe a alíquota vigente antes de emitir.',
  },
  ALIQUOTA_INTERNA_SEM_REGRA: {
    code: 'NFE_DIFAL_ALIQUOTA_INTERNA_SEM_REGRA',
    field: 'aliquotaInternaDestino',
    message:
      'A alíquota interna veio da tabela genérica por UF, que não conhece NCM, benefício nem vigência. Cadastre a regra fiscal da UF de destino ou informe a alíquota no item.',
  },
  FCP_NAO_DETERMINADO: {
    code: 'NFE_DIFAL_FCP_NAO_DETERMINADO',
    field: 'aliquotaFcpDestino',
    message:
      'Não foi possível determinar automaticamente o FCP desta mercadoria na UF de destino. Confirme a tributação e informe inclusive zero quando não devido.',
  },
};

/**
 * Pendências que impedem a emissão. Cada uma nomeia a sua causa, porque a
 * anterior — um bloqueio único para qualquer aviso — não dizia ao operador se
 * faltava alíquota, faltava FCP ou havia conflito de regra.
 *
 * O que NÃO bloqueia: valor determinado por regra versionada, inclusive FCP
 * igual a zero. Zero vindo de regra é resposta fiscal, não ausência de resposta.
 * Servidor e tela usam esta mesma função.
 */
export function issuesDifalDoItem(item: NFeItem): Array<{
  code: string;
  severidade: 'BLOQUEIO';
  field: string;
  message: string;
}> {
  const decisao = item.difalDecisao;
  if (!decisao?.pendencias?.length) return [];

  return decisao.pendencias.map((pendencia) => {
    const base = MENSAGEM_PENDENCIA[pendencia];
    const detalhe =
      pendencia === 'REGRA_CONFLITANTE' && decisao.conflitos?.length
        ? ` Em disputa: ${decisao.conflitos
            .map(
              (c) =>
                `${c.campo} (${c.regras.map((r) => `#${r.id} = ${r.valor}%`).join(' x ')})`,
            )
            .join('; ')}.`
        : '';
    return {
      code: base.code,
      severidade: 'BLOQUEIO' as const,
      field: base.field,
      message: `${base.message}${detalhe}`,
    };
  });
}

function valorOperacaoDifal(item: NFeItem) {
  return Number((item.valorTotal - Number(item.valorDesconto ?? 0) + Number(item.valorFrete ?? 0)).toFixed(2));
}

/**
 * XML do grupo. A ordem dos campos segue o leiaute 4.00 e nao pode variar.
 */
export function buildIcmsUFDestXml(icms: ICMSUFDest): string {
  return (
    "<ICMSUFDest>" +
    `<vBCUFDest>${icms.vBCUFDest.toFixed(2)}</vBCUFDest>` +
    `<vBCFCPUFDest>${icms.vBCFCPUFDest.toFixed(2)}</vBCFCPUFDest>` +
    `<pFCPUFDest>${icms.pFCPUFDest.toFixed(2)}</pFCPUFDest>` +
    `<pICMSUFDest>${icms.pICMSUFDest.toFixed(2)}</pICMSUFDest>` +
    `<pICMSInter>${icms.pICMSInter.toFixed(2)}</pICMSInter>` +
    `<pICMSInterPart>${icms.pICMSInterPart.toFixed(2)}</pICMSInterPart>` +
    `<vFCPUFDest>${icms.vFCPUFDest.toFixed(2)}</vFCPUFDest>` +
    `<vICMSUFDest>${icms.vICMSUFDest.toFixed(2)}</vICMSUFDest>` +
    `<vICMSUFRemet>${icms.vICMSUFRemet.toFixed(2)}</vICMSUFRemet>` +
    "</ICMSUFDest>"
  );
}
