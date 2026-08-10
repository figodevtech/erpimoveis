import { DOMParser } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';

/**
 * Assinatura dos documentos auxiliares da NF-e/NFC-e.
 *
 * Evento (cancelamento) e pedido de inutilização têm a mesma mecânica: um bloco
 * interno com atributo `Id`, assinado com referência a ele e a `<Signature>`
 * logo depois. Só muda o nome do bloco e o caminho até ele — por isso um
 * assinador só, parametrizado, em vez de dois quase iguais.
 */

type AlvoAssinatura = {
  /** Nome da tag que carrega o `Id` assinado. */
  tag: string;
  /** Caminho XPath até essa tag. */
  xpath: string;
};

const ALVO_EVENTO: AlvoAssinatura = {
  tag: 'infEvento',
  xpath: "/*[local-name()='envEvento']/*[local-name()='evento']/*[local-name()='infEvento']",
};

const ALVO_INUTILIZACAO: AlvoAssinatura = {
  tag: 'infInut',
  xpath: "/*[local-name()='inutNFe']/*[local-name()='infInut']",
};

function assinar(
  xml: string,
  privateKeyPem: string,
  certificatePem: string,
  alvo: AlvoAssinatura,
): string {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');

  const node =
    doc.getElementsByTagName(alvo.tag)[0] ||
    doc.getElementsByTagNameNS('http://www.portalfiscal.inf.br/nfe', alvo.tag)[0];

  if (!node) {
    throw new Error(`Tag <${alvo.tag}> nao encontrada no XML para assinatura.`);
  }

  const id =
    node.getAttribute('Id') || node.getAttribute('ID') || node.getAttribute('id');

  if (!id) {
    throw new Error(`Atributo Id nao encontrado na tag <${alvo.tag}> para assinatura.`);
  }

  const sx = new SignedXml({
    privateKey: privateKeyPem,
    publicCert: certificatePem,
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
  });

  sx.addReference({
    xpath: alvo.xpath,
    uri: `#${id}`,
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    ],
  });

  sx.computeSignature(xml, {
    location: { reference: alvo.xpath, action: 'after' },
  });

  const signedXml = sx.getSignedXml();

  if (!/<(?:\w+:)?Signature[\s>]/.test(signedXml)) {
    throw new Error(`Falha ao gerar assinatura XML de <${alvo.tag}>.`);
  }

  if (!/<(?:\w+:)?X509Certificate[\s>]/.test(signedXml)) {
    throw new Error(`Assinatura XML de <${alvo.tag}> foi gerada sem certificado X509.`);
  }

  return signedXml;
}

/**
 * Assina a tag <infEvento> dentro do XML de evento (envEvento),
 * gerando o bloco <Signature> conforme exigido pela SEFAZ.
 */
export function assinarEventoNFeXml(
  xmlEnvEvento: string,
  privateKeyPem: string,
  certificatePem: string,
): string {
  return assinar(xmlEnvEvento, privateKeyPem, certificatePem, ALVO_EVENTO);
}

/** Assina a tag <infInut> do pedido de inutilização de numeração. */
export function assinarInutilizacaoXml(
  xmlInutNFe: string,
  privateKeyPem: string,
  certificatePem: string,
): string {
  return assinar(xmlInutNFe, privateKeyPem, certificatePem, ALVO_INUTILIZACAO);
}
