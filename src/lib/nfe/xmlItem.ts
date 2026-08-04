import type { NFeItem } from './types';
import {
  buildCofinsXmlPorCRT,
  buildIcmsXmlPorCRT,
  buildImpostoSeletivoXml,
  buildIpiXml,
  buildPisXmlPorCRT,
  buildRtcXml,
  getCestXml,
  normalizarCRT,
  valorLiquidoItem,
} from './fiscal';
import { buildIcmsUFDestXml } from './difal';
import { escapeXml } from './xmlUtils';

function formatNumber(value: number, decimals: number): string {
  return Number(value ?? 0).toFixed(decimals);
}

/**
 * Gera <det> no layout NF-e 4.00.
 *
 * CRT 1 e 4 usam CSOSN. CRT 2 e 3 usam CST ICMS. A camada RTC é
 * emitida em paralelo aos tributos atuais quando estiver configurada.
 */
export function buildDetXml(item: NFeItem, crt: string | number): string {
  const crtNormalizado = normalizarCRT(crt);
  const partes: string[] = [];

  const qCom = formatNumber(item.quantidade, 4);
  const vUnCom = formatNumber(item.valorUnitario, 10);
  const vProd = formatNumber(item.valorTotal, 2);

  const cEAN =
    item.codigoBarras && item.codigoBarras.trim() !== ''
      ? escapeXml(item.codigoBarras)
      : 'SEM GTIN';
  const cEANTrib = cEAN;

  partes.push(`<det nItem="${item.numeroItem}">`);

  partes.push('<prod>');
  partes.push(`<cProd>${escapeXml(item.codigoProduto)}</cProd>`);
  partes.push(`<cEAN>${cEAN}</cEAN>`);
  partes.push(`<xProd>${escapeXml(item.descricao)}</xProd>`);
  partes.push(`<NCM>${escapeXml(item.ncm)}</NCM>`);
  partes.push(getCestXml(item));
  partes.push(`<CFOP>${escapeXml(item.cfop)}</CFOP>`);
  partes.push(`<uCom>${escapeXml(item.unidade)}</uCom>`);
  partes.push(`<qCom>${qCom}</qCom>`);
  partes.push(`<vUnCom>${vUnCom}</vUnCom>`);
  partes.push(`<vProd>${vProd}</vProd>`);
  partes.push(`<cEANTrib>${cEANTrib}</cEANTrib>`);
  partes.push(`<uTrib>${escapeXml(item.unidade)}</uTrib>`);
  partes.push(`<qTrib>${qCom}</qTrib>`);
  partes.push(`<vUnTrib>${vUnCom}</vUnTrib>`);
  // Sequencia do grupo <prod> no leiaute 4.00: vFrete (I15), vSeg (I16),
  // vDesc (I17) e vOutro (I17a) vem depois de vUnTrib (I14a) e antes de
  // indTot. Fora dessa ordem a SEFAZ devolve rejeicao 225 (falha no schema).
  if (Number(item.valorFrete ?? 0) > 0) {
    partes.push(`<vFrete>${formatNumber(Number(item.valorFrete), 2)}</vFrete>`);
  }
  if (Number(item.valorDesconto ?? 0) > 0) {
    partes.push(`<vDesc>${formatNumber(Number(item.valorDesconto), 2)}</vDesc>`);
  }
  partes.push('<indTot>1</indTot>');
  partes.push('</prod>');

  partes.push('<imposto>');
  partes.push(`<ICMS>${buildIcmsXmlPorCRT(item, crtNormalizado)}</ICMS>`);
  partes.push(buildIpiXml(item));
  partes.push(buildPisXmlPorCRT(item, crtNormalizado));
  partes.push(buildCofinsXmlPorCRT(item, crtNormalizado));
  // Ordem da sequencia <imposto> no leiaute com RTC (PL_010):
  //   vTotTrib, (ICMS|ISSQN), IPI, II, PIS, PISST, COFINS, COFINSST,
  //   ICMSUFDest, IS, IBSCBS
  // ICMSUFDest vem DEPOIS de COFINS e ANTES dos grupos da reforma. Fora dessa
  // posicao a SEFAZ devolve rejeicao 225 (falha no schema do lote).
  if (item.icmsUfDest) {
    partes.push(buildIcmsUFDestXml(item.icmsUfDest));
  }
  partes.push(buildImpostoSeletivoXml(item));
  partes.push(buildRtcXml(item));
  partes.push('</imposto>');
  // vItem e o valor do item na operacao, ja liquido do desconto incondicional.
  // Nao acumula IBS/CBS destacados: em 2026 os tributos da reforma sao
  // informativos e nao elevam o valor comercial.
  partes.push(`<vItem>${formatNumber(valorLiquidoItem(item), 2)}</vItem>`);
  partes.push('</det>');

  return partes.join('');
}
