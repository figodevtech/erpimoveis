import https from "https";
import { XMLParser } from "fast-xml-parser";

import { getNfeConsultaProtocoloUrl } from "@/lib/nfe/webservices";

export type AmbienteConsultaNfe = "HOMOLOGACAO" | "PRODUCAO";

export type ResultadoConsultaProtocolo = {
  httpStatus: number;
  respostaXml: string;
  soapEnvelope: string;
  cStat: string | null;
  xMotivo: string | null;
  protocolo: {
    cStat: string | null;
    xMotivo: string | null;
    nProt: string | null;
    dhRecbto: string | null;
    chNFe: string | null;
  };
  protNFeXml: string | null;
};

const CONSULTA_ACTION =
  "http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4/nfeConsultaNF";
const CONSULTA_TIMEOUT_MS = 30_000;

function primeiroNo(value: unknown): any {
  return Array.isArray(value) ? value[0] : value;
}

function encontrarNo(value: unknown, nome: string): any | null {
  if (!value || typeof value !== "object") return null;
  if (Object.prototype.hasOwnProperty.call(value, nome)) {
    return (value as Record<string, unknown>)[nome];
  }

  for (const child of Object.values(value as Record<string, unknown>)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        const found = encontrarNo(item, nome);
        if (found) return found;
      }
      continue;
    }

    const found = encontrarNo(child, nome);
    if (found) return found;
  }

  return null;
}

function texto(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

export function montarSoapConsultaProtocolo(
  chaveAcesso: string,
  ambiente: AmbienteConsultaNfe,
): string {
  if (!/^\d{44}$/.test(chaveAcesso)) {
    throw new Error("Chave de acesso inválida para consultar a NF-e.");
  }

  const tpAmb = ambiente === "PRODUCAO" ? "1" : "2";
  const consultaXml =
    '<consSitNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">' +
    `<tpAmb>${tpAmb}</tpAmb>` +
    "<xServ>CONSULTAR</xServ>" +
    `<chNFe>${chaveAcesso}</chNFe>` +
    "</consSitNFe>";

  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
    'xmlns:xsd="http://www.w3.org/2001/XMLSchema" ' +
    'xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">' +
    "<soap12:Body>" +
    '<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4">' +
    consultaXml +
    "</nfeDadosMsg>" +
    "</soap12:Body>" +
    "</soap12:Envelope>"
  );
}

export function interpretarRespostaConsultaProtocolo(
  respostaXml: string,
): Omit<ResultadoConsultaProtocolo, "httpStatus" | "respostaXml" | "soapEnvelope"> {
  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false });
  const parsed = parser.parse(respostaXml);
  const retConsSitNFe = primeiroNo(encontrarNo(parsed, "retConsSitNFe"));
  const protNFe = primeiroNo(
    encontrarNo(retConsSitNFe, "protNFe") ?? encontrarNo(parsed, "protNFe"),
  );
  const infProt = primeiroNo(
    encontrarNo(protNFe, "infProt") ?? encontrarNo(parsed, "infProt"),
  );

  return {
    cStat: texto(retConsSitNFe?.cStat),
    xMotivo: texto(retConsSitNFe?.xMotivo),
    protocolo: {
      cStat: texto(infProt?.cStat),
      xMotivo: texto(infProt?.xMotivo),
      nProt: texto(infProt?.nProt),
      dhRecbto: texto(infProt?.dhRecbto),
      chNFe: texto(infProt?.chNFe),
    },
    protNFeXml:
      respostaXml.match(/<(?:\w+:)?protNFe\b[^>]*>[\s\S]*?<\/(?:\w+:)?protNFe>/i)?.[0] ?? null,
  };
}

function postConsulta(
  url: string,
  soapEnvelope: string,
  agent: https.Agent,
): Promise<{ httpStatus: number; body: string }> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.request(
      {
        hostname: urlObj.hostname,
        port: urlObj.port || 443,
        path: `${urlObj.pathname}${urlObj.search}`,
        method: "POST",
        agent,
        timeout: CONSULTA_TIMEOUT_MS,
        headers: {
          "Content-Type": `application/soap+xml; charset=utf-8; action="${CONSULTA_ACTION}"`,
          "Content-Length": Buffer.byteLength(soapEnvelope).toString(),
        },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          resolve({ httpStatus: res.statusCode ?? 0, body });
        });
      },
    );

    req.on("timeout", () => {
      req.destroy(new Error("Tempo esgotado ao consultar a chave na SEFAZ."));
    });
    req.on("error", reject);
    req.write(soapEnvelope);
    req.end();
  });
}

/**
 * Consulta a situação de uma chave já enviada à SEFAZ.
 *
 * É usada principalmente depois da rejeição 204: essa rejeição prova que a
 * chave já chegou ao autorizador, então o protocolo deve ser recuperado antes
 * de registrar a nota local como rejeitada.
 */
export async function consultarProtocoloNfe(params: {
  chaveAcesso: string;
  ambiente: AmbienteConsultaNfe;
  agent: https.Agent;
}): Promise<ResultadoConsultaProtocolo> {
  const soapEnvelope = montarSoapConsultaProtocolo(params.chaveAcesso, params.ambiente);
  const url = getNfeConsultaProtocoloUrl({
    chaveAcesso: params.chaveAcesso,
    ambiente: params.ambiente,
  });
  const { httpStatus, body } = await postConsulta(url, soapEnvelope, params.agent);

  if (httpStatus !== 200) {
    throw new Error(`A consulta da chave na SEFAZ respondeu HTTP ${httpStatus}.`);
  }

  return {
    httpStatus,
    respostaXml: body,
    soapEnvelope,
    ...interpretarRespostaConsultaProtocolo(body),
  };
}
