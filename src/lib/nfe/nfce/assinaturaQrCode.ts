// Assinatura do QR Code v3 da NFC-e em contingência offline.
//
// NÃO confundir com a XMLDSig de `assinatura.ts`. As duas usam o mesmo
// certificado, mas assinam conteúdos diferentes:
//
//   assinatura.ts        assina o XML canonicalizado do <infNFe> (XMLDSig,
//                        com Reference, DigestValue e KeyInfo);
//   este módulo          assina uma STRING crua — a concatenação dos
//                        parâmetros 1 a 7 do QR Code — e devolve só o Base64
//                        da assinatura, sem envelope nenhum.
//
// Fonte: Manual de Padrões Técnicos do DANFE NFC-e e QR Code v6.0 e a página
// oficial da SEFAZ-PR (https://sped.fazenda.pr.gov.br/NFCe/Pagina/QR-Code),
// que especificam "RSA SHA-1 (Base64)" com "o mesmo certificado digital que
// assina a NFC-e".

import { createSign } from "crypto";

/**
 * Assina o payload do QR Code offline.
 *
 * - entrada: bytes UTF-8 da string, exatamente como ela vai para o QR Code;
 * - algoritmo: RSA com digest SHA-1 e padding PKCS#1 v1.5 — é o que "RSA
 *   SHA-1" designa nos documentos fiscais, e o mesmo esquema do
 *   `rsa-sha1` da XMLDSig usada na NFC-e. RSASSA-PSS precisaria estar
 *   declarado explicitamente, e não está;
 * - saída: Base64 puro, sem quebra de linha.
 *
 * O Base64 pode conter `+`, `/` e `=`. Eles NÃO podem ser escapados aqui: o
 * que a SEFAZ recalcula e compara é exatamente este texto.
 */
export function assinarPayloadQrCode(payload: string, privateKeyPem: string): string {
  if (typeof payload !== "string" || payload.length === 0) {
    throw new Error("Payload vazio: não há o que assinar no QR Code da NFC-e.");
  }

  // Um \r ou \n no payload mudaria os bytes assinados e a SEFAZ devolveria a
  // rejeição 583. Melhor falhar aqui, onde dá para diagnosticar.
  if (/[\r\n]/.test(payload)) {
    throw new Error("Payload do QR Code da NFC-e contém quebra de linha.");
  }

  if (!privateKeyPem?.trim()) {
    throw new Error(
      "Chave privada do certificado não disponível para assinar o QR Code da NFC-e.",
    );
  }

  const signer = createSign("sha1");
  signer.update(Buffer.from(payload, "utf8"));
  signer.end();

  return signer.sign(privateKeyPem, "base64");
}
