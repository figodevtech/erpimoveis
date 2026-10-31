import type { NFeItem, VersaoTotalizacaoNFe } from './types';
import {
  buildCofinsXmlPorCRT,
  buildIcmsXmlPorCRT,
  buildImpostoSeletivoXml,
  buildIpiXml,
  buildPisXmlPorCRT,
  buildRtcXml,
  getCestXml,
  normalizarCRT,
  valorTotalItemNFe,
} from './fiscal';
import { buildIcmsUFDestXml } from './difal';
import { escapeXml } from './xmlUtils';

function formatNumber(value: number, decimals: number): string {
  return Number(value ?? 0).toFixed(decimals);
}

function onlyDigits(value: unknown) {
  return String(value ?? '').replace(/\D/g, '');
}

/**
 * Gera <det> no layout NF-e 4.00.
 *
 * CRT 1 e 4 usam CSOSN. CRT 2 e 3 usam CST ICMS. A camada RTC é
 * emitida em paralelo aos tributos atuais quando estiver configurada.
 */
export function buildDetXml(item: NFeItem, crt: string | number, dataEmissao?: string, versaoTotalizacao?: VersaoTotalizacaoNFe): string {
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
  if (Number(formatNumber(Number(item.valorFrete ?? 0), 2)) > 0) {
    partes.push(`<vFrete>${formatNumber(Number(item.valorFrete), 2)}</vFrete>`);
  }
  if (Number(formatNumber(Number(item.valorDesconto ?? 0), 2)) > 0) {
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
  if (item.percentualDevolucao != null || item.valorIpiDevolvido != null) {
    const percentual = Number(item.percentualDevolucao ?? 0);
    const valorIpi = Number(item.valorIpiDevolvido ?? 0);
    if (!(percentual > 0 && percentual <= 100)) {
      throw new Error(`NFE_PDEVOL_INVALIDO: item ${item.numeroItem}; informe percentual entre 0,01 e 100.`);
    }
    if (valorIpi < 0) {
      throw new Error(`NFE_VIPIDEVOL_INVALIDO: item ${item.numeroItem}; o valor não pode ser negativo.`);
    }
    partes.push(
      `<impostoDevol><pDevol>${formatNumber(percentual, 2)}</pDevol>` +
      `<IPI><vIPIDevol>${formatNumber(valorIpi, 2)}</vIPIDevol></IPI></impostoDevol>`,
    );
  }
  if (item.informacoesAdicionaisProduto?.trim()) {
    partes.push(`<infAdProd>${escapeXml(item.informacoesAdicionaisProduto.trim())}</infAdProd>`);
  }
  // VB01-10: participação no total, incluindo frete, ST, FCP-ST, IPI e IPI
  // devolvido. A exceção de 2025/2026 exclui os tributos da reforma.
  partes.push(`<vItem>${formatNumber(valorTotalItemNFe(item, crtNormalizado, dataEmissao, versaoTotalizacao), 2)}</vItem>`);
  if (item.dfeReferenciado) {
    const chave = onlyDigits(item.dfeReferenciado.chaveAcesso);
    if (chave.length !== 44) {
      throw new Error(`NFE_DFE_REFERENCIADO_INVALIDO: item ${item.numeroItem}; a chave deve ter 44 dígitos.`);
    }
    const nItem = Number(item.dfeReferenciado.nItem ?? 0);
    if (item.dfeReferenciado.nItem != null && (!Number.isInteger(nItem) || nItem <= 0 || nItem > 990)) {
      throw new Error(`NFE_DFE_NITEM_INVALIDO: item ${item.numeroItem}; nItem deve estar entre 1 e 990.`);
    }
    partes.push(
      `<DFeReferenciado><chaveAcesso>${chave}</chaveAcesso>` +
      `${item.dfeReferenciado.nItem == null ? '' : `<nItem>${nItem}</nItem>`}</DFeReferenciado>`,
    );
  }
  partes.push('</det>');

  return partes.join('');
}
