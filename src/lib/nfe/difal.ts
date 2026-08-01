/**
 * DIFAL — partilha do ICMS para a UF de destino (grupo ICMSUFDest, NF-e 4.00).
 *
 * Obrigatorio na saida interestadual para consumidor final NAO contribuinte do
 * ICMS (EC 87/2015). A ausencia do grupo gera a rejeicao 694: "Nao informado o
 * grupo de ICMS para a UF de destino".
 *
 * O grupo e independente do CST: um item com CST 60 (ST) continua devendo o
 * DIFAL. Trocar o CST para fugir da rejeicao gera nota autorizada porem
 * fiscalmente incorreta.
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
  "551", "552", "553", "554", "555", "556", "557", // bens do ativo e uso/consumo
  "901", "902", "903", "904", "905", "906", "907", "908", "909", // remessas e retornos
  "910", "911", "912", "913", "914", "915", "916", "917", "918", "919",
  "920", "921", "922", "923", "924", "925",
  "934",
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
 */
export function deveGerarICMSUFDest(params: {
  ufEmitente: string;
  ufDestinatario: string;
  indFinal: number | string;
  indIEDest: number | string;
  tpNF?: number | string;
  possuiISSQN?: boolean;
  cfop?: string | number | null;
}): boolean {
  const destino = normalizarUf(params.ufDestinatario);

  // Exportacao tem regime proprio; nao gera partilha de ICMS interestadual.
  if (destino === "EX") return false;

  // Entrada nao gera DIFAL de saida. Default 1 preserva chamadas antigas.
  if (String(params.tpNF ?? 1) !== "1") return false;
  if (params.possuiISSQN) return false;
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
  if (Number.isFinite(informada) && informada > 0) {
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
  const inter = Number.isFinite(informadaInter) && informadaInter > 0
    ? informadaInter
    : aliquotaInterestadual(params.ufEmitente, destino, params.origemMercadoria);

  const partilha = Number(params.percentualPartilhaDestino);
  const fcp = Number(params.aliquotaFcpDestino);

  return calcularDifal({
    baseCalculo: params.baseCalculo,
    baseCalculoFcp: params.baseCalculoFcp ?? undefined,
    aliquotaInternaDestino: interna,
    aliquotaInterestadual: inter,
    percentualPartilhaDestino: Number.isFinite(partilha) && partilha > 0 ? partilha : 100,
    aliquotaFcpDestino: Number.isFinite(fcp) && fcp > 0 ? fcp : 0,
  });
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
