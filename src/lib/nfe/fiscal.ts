import type { CRT, NFeItem, TributoPisCofins, VersaoTotalizacaoNFe } from './types';
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

export function validarPisCofinsStSuportado(item: NFeItem): void {
  if (item.pisST || item.cofinsST) {
    throw new Error(
      `NFE_PIS_COFINS_ST_NAO_SUPORTADO: item ${item.numeroItem}; ` +
      'a composição UB16-10 aceita os valores explícitos, mas a emissão ainda não captura, persiste nem serializa PIS-ST/COFINS-ST.',
    );
  }
}

export function validarItemFiscal(item: NFeItem, crt: CRT): void {
  validarPisCofinsStSuportado(item);
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

/** Mesmo valor arredondado que será serializado em IPITrib/vIPI. */
export function valorIpiDoItem(item: NFeItem): number {
  const cst = digits(item.cstIpi, 2);
  if (!cst || ['01', '02', '03', '04', '05', '51', '52', '53', '54', '55'].includes(cst)) return 0;
  const valor = has(item.valorIpi) ? Number(item.valorIpi)
    : has(item.quantidadeIpi) || has(item.valorUnidadeIpi)
      ? Number(item.quantidadeIpi) * Number(item.valorUnidadeIpi)
      : Number(item.baseCalculoIpi ?? valorLiquidoItem(item)) * Number(item.aliquotaIpi) / 100;
  return Number(valor.toFixed(2));
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
    const value = valorIpiDoItem(item);
    calculation = tag('qUnid', requiredNumber(item, 'quantidadeIpi', item.quantidadeIpi, quantity)) + tag('vUnid', requiredNumber(item, 'valorUnidadeIpi', item.valorUnidadeIpi, rate)) + tag('vIPI', money(value));
  } else {
    const base = Number(item.baseCalculoIpi ?? valorLiquidoItem(item));
    const aliquota = Number(item.aliquotaIpi);
    const value = valorIpiDoItem(item);
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

/**
 * NT 2025.002 v1.53 / NT 2026.008 v1.01, VB01-10. Somente componentes
 * suportados e efetivamente serializados pelo motor. A data é a emissão do
 * documento, nunca o relógio do processo. RTC_2027 exige ativação explícita:
 * o fluxo completo permanece RTC_2026 até adaptar financeiro e homologar.
 * vProd continua excluindo IBS/CBS/IS: não há incorporação dupla em 2027.
 */
export function valorTotalItemNFe(item: NFeItem, crt: CRT, dataEmissao?: string, versao: VersaoTotalizacaoNFe = 'RTC_2026'): number {
  const centavos = (valor: unknown) => Math.round(Number(Number(valor ?? 0).toFixed(2)) * 100);
  const icms = icmsCanonicoDoItem(item, crt);
  let total = centavos(item.valorTotal) - centavos(item.valorDesconto)
    + centavos(item.valorFrete) + centavos(icms.vICMSST) + centavos(icms.vFCPST)
    + centavos(valorIpiDoItem(item)) + centavos(item.valorIpiDevolvido);
  if (versao === 'RTC_2027') {
    if (!dataEmissao || !/^\d{4}-\d{2}-\d{2}T/.test(dataEmissao) || dataEmissao.slice(0, 4) < '2027') {
      throw new Error('NFE_TOTAL_RTC_VIGENCIA: RTC_2027 exige data de emissão a partir de 2027.');
    }
    total += centavos(item.rtc?.valorIbs) + centavos(item.rtc?.cbs.valor)
      + centavos(item.impostoSeletivo?.valor);
  }
  return total / 100;
}

export function calcularTotaisNFe(itens: NFeItem[], crt: CRT): TotaisNFe {
  const initial: TotaisNFe = { vProd: 0, vDesc: 0, vBC: 0, vICMS: 0, vICMSDeson: 0, vFCP: 0, vBCST: 0, vST: 0, vFCPST: 0, vFCPSTRet: 0, vPIS: 0, vCOFINS: 0, vIPI: 0, vIPIDevol: 0, vIS: 0, vBCIBSCBS: 0, vIBSUF: 0, vIBSMun: 0, vIBS: 0, vCBS: 0 };
  return itens.reduce((total, item) => {
    validarItemFiscal(item, crt);
    // vProd continua sendo o bruto: o desconto vai para vDesc, nunca embutido
    // no preco unitario, para a nota espelhar o preco de tabela.
    total.vProd += Number(Number(item.valorTotal).toFixed(2));
    total.vDesc += Number(Number(item.valorDesconto ?? 0).toFixed(2));
    // ICMS: soma do mesmo canônico que foi serializado no item.
    const icms = somarTotaisIcms([icmsCanonicoDoItem(item, crt)]);
    total.vBC += icms.vBC; total.vICMS += icms.vICMS; total.vICMSDeson += icms.vICMSDeson;
    total.vFCP += icms.vFCP; total.vBCST += icms.vBCST; total.vST += icms.vST;
    total.vFCPST += icms.vFCPST; total.vFCPSTRet += icms.vFCPSTRet;
    total.vPIS += Number(contributionValue(item, 'PIS').toFixed(2)); total.vCOFINS += Number(contributionValue(item, 'COFINS').toFixed(2));
    total.vIPI += valorIpiDoItem(item); total.vIPIDevol += Number(Number(item.valorIpiDevolvido ?? 0).toFixed(2));
    total.vIS += Number(Number(item.impostoSeletivo?.valor ?? 0).toFixed(2));
    if (item.rtc) {
      total.vBCIBSCBS += Number(item.rtc.baseCalculo.toFixed(2)); total.vIBSUF += Number(item.rtc.ibsUf.valor.toFixed(2));
      total.vIBSMun += Number(item.rtc.ibsMunicipio.valor.toFixed(2)); total.vIBS += Number(item.rtc.valorIbs.toFixed(2)); total.vCBS += Number(item.rtc.cbs.valor.toFixed(2));
    }
    return total;
  }, initial);
}
