import "server-only";

import QRCode from "qrcode";

/**
 * Lê o QR Code do XML da NFC-e.
 *
 * A fonte é sempre o <infNFeSupl> do documento — nunca uma remontagem. O QR foi
 * assinado com o CSC no momento da emissão; recalculá-lo aqui produziria um
 * código diferente do que a SEFAZ recebeu se qualquer parâmetro tiver mudado
 * (CSC rotacionado, ambiente trocado), e o consumidor consultaria uma nota que
 * não existe.
 */
export function extrairQrCodeDoXml(xml: string | null | undefined): {
  qrCode: string | null;
  urlChave: string | null;
} {
  if (!xml) return { qrCode: null, urlChave: null };

  const qrMatch = xml.match(/<qrCode>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/qrCode>/);
  const urlMatch = xml.match(/<urlChave>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/urlChave>/);

  return {
    qrCode: qrMatch ? qrMatch[1].trim() : null,
    urlChave: urlMatch ? urlMatch[1].trim() : null,
  };
}

/**
 * Imagem do QR Code em data URL, para o DANFE funcionar impresso e em PDF sem
 * depender de rede.
 */
export async function gerarQrCodeDataUrl(conteudo: string): Promise<string> {
  return QRCode.toDataURL(conteudo, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 320,
  });
}

/** Chave em blocos de 4, como o DANFE NFC-e exige para leitura manual. */
export function formatarChaveEmBlocos(chave: string): string {
  return (chave ?? "").replace(/\D/g, "").replace(/(\d{4})(?=\d)/g, "$1 ").trim();
}
