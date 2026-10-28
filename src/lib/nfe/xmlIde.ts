// src/lib/nfe/xmlIde.ts

import type { NFeDocumentoReferenciado, NFeIde } from './types';
import { escapeXml } from './xmlUtils';

function onlyDigits(value: unknown) {
  return String(value ?? '').replace(/\D/g, '');
}

/**
 * Monta o XML do bloco <ide> na ORDEM exigida pelo schema da NF-e 4.00.
 */
export function buildIdeXml(
  ide: NFeIde,
  documentosReferenciados: NFeDocumentoReferenciado[] = [],
): string {
  const p: string[] = [];

  p.push('<ide>');
  p.push(`<cUF>${ide.cUF}</cUF>`);
  p.push(`<cNF>${ide.cNF}</cNF>`);
  p.push(`<natOp>${escapeXml(ide.natOp)}</natOp>`);
  p.push(`<mod>${ide.mod}</mod>`);
  p.push(`<serie>${ide.serie}</serie>`);
  p.push(`<nNF>${ide.nNF}</nNF>`);
  p.push(`<dhEmi>${ide.dhEmi}</dhEmi>`);
  p.push(`<tpNF>${ide.tpNF}</tpNF>`);
  p.push(`<idDest>${ide.idDest}</idDest>`);
  p.push(`<cMunFG>${ide.cMunFG}</cMunFG>`);
  p.push(`<tpImp>${ide.tpImp}</tpImp>`);
  p.push(`<tpEmis>${ide.tpEmis}</tpEmis>`);
  p.push(`<cDV>${ide.cDV}</cDV>`); // DV ANTES do tpAmb
  p.push(`<tpAmb>${ide.tpAmb}</tpAmb>`);
  p.push(`<finNFe>${ide.finNFe}</finNFe>`);
  p.push(`<indFinal>${ide.indFinal}</indFinal>`);
  p.push(`<indPres>${ide.indPres}</indPres>`);
  if (ide.indIntermed !== undefined) p.push(`<indIntermed>${ide.indIntermed}</indIntermed>`);
  p.push(`<procEmi>${ide.procEmi}</procEmi>`);
  p.push(`<verProc>${escapeXml(ide.verProc)}</verProc>`);
  // No XSD 4.00, NFref é o último grupo do <ide>: vem depois de verProc e,
  // quando houver contingência, depois de dhCont/xJust. O identificador B12a
  // do MOC não representa a posição física na sequência do schema.
  for (const documento of documentosReferenciados) {
    const chave = onlyDigits(documento.chaveAcesso);
    if (chave.length !== 44) {
      throw new Error('NFE_REFERENCIA_INVALIDA: a chave referenciada deve ter 44 dígitos.');
    }
    p.push(`<NFref><refNFe>${chave}</refNFe></NFref>`);
  }
  p.push('</ide>');

  return p.join('');
}

/**
 * Corrige rascunhos gravados pela versão que posicionava NFref após cMunFG.
 * A autorização sempre remove a assinatura anterior e assina novamente, então
 * esta normalização pode ocorrer imediatamente antes da numeração/assinatura.
 */
export function normalizarOrdemNfRefIde(xml: string): string {
  return xml.replace(/<ide>([\s\S]*?)<\/ide>/, (ideXml) => {
    const referencias = ideXml.match(/<NFref>[\s\S]*?<\/NFref>/g) ?? [];
    if (!referencias.length) return ideXml;

    const semReferencias = ideXml.replace(/<NFref>[\s\S]*?<\/NFref>/g, '');
    return semReferencias.replace('</ide>', `${referencias.join('')}</ide>`);
  });
}

/**
 * Remove o `<NFref>` do `<ide>` quando os itens já citam a origem.
 *
 * Os dois níveis de referenciamento são excludentes — informar `<NFref>` junto
 * com `<DFeReferenciado>` é a rejeição 1010. O nível de item é o mais
 * específico e é o exigido em devolução a partir de 01/09/2026, então é o
 * cabeçalho que sai.
 *
 * Existe para consertar rascunhos já gravados pela versão que emitia os dois:
 * a autorização reenvia o XML guardado, e sem isto uma nota rejeitada só sairia
 * depois de ser reaberta e salva de novo na tela.
 */
export function normalizarNiveisDeReferencia(xml: string): string {
  if (!/<DFeReferenciado>/.test(xml)) return xml;
  return xml.replace(/<ide>[\s\S]*?<\/ide>/, (ideXml) =>
    ideXml.replace(/<NFref>[\s\S]*?<\/NFref>/g, ''),
  );
}
