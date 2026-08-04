import type { CRT, NFeItem, TributoPisCofins } from './types';
import { assertNFeItemTax } from './taxRules';
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

/**
 * Valor do item efetivamente cobrado: vProd menos o desconto incondicional.
 * E a base padrao de ICMS, PIS/COFINS e IPI quando nada for informado — o
 * desconto incondicional reduz a base de calculo desses tributos.
 */
export function valorLiquidoItem(item: NFeItem) {
  const bruto = Number(item.valorTotal ?? 0);
  const desconto = Math.min(Math.max(0, Number(item.valorDesconto ?? 0)), Math.max(0, bruto));
  return Number((bruto - desconto).toFixed(2));
}

function baseIcms(item: NFeItem) {
  return Number(item.vBC ?? item.baseCalculoIcms ?? valorLiquidoItem(item));
}

function rateIcms(item: NFeItem) {
  return Number(item.pICMS ?? item.aliquotaIcms);
}

function valueIcms(item: NFeItem) {
  const informed = item.vICMS ?? item.valorIcms;
  return has(informed) ? Number(informed) : Number(((baseIcms(item) * rateIcms(item)) / 100).toFixed(2));
}

export function normalizarCRT(value: string | number | null | undefined): CRT {
  const crt = clean(value);
  if (['1', '2', '3', '4'].includes(crt)) return Number(crt) as CRT;
  throw new Error(`CRT do emitente inválido ou não informado: "${value ?? ''}".`);
}

function hasIcmsST(item: NFeItem) {
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

function fcpOwn(item: NFeItem) {
  if (![item.vBCFCP, item.pFCP, item.vFCP].some(has)) return '';
  return tag('vBCFCP', requiredNumber(item, 'vBCFCP', item.vBCFCP)) +
    tag('pFCP', requiredNumber(item, 'pFCP', item.pFCP, rate)) +
    tag('vFCP', requiredNumber(item, 'vFCP', item.vFCP));
}

function stFields(item: NFeItem) {
  const base = requiredNumber(item, 'vBCST', item.vBCST);
  const aliquota = requiredNumber(item, 'pICMSST', item.pICMSST, rate);
  const valor = has(item.vICMSST) ? Number(item.vICMSST) : Number(((Number(item.vBCST) * Number(item.pICMSST)) / 100).toFixed(2));
  let xml = tag('modBCST', clean(item.modBCST) || '4') +
    optionalTag('pMVAST', item.pMVAST, rate) + optionalTag('pRedBCST', item.pRedBCST, rate) +
    tag('vBCST', base) + tag('pICMSST', aliquota) + tag('vICMSST', money(valor));
  if ([item.vBCFCPST, item.pFCPST, item.vFCPST].some(has)) {
    xml += tag('vBCFCPST', requiredNumber(item, 'vBCFCPST', item.vBCFCPST)) +
      tag('pFCPST', requiredNumber(item, 'pFCPST', item.pFCPST, rate)) +
      tag('vFCPST', requiredNumber(item, 'vFCPST', item.vFCPST));
  }
  return xml;
}

function retainedFields(item: NFeItem) {
  return optionalTag('vBCSTRet', item.vBCSTRet) + optionalTag('pST', item.pST, rate) +
    optionalTag('vICMSSubstituto', item.vICMSSubstituto) + optionalTag('vICMSSTRet', item.vICMSSTRet) +
    optionalTag('vBCFCPSTRet', item.vBCFCPSTRet) + optionalTag('pFCPSTRet', item.pFCPSTRet, rate) +
    optionalTag('vFCPSTRet', item.vFCPSTRet);
}

function desoneracao(item: NFeItem) {
  if (![item.vICMSDeson, item.motDesICMS].some(has)) return '';
  return tag('vICMSDeson', requiredNumber(item, 'vICMSDeson', item.vICMSDeson)) +
    tag('motDesICMS', clean(item.motDesICMS));
}

function buildIcmsSn(item: NFeItem) {
  const csosn = digits(item.csosn, 3);
  const common = tag('orig', digits(item.orig)) + tag('CSOSN', csosn);
  if (csosn === '101') {
    return `<ICMSSN101>${common}${tag('pCredSN', requiredNumber(item, 'pCredSN', item.pCredSN, rate))}${tag('vCredICMSSN', requiredNumber(item, 'vCredICMSSN', item.vCredICMSSN))}</ICMSSN101>`;
  }
  if (csosn === '201') {
    return `<ICMSSN201>${common}${stFields(item)}${tag('pCredSN', requiredNumber(item, 'pCredSN', item.pCredSN, rate))}${tag('vCredICMSSN', requiredNumber(item, 'vCredICMSSN', item.vCredICMSSN))}</ICMSSN201>`;
  }
  if (csosn === '202' || csosn === '203') return `<ICMSSN202>${common}${stFields(item)}</ICMSSN202>`;
  if (csosn === '500') return `<ICMSSN500>${common}${retainedFields(item)}</ICMSSN500>`;
  if (csosn === '900') {
    let conditional = '';
    if ([item.vBC, item.baseCalculoIcms, item.pICMS, item.aliquotaIcms, item.vICMS, item.valorIcms].some(has)) {
      conditional += tag('modBC', clean(item.modBC) || '3') + tag('vBC', money(baseIcms(item))) +
        optionalTag('pRedBC', item.pRedBC, rate) + tag('pICMS', rate(rateIcms(item))) + tag('vICMS', money(valueIcms(item)));
    }
    if ([item.vBCST, item.pICMSST, item.vICMSST].some(has)) conditional += stFields(item);
    conditional += fcpOwn(item) + optionalTag('pCredSN', item.pCredSN, rate) + optionalTag('vCredICMSSN', item.vCredICMSSN);
    return `<ICMSSN900>${common}${conditional}</ICMSSN900>`;
  }
  return `<ICMSSN102>${common}</ICMSSN102>`;
}

function buildIcmsNormal(item: NFeItem) {
  const cst = digits(item.cstIcms ?? item.cst, 2);
  const common = tag('orig', digits(item.orig)) + tag('CST', cst);
  const own = () => tag('modBC', clean(item.modBC) || '3') + tag('vBC', money(baseIcms(item))) +
    tag('pICMS', rate(rateIcms(item))) + tag('vICMS', money(valueIcms(item))) + fcpOwn(item);
  switch (cst) {
    case '00': return `<ICMS00>${common}${own()}</ICMS00>`;
    case '10': return `<ICMS10>${common}${own()}${stFields(item)}</ICMS10>`;
    case '20': return `<ICMS20>${common}${tag('modBC', clean(item.modBC) || '3')}${tag('pRedBC', requiredNumber(item, 'pRedBC', item.pRedBC, rate))}${tag('vBC', money(baseIcms(item)))}${tag('pICMS', rate(rateIcms(item)))}${tag('vICMS', money(valueIcms(item)))}${fcpOwn(item)}${desoneracao(item)}</ICMS20>`;
    case '30': return `<ICMS30>${common}${stFields(item)}${desoneracao(item)}</ICMS30>`;
    case '40':
    case '41':
    case '50': return `<ICMS40>${common}${desoneracao(item)}</ICMS40>`;
    case '51': return `<ICMS51>${common}${optionalTag('modBC', item.modBC, clean)}${optionalTag('pRedBC', item.pRedBC, rate)}${optionalTag('vBC', item.vBC ?? item.baseCalculoIcms)}${optionalTag('pICMS', item.pICMS ?? item.aliquotaIcms, rate)}${optionalTag('vICMSOp', item.vICMSOp)}${optionalTag('pDif', item.pDif, rate)}${optionalTag('vICMSDif', item.vICMSDif)}${optionalTag('vICMS', item.vICMS ?? item.valorIcms)}${fcpOwn(item)}</ICMS51>`;
    case '60': return `<ICMS60>${common}${retainedFields(item)}</ICMS60>`;
    case '70': return `<ICMS70>${common}${tag('modBC', clean(item.modBC) || '3')}${tag('pRedBC', requiredNumber(item, 'pRedBC', item.pRedBC, rate))}${tag('vBC', money(baseIcms(item)))}${tag('pICMS', rate(rateIcms(item)))}${tag('vICMS', money(valueIcms(item)))}${stFields(item)}${fcpOwn(item)}${desoneracao(item)}</ICMS70>`;
    case '90': {
      let conditional = '';
      if ([item.vBC, item.baseCalculoIcms].some(has)) conditional += own();
      if ([item.vBCST, item.vICMSST].some(has)) conditional += stFields(item);
      conditional += desoneracao(item);
      return `<ICMS90>${common}${conditional}</ICMS90>`;
    }
    default: throw new Error(`NFE_ICMS_CST_UNSUPPORTED: item ${item.numeroItem}, CST ${cst}.`);
  }
}

export function validarItemFiscal(item: NFeItem, crt: CRT): void {
  assertNFeItemTax(item, crt);
  getCestXml(item);
}

export function buildIcmsXmlPorCRT(item: NFeItem, crt: CRT): string {
  validarItemFiscal(item, crt);
  return crt === 1 || crt === 4 ? buildIcmsSn(item) : buildIcmsNormal(item);
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
  const initial: TotaisNFe = { vProd: 0, vDesc: 0, vBC: 0, vICMS: 0, vICMSDeson: 0, vFCP: 0, vBCST: 0, vST: 0, vFCPST: 0, vFCPSTRet: 0, vPIS: 0, vCOFINS: 0, vIPI: 0, vIS: 0, vBCIBSCBS: 0, vIBSUF: 0, vIBSMun: 0, vIBS: 0, vCBS: 0 };
  return itens.reduce((total, item) => {
    validarItemFiscal(item, crt);
    // vProd continua sendo o bruto: o desconto vai para vDesc, nunca embutido
    // no preco unitario, para a nota espelhar o preco de tabela.
    total.vProd += Number(item.valorTotal);
    total.vDesc += Number((Number(item.valorTotal) - valorLiquidoItem(item)).toFixed(2));
    const cst = digits(item.cstIcms ?? item.cst, 2);
    if ((crt === 2 || crt === 3) && ['00', '10', '20', '51', '70', '90'].includes(cst) && has(item.vBC ?? item.baseCalculoIcms)) {
      total.vBC += baseIcms(item); total.vICMS += valueIcms(item);
    }
    total.vICMSDeson += Number(item.vICMSDeson ?? 0); total.vFCP += Number(item.vFCP ?? 0);
    total.vBCST += Number(item.vBCST ?? 0); total.vST += Number(item.vICMSST ?? 0);
    total.vFCPST += Number(item.vFCPST ?? 0); total.vFCPSTRet += Number(item.vFCPSTRet ?? 0);
    total.vPIS += contributionValue(item, 'PIS'); total.vCOFINS += contributionValue(item, 'COFINS');
    total.vIPI += Number(item.valorIpi ?? 0); total.vIS += Number(item.impostoSeletivo?.valor ?? 0);
    if (item.rtc) {
      total.vBCIBSCBS += item.rtc.baseCalculo; total.vIBSUF += item.rtc.ibsUf.valor;
      total.vIBSMun += item.rtc.ibsMunicipio.valor; total.vIBS += item.rtc.valorIbs; total.vCBS += item.rtc.cbs.valor;
    }
    return total;
  }, initial);
}
