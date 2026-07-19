import { DOMParser } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';

/**
 * Assina a tag <infNFe> dentro do XML da NF-e,
 * gerando o bloco <Signature> conforme exigido pela SEFAZ.
 */
export function assinarNFeXml(
  xmlNFe: string,
  privateKeyPem: string,
  certificatePem: string
): string {
  // Uma NF-e rejeitada pode ter sido armazenada já assinada. Removemos a
  // assinatura anterior para que uma nova tentativa nunca gere duas assinaturas.
  const xmlSemAssinaturaAnterior = xmlNFe.replace(
    /<(?:\w+:)?Signature\b[^>]*>[\s\S]*?<\/(?:\w+:)?Signature>/g,
    ''
  );
  const doc = new DOMParser().parseFromString(xmlSemAssinaturaAnterior, 'text/xml');

  const infNFeNode =
    doc.getElementsByTagName('infNFe')[0] ||
    doc.getElementsByTagNameNS(
      'http://www.portalfiscal.inf.br/nfe',
      'infNFe'
    )[0];

  if (!infNFeNode) {
    throw new Error('Tag <infNFe> nao encontrada no XML da NFe.');
  }

  const idInfNFe =
    infNFeNode.getAttribute('Id') ||
    infNFeNode.getAttribute('ID') ||
    infNFeNode.getAttribute('id');

  if (!idInfNFe) {
    throw new Error(
      'Atributo Id nao encontrado na tag <infNFe> para assinatura.'
    );
  }

  const sx = new SignedXml({
    privateKey: privateKeyPem,
    publicCert: certificatePem,
    canonicalizationAlgorithm:
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
  });

  sx.addReference({
    xpath: "/*[local-name()='NFe']/*[local-name()='infNFe']",
    uri: `#${idInfNFe}`,
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    ],
  });

  sx.computeSignature(xmlSemAssinaturaAnterior, {
    location: {
      reference: "/*[local-name()='NFe']/*[local-name()='infNFe']",
      action: 'after',
    },
  });

  const signedXml = sx.getSignedXml();

  if (!/<(?:\w+:)?Signature[\s>]/.test(signedXml)) {
    throw new Error('Falha ao gerar assinatura XML da NF-e.');
  }

  if (!/<(?:\w+:)?X509Certificate[\s>]/.test(signedXml)) {
    throw new Error('Assinatura XML da NF-e foi gerada sem certificado X509.');
  }

  return signedXml;
}
