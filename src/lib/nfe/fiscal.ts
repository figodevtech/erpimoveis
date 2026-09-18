import type { CRT, NFeItem, TributoPisCofins } from './types';
import { assertNFeItemTax } from './taxRules';
import { icmsCanonicoDoItem, serializarIcms, somarTotaisIcms, valorLiquidoItem } from './icms';
import { escapeXml } from './xmlUtils';

export type TotaisNFe = {
  vProd: number;
  vDesc: number;
  vBC: number;
  vICMS: number;
  vICMSDeson: number;
  vFCP: number;
  vBCST: number;
  vST: number;
  vFCPST: number;
  vFCPSTRet: number;
  vPIS: number;
  vCOFINS: number;
  vIPI: number;
  vIPIDevol: number;
  vIS: number;
  vBCIBSCBS: number;
  vIBSUF: number;
  vIBSMun: number;
  vIBS: number;
  vCBS: number;
};

const PIS_COFINS_NT = new Set(['04', '05', '06', '07', '08', '09']);

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function digits(value: unknown, size?: number): string {
  const result = clean(value).replace(/\D/g, '');
  return size && result ? result.padStart(size, '0').slice(-size) : result;
}

function has(value: unknown): boolean {
  return value !== undefined && value !== null && clean(value) !== '';
}

function money(value: unknown): string {
  return Number(value).toFixed(2);
}

function rate(value: unknown): string {
  return Number(value).toFixed(4);
}

function quantity(value: unknown): string {
  return Number(value).toFixed(4);
}

function tag(name: string, value: string | number): string {
  return `<${name}>${escapeXml(value)}</${name}>`;
}

function optionalTag(name: string, value: unknown, formatter: (value: unknown) => string = money) {
  return has(value) ? tag(name, formatter(value)) : '';
}

function requiredNumber(item: NFeItem, field: keyof NFeItem, value: unknown, formatter = money) {
  if (!has(value) || !Number.isFinite(Number(value))) {
    throw new Error(`NFE_FIELD_REQUIRED: item ${item.numeroItem}, campo ${String(field)}.`);
  }
  return formatter(value);
}

export { valorLiquidoItem };

export function normalizarCRT(value: string | number | null | undefined): CRT {
  const crt = clean(value);
  if (['1', '2', '3', '4'].includes(crt)) return Number(crt) as CRT;
  throw new Error(`CRT do emitente inválido ou não informado: "${value ?? ''}".`);
}

function hasIcmsST(item: NFeItem) {
  if (item.icms) return item.icms.vBCST !== null;
  const csosn = digits(item.csosn, 3);
  const cst = digits(item.cstIcms ?? item.cst, 2);
  return ['201', '202', '203'].includes(csosn) || ['10', '30', '70'].includes(cst) || has(item.vBCST) || has(item.vICMSST);
}

export function getCestXml(item: NFeItem): string {
  const cest = digits(item.cest);
  if (!cest && hasIcmsST(item)) throw new Error(`NFE_CEST_REQUIRED: item ${item.numeroItem} com ICMS-ST exige CEST.`);
  if (cest && cest.length !== 7) throw new Error(`NFE_CEST_INVALID: item ${item.numeroItem}; CEST deve ter 7 dígitos.`);
  return cest ? tag('CEST', cest) : '';
}

export function validarItemFiscal(item: NFeItem, crt: CRT): void {
  assertNFeItemTax(item, crt);
  getCestXml(item);
}

/**
 * Grupo ICMS do item. Só serializa: o que entra e com que valor foi decidido
 * pelo núcleo (`src/lib/nfe/icms`), o mesmo que alimenta totais e nfe_item.
 */
export function buildIcmsXmlPorCRT(item: NFeItem, crt: CRT): string {
  validarItemFiscal(item, crt);
  return serializarIcms(icmsCanonicoDoItem(item, crt));
}

function legacyTributo(item: NFeItem, type: 'PIS' | 'COFINS'): TributoPisCofins {
  const cst = digits(type === 'PIS' ? item.cstPis : item.cstCofins, 2);
  const aliquota = type === 'PIS' ? item.aliquotaPis : item.aliquotaCofins;
  const valor = type === 'PIS' ? item.valorPis : item.valorCofins;
  return {
    cst,
    modo: PIS_COFINS_NT.has(cst) ? 'NAO_TRIBUTADO' : cst === '03' ? 'QUANTIDADE' : 'PERCENTUAL',
    base: valorLiquidoItem(item),
    aliquota,
    valor,
  };
}

function buildContributionXml(item: NFeItem, type: 'PIS' | 'COFINS') {
  const data = (type === 'PIS' ? item.pis : item.cofins) ?? legacyTributo(item, type);
  const cst = digits(data.cst, 2);
  const valueTag = type === 'PIS' ? 'vPIS' : 'vCOFINS';
  const rateTag = type === 'PIS' ? 'pPIS' : 'pCOFINS';
  const unitRateTag = type === 'PIS' ? 'vAliqProd' : 'vAliqProd';
  let group: string;
  if (data.modo === 'NAO_TRIBUTADO') {
    group = `<${type}NT>${tag('CST', cst)}</${type}NT>`;
  } else if (data.modo === 'QUANTIDADE') {
    const value = has(data.valor) ? Number(data.valor) : Number((Number(data.quantidade) * Number(data.aliquotaPorUnidade)).toFixed(2));
    const groupName = cst === '03' ? `${type}Qtde` : `${type}Outr`;
    group = `<${groupName}>${tag('CST', cst)}${tag('qBCProd', requiredNumber(item, 'quantidade', data.quantidade, quantity))}${tag(unitRateTag, requiredNumber(item, 'valorUnitario', data.aliquotaPorUnidade, rate))}${tag(valueTag, money(value))}</${groupName}>`;
  } else {
    const base = Number(data.base ?? valorLiquidoItem(item));
    const aliquota = Number(data.aliquota);
    const value = has(data.valor) ? Number(data.valor) : Number(((base * aliquota) / 100).toFixed(2));
    const groupName = cst === '01' || cst === '02' ? `${type}Aliq` : `${type}Outr`;
    group = `<${groupName}>${tag('CST', cst)}${tag('vBC', money(base))}${tag(rateTag, rate(aliquota))}${tag(valueTag, money(value))}</${groupName}>`;
  }
  return `<${type}>${group}</${type}>`;
}

export function buildPisXmlPorCRT(item: NFeItem, crt: CRT): string {
  void crt;
  return buildContributionXml(item, 'PIS');
}

export function buildCofinsXmlPorCRT(item: NFeItem, crt: CRT): string {
  void crt;
  return buildContributionXml(item, 'COFINS');
}

export function buildIpiXml(item: NFeItem) {
  const cst = digits(item.cstIpi, 2);
  if (!cst) return '';
  const cEnq = digits(item.codigoEnquadramentoIpi) || '999';
  if (['01', '02', '03', '04', '05', '51', '52', '53', '54', '55'].includes(cst)) {
    return `<IPI>${tag('cEnq', cEnq)}<IPINT>${tag('CST', cst)}</IPINT></IPI>`;
  }
  let calculation: string;
  if (has(item.quantidadeIpi) || has(item.valorUnidadeIpi)) {
    const value = has(item.valorIpi) ? Number(item.valorIpi) : Number((Number(item.quantidadeIpi) * Number(item.valorUnidadeIpi)).toFixed(2));
    calculation = tag('qUnid', requiredNumber(item, 'quantidadeIpi', item.quantidadeIpi, quantity)) + tag('vUnid', requiredNumber(item, 'valorUnidadeIpi', item.valorUnidadeIpi, rate)) + tag('vIPI', money(value));
  } else {
    const base = Number(item.baseCalculoIpi ?? valorLiquidoItem(item));
    const aliquota = Number(item.aliquotaIpi);
    const value = has(item.valorIpi) ? Number(item.valorIpi) : Number(((base * aliquota) / 100).toFixed(2));
    calculation = tag('vBC', money(base)) + tag('pIPI', rate(aliquota)) + tag('vIPI', money(value));
  }
  return `<IPI>${tag('cEnq', cEnq)}<IPITrib>${tag('CST', cst)}${calculation}</IPITrib></IPI>`;
}

function buildRtcPart(name: 'gIBSUF' | 'gIBSMun' | 'gCBS', part: NonNullable<NFeItem['rtc']>['ibsUf']) {
  const prefix = name === 'gIBSUF' ? 'IBSUF' : name === 'gIBSMun' ? 'IBSMun' : 'CBS';
  let xml = tag(`p${prefix}`, rate(part.aliquota));
  if (has(part.percentualDiferimento) || has(part.valorDiferido)) {
    xml += `<gDif>${tag('pDif', rate(part.percentualDiferimento ?? 0))}${tag('vDif', money(part.valorDiferido ?? 0))}</gDif>`;
  }
  if (has(part.percentualReducao)) {
    xml += `<gRed>${tag(`pRedAliq`, rate(part.percentualReducao))}${tag(`pAliqEfet`, rate(part.aliquotaEfetiva ?? part.aliquota * (1 - Number(part.percentualReducao) / 100)))}</gRed>`;
  }
  xml += tag(`v${prefix}`, money(part.valor));
  return `<${name}>${xml}</${name}>`;
}

export function buildRtcXml(item: NFeItem) {
  if (!item.rtc) return '';
  const rtc = item.rtc;
  return `<IBSCBS>${tag('CST', digits(rtc.cstIbsCbs, 3))}${tag('cClassTrib', digits(rtc.cClassTrib))}<gIBSCBS>${tag('vBC', money(rtc.baseCalculo))}${buildRtcPart('gIBSUF', rtc.ibsUf)}${buildRtcPart('gIBSMun', rtc.ibsMunicipio)}${tag('vIBS', money(rtc.valorIbs))}${buildRtcPart('gCBS', rtc.cbs)}</gIBSCBS></IBSCBS>`;
}

export function buildImpostoSeletivoXml(item: NFeItem) {
  const tax = item.impostoSeletivo;
  if (!tax) return '';
  const hasCalculation = [tax.baseCalculo, tax.aliquota, tax.aliquotaEspecifica, tax.quantidadeTributavel].some(has);
  if (!hasCalculation) return `<IS>${tag('CSTIS', digits(tax.cst, 3))}${tag('cClassTribIS', digits(tax.cClassTrib))}</IS>`;
  const specificBase = has(tax.quantidadeTributavel) || has(tax.unidadeTributavel);
  const quantityXml = specificBase
    ? tag('uTrib', clean(tax.unidadeTributavel)) + tag('qTrib', requiredNumber(item, 'quantidade', tax.quantidadeTributavel, quantity))
    : '';
  return `<IS>${tag('CSTIS', digits(tax.cst, 3))}${tag('cClassTribIS', digits(tax.cClassTrib))}${tag('vBCIS', requiredNumber(item, 'valorTotal', tax.baseCalculo))}${tag('pIS', requiredNumber(item, 'aliquotaIcms', tax.aliquota, rate))}${optionalTag('pISEspec', tax.aliquotaEspecifica, rate)}${quantityXml}${tag('vIS', money(tax.valor))}</IS>`;
}

function contributionValue(item: NFeItem, type: 'PIS' | 'COFINS') {
  const data = (type === 'PIS' ? item.pis : item.cofins) ?? legacyTributo(item, type);
  if (data.modo === 'NAO_TRIBUTADO') return 0;
  if (has(data.valor)) return Number(data.valor);
  return data.modo === 'QUANTIDADE'
    ? Number(data.quantidade) * Number(data.aliquotaPorUnidade)
    : Number(data.base ?? valorLiquidoItem(item)) * Number(data.aliquota) / 100;
}

export function calcularTotaisNFe(itens: NFeItem[], crt: CRT): TotaisNFe {
  const initial: TotaisNFe = { vProd: 0, vDesc: 0, vBC: 0, vICMS: 0, vICMSDeson: 0, vFCP: 0, vBCST: 0, vST: 0, vFCPST: 0, vFCPSTRet: 0, vPIS: 0, vCOFINS: 0, vIPI: 0, vIPIDevol: 0, vIS: 0, vBCIBSCBS: 0, vIBSUF: 0, vIBSMun: 0, vIBS: 0, vCBS: 0 };
  return itens.reduce((total, item) => {
    validarItemFiscal(item, crt);
    // vProd continua sendo o bruto: o desconto vai para vDesc, nunca embutido
    // no preco unitario, para a nota espelhar o preco de tabela.
    total.vProd += Number(item.valorTotal);
    total.vDesc += Number((Number(item.valorTotal) - valorLiquidoItem(item)).toFixed(2));
    // ICMS: soma do mesmo canônico que foi serializado no item.
    const icms = somarTotaisIcms([icmsCanonicoDoItem(item, crt)]);
    total.vBC += icms.vBC; total.vICMS += icms.vICMS; total.vICMSDeson += icms.vICMSDeson;
    total.vFCP += icms.vFCP; total.vBCST += icms.vBCST; total.vST += icms.vST;
    total.vFCPST += icms.vFCPST; total.vFCPSTRet += icms.vFCPSTRet;
    total.vPIS += contributionValue(item, 'PIS'); total.vCOFINS += contributionValue(item, 'COFINS');
    total.vIPI += Number(item.valorIpi ?? 0); total.vIPIDevol += Number(item.valorIpiDevolvido ?? 0);
    total.vIS += Number(item.impostoSeletivo?.valor ?? 0);
    if (item.rtc) {
      total.vBCIBSCBS += item.rtc.baseCalculo; total.vIBSUF += item.rtc.ibsUf.valor;
      total.vIBSMun += item.rtc.ibsMunicipio.valor; total.vIBS += item.rtc.valorIbs; total.vCBS += item.rtc.cbs.valor;
    }
    return total;
  }, initial);
}
