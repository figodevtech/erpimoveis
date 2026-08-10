import "server-only";

import { gerarQrCodeNfce, injetarInfNFeSupl, versaoExigeCsc } from "@/lib/nfe/nfce/qrCode";
import { resolveUrlChaveNfce, resolveUrlQrCodeNfce } from "@/lib/nfe/webservices";
import { getCscCredencial, getQrCodeVersao } from "@/services/fiscal/nfeConfigService";

/** Lê o DigestValue da assinatura — só existe depois de assinar. */
function extrairDigestValue(xmlAssinado: string): string {
  const match = xmlAssinado.match(/<DigestValue>([^<]+)<\/DigestValue>/);
  if (!match) {
    throw new Error("XML assinado da NFC-e não tem DigestValue para compor o QR Code.");
  }
  return match[1];
}

function extrairTag(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return match ? match[1] : "";
}

/** Recorta um grupo do XML para não confundir tags homônimas. */
function extrairGrupo(xml: string, grupo: string): string {
  const match = xml.match(new RegExp(`<${grupo}>[\\s\\S]*?</${grupo}>`));
  return match ? match[0] : "";
}

/**
 * Documento do CONSUMIDOR, não do emitente.
 *
 * `<CNPJ>` aparece primeiro no grupo <emit>: buscar solto no documento pegaria
 * o CNPJ da própria empresa e o QR Code sairia com o destinatário errado.
 */
function extrairDocumentoDestinatario(xml: string): string {
  const dest = extrairGrupo(xml, "dest");
  if (!dest) return "";
  return extrairTag(dest, "CPF") || extrairTag(dest, "CNPJ");
}

/** Consumidor estrangeiro (`tp_idDest=3`), quando a nota o identificar assim. */
function extrairIdEstrangeiro(xml: string): string {
  const dest = extrairGrupo(xml, "dest");
  if (!dest) return "";
  return extrairTag(dest, "idEstrangeiro");
}

/**
 * Totais da nota.
 *
 * `<vICMS>` também existe dentro de cada item: sem recortar o <ICMSTot>, o QR
 * levaria o ICMS do primeiro produto no lugar do total do documento.
 */
function extrairTotal(xml: string, tag: string): string {
  return extrairTag(extrairGrupo(xml, "ICMSTot"), tag);
}

/**
 * Acrescenta o <infNFeSupl> com o QR Code ao XML JÁ ASSINADO da NFC-e.
 *
 * A ordem importa em dois sentidos:
 *
 *  1. depois da numeração definitiva, porque o QR carrega a chave de acesso;
 *  2. depois da assinatura, porque na contingência offline o QR precisa do
 *     DigestValue — e porque a assinatura cobre apenas <infNFe>, então
 *     acrescentar <infNFeSupl> em seguida não a invalida.
 */
export async function anexarQrCodeNfce(params: {
  xmlAssinado: string;
  chaveAcesso: string;
  uf: string;
  ambiente: "HOMOLOGACAO" | "PRODUCAO";
  empresaId?: number;
  /**
   * Chave privada do certificado, a mesma que assinou o XML. Só é usada no
   * QR Code v3 em contingência offline, que leva assinatura própria.
   */
  privateKeyPem?: string;
}): Promise<{ xml: string; qrCode: string; urlChave: string }> {
  // Duas URLs, duas finalidades: o QR Code (ZX02) e a consulta por chave (ZX03).
  const urlConsulta = resolveUrlQrCodeNfce(params.uf, params.ambiente);
  const urlChave = resolveUrlChaveNfce(params.uf, params.ambiente);
  const versao = await getQrCodeVersao(params.empresaId);

  // A versão 3 dispensa CSC (NT 2025.001): a autenticidade deixa de depender do
  // código do contribuinte. Só buscamos a credencial quando ela é mesmo usada —
  // assim a empresa que já migrou para a v3 não precisa manter CSC cadastrado.
  const credencial = versaoExigeCsc(versao)
    ? await getCscCredencial(params.ambiente, params.empresaId)
    : null;

  const tpEmis = Number(extrairTag(params.xmlAssinado, "tpEmis") || 1);
  const offline = tpEmis === 9;

  const qr = gerarQrCodeNfce({
    chaveAcesso: params.chaveAcesso,
    tpAmb: params.ambiente === "PRODUCAO" ? 1 : 2,
    tpEmis,
    urlConsulta,
    urlChave,
    versao,
    ...(credencial ? { csc: credencial.csc, idCsc: credencial.idCsc } : {}),
    // Campos só exigidos na contingência: lidos do próprio documento, para o QR
    // nunca divergir do XML que vai ser transmitido. O digVal só serve à v2.
    ...(offline
      ? {
          dhEmi: extrairTag(params.xmlAssinado, "dhEmi"),
          vNF: extrairTotal(params.xmlAssinado, "vNF"),
          digVal: versaoExigeCsc(versao) ? extrairDigestValue(params.xmlAssinado) : undefined,
          documentoDestinatario: extrairDocumentoDestinatario(params.xmlAssinado),
          idEstrangeiro: extrairIdEstrangeiro(params.xmlAssinado),
          privateKeyPem: params.privateKeyPem,
        }
      : {}),
  });

  // Log de diagnóstico: uma falha aqui só aparece depois que o cupom já foi
  // entregue ao consumidor. Nada de segredo nem de documento do consumidor.
  if (offline) {
    console.info("[nfce] QR Code de contingência gerado", {
      qrVersion: versao,
      tpEmis: 9,
      tpAmb: params.ambiente === "PRODUCAO" ? 1 : 2,
      uf: params.uf,
      consumidorIdentificado: Boolean(extrairDocumentoDestinatario(params.xmlAssinado)),
      algoritmoAssinatura: versao === 3 ? "RSA-SHA1/Base64" : "SHA-1+CSC",
    });
  }

  return {
    xml: injetarInfNFeSupl(params.xmlAssinado, qr),
    qrCode: qr.qrCode,
    urlChave: qr.urlChave,
  };
}
