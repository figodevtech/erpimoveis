// src/lib/nfe/xmlDest.ts
import { deveEnviarIeDoDestinatario } from './indIEDest';
import type { NFeDestinatario } from './types';
import { escapeXml } from './xmlUtils';

export function buildDestXml(dest: NFeDestinatario): string {
  const p: string[] = [];

  p.push('<dest>');
  if (dest.cnpj) {
    p.push(`<CNPJ>${dest.cnpj}</CNPJ>`);
  } else if (dest.cpf) {
    p.push(`<CPF>${dest.cpf}</CPF>`);
  }

  p.push(`<xNome>${escapeXml(dest.razaoSocial)}</xNome>`);

  p.push('<enderDest>');
  p.push(`<xLgr>${escapeXml(dest.endereco.logradouro)}</xLgr>`);
  p.push(`<nro>${escapeXml(dest.endereco.numero)}</nro>`);
  if (dest.endereco.complemento) {
    p.push(`<xCpl>${escapeXml(dest.endereco.complemento)}</xCpl>`);
  }
  p.push(`<xBairro>${escapeXml(dest.endereco.bairro)}</xBairro>`);
  p.push(`<cMun>${dest.endereco.codigoMunicipio}</cMun>`);
  p.push(`<xMun>${escapeXml(dest.endereco.nomeMunicipio)}</xMun>`);
  p.push(`<UF>${dest.endereco.uf}</UF>`);
  p.push(`<CEP>${dest.endereco.cep}</CEP>`);
  p.push(`<cPais>${dest.endereco.codigoPais}</cPais>`);
  p.push(`<xPais>${escapeXml(dest.endereco.nomePais)}</xPais>`);
  if (dest.endereco.telefone) {
    p.push(`<fone>${dest.endereco.telefone}</fone>`);
  }
  p.push('</enderDest>');

  p.push(`<indIEDest>${dest.indIEDest}</indIEDest>`);

  // A IE só acompanha o destinatário contribuinte do ICMS. Para isento (2) e
  // não contribuinte (9) a tag é omitida — mandar uma IE numérica nesses casos
  // é o que produz a rejeição 306 quando a inscrição não está ativa na UF.
  // A guarda fica aqui, e não só em quem monta o destinatário, porque este é o
  // único ponto por onde todo XML passa.
  if (deveEnviarIeDoDestinatario(dest.indIEDest, dest.inscricaoEstadual)) {
    p.push(`<IE>${escapeXml(String(dest.inscricaoEstadual).trim())}</IE>`);
  }

  p.push('</dest>');

  return p.join('');
}
