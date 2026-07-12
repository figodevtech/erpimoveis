import { DOMParser } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';

/**
 * Assina a tag <infEvento> dentro do XML de evento (envEvento),
 * gerando o bloco <Signature> conforme exigido pela SEFAZ.
 */
export function assinarEventoNFeXml(
  xmlEnvEvento: string,
  privateKeyPem: string,
  certificatePem: string
): string {
  const doc = new DOMParser().parseFromString(xmlEnvEvento, 'text/xml');

  const infEventoNode =
    doc.getElementsByTagName('infEvento')[0] ||
    doc.getElementsByTagNameNS(
      'http://www.portalfiscal.inf.br/nfe',
      'infEvento'
    )[0];

  if (!infEventoNode) {
    throw new Error('Tag <infEvento> nao encontrada no XML de evento.');
  }

  const idInfEvento =
    infEventoNode.getAttribute('Id') ||
    infEventoNode.getAttribute('ID') ||
    infEventoNode.getAttribute('id');

  if (!idInfEvento) {
    throw new Error(
      'Atributo Id nao encontrado na tag <infEvento> para assinatura.'
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
    xpath:
      "/*[local-name()='envEvento']/*[local-name()='evento']/*[local-name()='infEvento']",
    uri: `#${idInfEvento}`,
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    ],
  });

  sx.computeSignature(xmlEnvEvento, {
    location: {
      reference:
        "/*[local-name()='envEvento']/*[local-name()='evento']/*[local-name()='infEvento']",
      action: 'after',
    },
  });

  const signedXml = sx.getSignedXml();

  if (!/<(?:\w+:)?Signature[\s>]/.test(signedXml)) {
    throw new Error('Falha ao gerar assinatura XML do evento da NF-e.');
  }

  if (!/<(?:\w+:)?X509Certificate[\s>]/.test(signedXml)) {
    throw new Error(
      'Assinatura XML do evento da NF-e foi gerada sem certificado X509.'
    );
  }

  return signedXml;
}
