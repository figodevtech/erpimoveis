/**
 * DIFAL — partilha do ICMS para a UF de destino (grupo ICMSUFDest, NF-e 4.00).
 *
 * Obrigatorio quando a operacao e interestadual, para consumidor final NAO
 * contribuinte do ICMS (EC 87/2015). A ausencia do grupo gera a rejeicao 694:
 * "Nao informado o grupo de ICMS para a UF de destino".
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
 * ATENCAO: estes valores mudam por lei estadual. Servem como fallback quando o
 * item nao traz `aliquotaInternaDestino`. Revise com a contabilidade.
 */
export const ALIQUOTA_INTERNA_POR_UF: Record<string, number> = {
  AC: 19, AL: 20, AM: 20, AP: 18, BA: 20.5, CE: 20, DF: 20, ES: 17,
  GO: 19, MA: 23, MG: 18, MS: 17, MT: 17, PA: 19, PB: 20, PE: 20.5,
  PI: 22.5, PR: 19.5, RJ: 20, RN: 20, RO: 19.5, RR: 20, RS: 17,
  SC: 17, SE: 20, SP: 18, TO: 20,
};

/** UFs das regioes Sul e Sudeste, exceto ES — origem da aliquota de 7%. */
const SUL_SUDESTE_EXCETO_ES = new Set(["SP", "RJ", "MG", "PR", "SC", "RS"]);

/** Origens de mercadoria importada, que usam aliquota interestadual de 4%. */
const ORIGENS_IMPORTADAS = new Set(["1", "2", "6", "7"]);

export function normalizarUf(uf: unknown) {
  return String(uf ?? "").trim().toUpperCase();
}

/** idDest: 1 interna, 2 interestadual, 3 exterior. */
export function calcularIdDest(ufEmitente: string, ufDestinatario: string): 1 | 2 | 3 {
  const origem = normalizarUf(ufEmitente);
  const destino = normalizarUf(ufDestinatario);
  if (destino === "EX") return 3;
  if (!origem || !destino) return 1;
  return origem === destino ? 1 : 2;
}

/**
 * Aliquota interestadual aplicavel: 4% para importados, 7% de Sul/Sudeste
 * (exceto ES) para Norte/Nordeste/Centro-Oeste/ES, 12% nos demais casos.
 */
export function aliquotaInterestadual(
  ufEmitente: string,
  ufDestinatario: string,
  origemMercadoria?: string | number | null,
): number {
  const origem = String(origemMercadoria ?? "0").trim();
  if (ORIGENS_IMPORTADAS.has(origem)) return 4;

  const de = normalizarUf(ufEmitente);
  const para = normalizarUf(ufDestinatario);
  if (SUL_SUDESTE_EXCETO_ES.has(de) && !SUL_SUDESTE_EXCETO_ES.has(para)) return 7;
  return 12;
}

/**
 * O grupo ICMSUFDest so entra quando as tres condicoes ocorrem juntas:
 * operacao interestadual, consumidor final e destinatario nao contribuinte.
 */
export function deveGerarICMSUFDest(params: {
  ufEmitente: string;
  ufDestinatario: string;
  indFinal: number | string;
  indIEDest: number | string;
}): boolean {
  const de = normalizarUf(params.ufEmitente);
  const para = normalizarUf(params.ufDestinatario);

  // Exterior nao gera DIFAL: e exportacao, tratada por outro regime.
  if (!de || !para || para === "EX") return false;

  const interestadual = de !== para;
  const consumidorFinal = String(params.indFinal) === "1";
  const naoContribuinte = String(params.indIEDest) === "9";

  return interestadual && consumidorFinal && naoContribuinte;
}

function arredondarMoeda(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

export type CalcularDifalInput = {
  baseCalculo: number;
  aliquotaInternaDestino: number;
  aliquotaInterestadual: number;
  /** Desde 2019 a partilha e 100% para a UF de destino. */
  percentualPartilhaDestino?: number;
  aliquotaFcpDestino?: number;
};

export function calcularDifal({
  baseCalculo,
  aliquotaInternaDestino,
  aliquotaInterestadual: pInter,
  percentualPartilhaDestino = 100,
  aliquotaFcpDestino = 0,
}: CalcularDifalInput): ICMSUFDest {
  const base = Math.max(0, Number(baseCalculo) || 0);
  // Aliquota interna abaixo da interestadual nao gera credito: o DIFAL e zero.
  const diferenca = Math.max(0, aliquotaInternaDestino - pInter);
  const difalTotal = base * (diferenca / 100);

  const vICMSUFDest = difalTotal * (percentualPartilhaDestino / 100);
  const vICMSUFRemet = difalTotal - vICMSUFDest;
  const vFCPUFDest = base * (aliquotaFcpDestino / 100);

  return {
    vBCUFDest: arredondarMoeda(base),
    vBCFCPUFDest: arredondarMoeda(base),
    pFCPUFDest: aliquotaFcpDestino,
    pICMSUFDest: aliquotaInternaDestino,
    pICMSInter: pInter,
    pICMSInterPart: percentualPartilhaDestino,
    vFCPUFDest: arredondarMoeda(vFCPUFDest),
    vICMSUFDest: arredondarMoeda(vICMSUFDest),
    vICMSUFRemet: arredondarMoeda(vICMSUFRemet),
  };
}

/**
 * Monta o grupo a partir do item e das UFs envolvidas, resolvendo as aliquotas
 * quando o item nao as informa explicitamente.
 */
export function montarICMSUFDest(params: {
  baseCalculo: number;
  ufEmitente: string;
  ufDestinatario: string;
  origemMercadoria?: string | number | null;
  aliquotaInternaDestino?: number | null;
  aliquotaInterestadual?: number | null;
  aliquotaFcpDestino?: number | null;
  percentualPartilhaDestino?: number | null;
}): ICMSUFDest {
  const destino = normalizarUf(params.ufDestinatario);

  const interna = Number(params.aliquotaInternaDestino) > 0
    ? Number(params.aliquotaInternaDestino)
    : ALIQUOTA_INTERNA_POR_UF[destino] ?? 17;

  const inter = Number(params.aliquotaInterestadual) > 0
    ? Number(params.aliquotaInterestadual)
    : aliquotaInterestadual(params.ufEmitente, destino, params.origemMercadoria);

  return calcularDifal({
    baseCalculo: params.baseCalculo,
    aliquotaInternaDestino: interna,
    aliquotaInterestadual: inter,
    percentualPartilhaDestino: Number(params.percentualPartilhaDestino) > 0
      ? Number(params.percentualPartilhaDestino)
      : 100,
    aliquotaFcpDestino: Number(params.aliquotaFcpDestino) > 0
      ? Number(params.aliquotaFcpDestino)
      : 0,
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
