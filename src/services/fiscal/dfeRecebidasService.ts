import https from "https";
import { XMLParser } from "fast-xml-parser";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isValidCnpj, normalizeCnpj } from "@/lib/fiscal-identifiers";
import { matchesFiscalNoteSearch } from "@/lib/fiscal-search";
import { parsePostgresIntegerId } from "@/lib/postgres-id";
import { carregarCertificadoA1 } from "@/lib/nfe/certificado";
import { assinarEventoNFeXml } from "@/lib/nfe/assinaturaEvento";
import { traduzStatusNfe } from "@/lib/nfe/statusNfe";
import { getNfeConsultaProtocoloUrl } from "@/lib/nfe/webservices";
import type { EmpresaRow } from "@/lib/nfe/types";

import {
  extractDocZipList,
  findRetDistDFeInt,
  parseDfeXml,
  unzipDocZip,
} from "./dfeXmlParser";

type SyncDfeParams = {
  empresaId?: number;
  confirmCompanyChange?: boolean;
};

const DFE_SYNC_COOLDOWN_MS = 70 * 60 * 1000;

type ListDfeParams = {
  page?: number;
  limit?: number;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: string;
  modelo?: string;
};

type ConsultaChaveParams = {
  empresaId?: number;
  chave: string;
  force?: boolean;
};

export type TipoManifestacaoDestinatario =
  | "CIENCIA"
  | "CONFIRMACAO"
  | "DESCONHECIMENTO"
  | "OPERACAO_NAO_REALIZADA";

type ManifestarParams = {
  documentoId: number;
  tipo: TipoManifestacaoDestinatario;
  justificativa?: string;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  // Mesmo cuidado de dfeXmlParser.ts: campo de código com zero à esquerda não
  // pode virar `Number`.
  numberParseOptions: { hex: true, leadingZeros: false },
});

const UF_CODES: Record<string, string> = {
  RO: "11",
  AC: "12",
  AM: "13",
  RR: "14",
  PA: "15",
  AP: "16",
  TO: "17",
  MA: "21",
  PI: "22",
  CE: "23",
  RN: "24",
  PB: "25",
  PE: "26",
  AL: "27",
  SE: "28",
  BA: "29",
  MG: "31",
  ES: "32",
  RJ: "33",
  SP: "35",
  PR: "41",
  SC: "42",
  RS: "43",
  MS: "50",
  MT: "51",
  GO: "52",
  DF: "53",
};

const XML_COMPLETO_RETRY_INTERVAL_MS = DFE_SYNC_COOLDOWN_MS;

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function onlyDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function maskCnpj(value: unknown) {
  const canonical = normalizeCnpj(value);
  if (canonical.length !== 14) return "Não informado";
  return `**.***.***/${canonical.slice(8, 12)}-${canonical.slice(12)}`;
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeNsu(value: unknown) {
  return String(value ?? "").replace(/\D/g, "").padStart(15, "0").slice(-15);
}

function normalizeAmbiente(value: unknown): "HOMOLOGACAO" | "PRODUCAO" {
  return String(value ?? "").toUpperCase() === "PRODUCAO" ? "PRODUCAO" : "HOMOLOGACAO";
}

function escapeXml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatDateTimeNFe(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const offsetMinutes = date.getTimezoneOffset();
  const sign = offsetMinutes > 0 ? "-" : "+";
  const total = Math.abs(offsetMinutes);

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${pad(
    Math.floor(total / 60),
  )}:${pad(total % 60)}`;
}

function getCufAutor(empresa: EmpresaRow) {
  const uf = String(empresa.uf ?? "").toUpperCase();
  return UF_CODES[uf] ?? "35";
}

async function getEmpresa(empresaId?: number) {
  const normalizedEmpresaId =
    empresaId === undefined ? undefined : parsePostgresIntegerId(empresaId);

  if (empresaId !== undefined && normalizedEmpresaId === null) {
    throw Object.assign(
      new Error("ID da empresa inválido: informe o ID interno, não o CNPJ."),
      { statusCode: 400 },
    );
  }

  let query = supabaseAdmin.from("empresa").select("*");
  if (normalizedEmpresaId) query = query.eq("id", normalizedEmpresaId);
  const { data, error } = await query.order("id", { ascending: true }).limit(1).maybeSingle<EmpresaRow>();

  if (error) throw error;
  if (!data) throw new Error("Empresa não encontrada para sincronização fiscal.");
  if (!isValidCnpj(data.cnpj)) throw new Error("Empresa não possui CNPJ válido.");

  return data;
}

async function getControle(empresaId: number) {
  const { data, error } = await supabaseAdmin
    .from("fiscal_dfe_controle")
    .select("*")
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (error) throw error;
  if (data) return data;

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("fiscal_dfe_controle")
    .insert({ empresa_id: empresaId })
    .select("*")
    .single();

  if (insertError) throw insertError;
  return inserted;
}

async function tryLock(empresaId: number) {
  const lockUntil = new Date(Date.now() + 3 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin.rpc("fiscal_try_lock_dfe", {
    p_empresa_id: empresaId,
    p_lock_until: lockUntil,
  });

  if (error) throw error;
  return data === true;
}

async function releaseLock(empresaId: number) {
  await supabaseAdmin
    .from("fiscal_dfe_controle")
    .update({
      sync_lock_until: null,
      updatedat: new Date().toISOString(),
    })
    .eq("empresa_id", empresaId);
}

type DistribuicaoDfeRequest =
  | { tipo: "distNSU"; ultNsu: string }
  | { tipo: "consChNFe"; chave: string }
  | { tipo: "consNSU"; nsu: string };

function buildDistDFeEnvelope(empresa: EmpresaRow, request: DistribuicaoDfeRequest) {
  const ambiente = empresa.ambiente === "PRODUCAO" ? "1" : "2";
  const cnpj = normalizeCnpj(empresa.cnpj);
  const cUFAutor = getCufAutor(empresa);
  const consulta =
    request.tipo === "distNSU"
      ? `<distNSU><ultNSU>${request.ultNsu.padStart(15, "0")}</ultNSU></distNSU>`
      : request.tipo === "consChNFe"
        ? `<consChNFe><chNFe>${onlyDigits(request.chave)}</chNFe></consChNFe>`
        : `<consNSU><NSU>${normalizeNsu(request.nsu)}</NSU></consNSU>`;

  const distDFeInt =
    `<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">` +
    `<tpAmb>${ambiente}</tpAmb>` +
    `<cUFAutor>${cUFAutor}</cUFAutor>` +
    `<CNPJ>${cnpj}</CNPJ>` +
    consulta +
    `</distDFeInt>`;

  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xmlns:xsd="http://www.w3.org/2001/XMLSchema" ` +
    `xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap12:Body>` +
    `<nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">` +
    `<nfeDadosMsg>${distDFeInt}</nfeDadosMsg>` +
    `</nfeDistDFeInteresse>` +
    `</soap12:Body>` +
    `</soap12:Envelope>`
  );
}

function postSoapComCert(
  url: string,
  soapEnvelope: string,
  agent: https.Agent,
  action = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse",
): Promise<{ httpStatus: number; body: string }> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);

    const req = https.request(
      {
        hostname: urlObj.hostname,
        port: urlObj.port || 443,
        path: urlObj.pathname,
        method: "POST",
        agent,
        headers: {
          "Content-Type": `application/soap+xml; charset=utf-8; action="${action}"`,
          "Content-Length": Buffer.byteLength(soapEnvelope).toString(),
        },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          resolve({ httpStatus: res.statusCode ?? 0, body: data });
        });
      },
    );

    req.on("error", reject);
    req.write(soapEnvelope);
    req.end();
  });
}

async function callDistribuicaoDfe(empresa: EmpresaRow, request: DistribuicaoDfeRequest, agent: https.Agent) {
  const url =
    empresa.ambiente === "PRODUCAO"
      ? "https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx"
      : "https://hom.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx";

  const envelope = buildDistDFeEnvelope(empresa, request);
  const response = await postSoapComCert(url, envelope, agent);

  if (response.httpStatus !== 200) {
    throw new Error(`Erro HTTP ${response.httpStatus} ao consultar NFeDistribuicaoDFe.`);
  }

  const parsed = parser.parse(response.body);
  const ret = findRetDistDFeInt(parsed);

  if (!ret) {
    throw new Error("Retorno retDistDFeInt não encontrado na resposta da SEFAZ.");
  }

  return ret;
}

function prepararDocumentoDfe(doc: { nsu: string; schema: string; content: string }) {
  if (!doc.nsu || !doc.schema || !doc.content) return null;
  if (!doc.schema.startsWith("resNFe") && !doc.schema.startsWith("procNFe")) return null;

  const xml = unzipDocZip(doc.content);
  const parsed = parseDfeXml(xml, doc.schema);
  const chaveAcesso = parsed.chaveAcesso?.trim() ? parsed.chaveAcesso.trim() : null;

  return {
    nsu: doc.nsu,
    schema: doc.schema,
    tipo_documento: parsed.tipoDocumento,
    chave_acesso: chaveAcesso,
    data_emissao: parsed.dataEmissao,
    emitente_nome: parsed.emitenteNome,
    emitente_cnpj: parsed.emitenteCnpj,
    valor_total: parsed.valorTotal,
    status: parsed.status,
    status_manifestacao: null,
    xml,
    resumo: parsed.resumo,
  };
}

async function salvarLoteDfeComControle(
  empresaId: number,
  docs: Array<ReturnType<typeof prepararDocumentoDfe>>,
  controle: {
    ultNSU: string;
    maxNSU: string;
    cStat: string;
    xMotivo: string;
    nextSyncAfter?: string | null;
    consumoIndevidoUntil?: string | null;
  },
) {
  const { data, error } = await supabaseAdmin.rpc("fiscal_salvar_dfe_lote", {
    p_empresa_id: empresaId,
    p_docs: docs.filter(Boolean),
    p_ult_nsu: controle.ultNSU,
    p_max_nsu: controle.maxNSU,
    p_cstat: controle.cStat,
    p_xmotivo: controle.xMotivo,
    p_next_sync_after: controle.nextSyncAfter ?? null,
    p_consumo_indevido_until: controle.consumoIndevidoUntil ?? null,
  });

  if (error) throw error;
  return Number(data ?? 0);
}

async function salvarConsultaPontualDfe(
  empresaId: number,
  docs: Array<ReturnType<typeof prepararDocumentoDfe>>,
  retorno: {
    cStat: string;
    xMotivo: string;
    consumoIndevidoUntil?: string | null;
  },
) {
  const { data, error } = await supabaseAdmin.rpc("fiscal_salvar_dfe_consulta_pontual", {
    p_empresa_id: empresaId,
    p_docs: docs.filter(Boolean),
    p_cstat: retorno.cStat,
    p_xmotivo: retorno.xMotivo,
    p_consumo_indevido_until: retorno.consumoIndevidoUntil ?? null,
  });

  if (error) throw error;
  return Number(data ?? 0);
}

export async function sincronizarDfeRecebidas(params: SyncDfeParams = {}) {
  const empresa = await getEmpresa(params.empresaId);
  const empresaId = Number(empresa.id);
  const currentCnpj = normalizeCnpj(empresa.cnpj);
  const currentAmbiente = normalizeAmbiente(empresa.ambiente);
  let controle = await getControle(empresaId);
  const controlCnpj = normalizeCnpj(controle.cnpj_consultado);
  const controlAmbiente = normalizeText(controle.ambiente_consultado).toUpperCase();

  if (!controlCnpj || !controlAmbiente) {
    const { error } = await supabaseAdmin
      .from("fiscal_dfe_controle")
      .update({
        cnpj_consultado: currentCnpj,
        ambiente_consultado: currentAmbiente,
        updatedat: new Date().toISOString(),
      })
      .eq("empresa_id", empresaId);
    if (error) throw error;
    controle = {
      ...controle,
      cnpj_consultado: currentCnpj,
      ambiente_consultado: currentAmbiente,
    };
  } else if (controlCnpj !== currentCnpj || controlAmbiente !== currentAmbiente) {
    if (!params.confirmCompanyChange) {
      return {
        success: false,
        companyChangeDetected: true,
        fiscalContextChangeDetected: true,
        previousCnpj: maskCnpj(controlCnpj),
        currentCnpj: maskCnpj(currentCnpj),
        previousAmbiente: controlAmbiente,
        currentAmbiente,
        documentsWillBeDeleted: true,
        message: "Novo contexto fiscal detectado. Confirme a troca antes de sincronizar.",
      };
    }

    const { error } = await supabaseAdmin.rpc("fiscal_ativar_contexto_dfe", {
      p_empresa_id: empresaId,
      p_cnpj: currentCnpj,
      p_ambiente: currentAmbiente,
    });
    if (error) throw error;
    controle = await getControle(empresaId);
  }

  if (controle.consumo_indevido_until && new Date(controle.consumo_indevido_until).getTime() > Date.now()) {
    return {
      success: false,
      blocked: true,
      cStat: controle.last_cstat,
      xMotivo: controle.last_xmotivo,
      novosDocumentos: 0,
      ultNSU: controle.ult_nsu,
      maxNSU: controle.max_nsu,
      consumoIndevidoUntil: controle.consumo_indevido_until,
      message: "Sincronização bloqueada temporariamente por consumo indevido.",
    };
  }

  const locked = await tryLock(empresaId);
  if (!locked) {
    return {
      success: false,
      locked: true,
      cStat: controle.last_cstat,
      xMotivo: "Já existe uma sincronização em andamento para esta empresa.",
      novosDocumentos: 0,
      ultNSU: controle.ult_nsu,
      maxNSU: controle.max_nsu,
    };
  }

  let ultNSU = String(controle.ult_nsu ?? "000000000000000").padStart(15, "0");
  let maxNSU = String(controle.max_nsu ?? "000000000000000").padStart(15, "0");
  let cStat = "";
  let xMotivo = "";
  let novosDocumentos = 0;
  let consumoIndevidoUntil: string | null = null;
  let nextSyncAfter: string | null = null;

  try {
    const { privateKeyPem, certificatePem } = await carregarCertificadoA1(empresa);
    const agent = new https.Agent({
      key: privateKeyPem,
      cert: certificatePem,
      rejectUnauthorized: false,
    });

    for (let i = 0; i < 10; i += 1) {
      const ret = await callDistribuicaoDfe(empresa, { tipo: "distNSU", ultNsu: ultNSU }, agent);
      cStat = String(ret.cStat ?? "");
      xMotivo = String(ret.xMotivo ?? "");

      // O ultNSU devolvido deve ser persistido inclusive no cStat 656: nesse
      // retorno a SEFAZ informa o cursor que espera na próxima solicitação.
      if (ret.ultNSU != null) {
        ultNSU = normalizeNsu(ret.ultNSU);
      }

      if (ret.maxNSU != null) {
        const nextMaxNsu = normalizeNsu(ret.maxNSU);
        if (!(cStat === "656" && nextMaxNsu === "000000000000000")) {
          maxNSU = nextMaxNsu;
        }
      }

      consumoIndevidoUntil =
        cStat === "656" ? new Date(Date.now() + DFE_SYNC_COOLDOWN_MS).toISOString() : null;
      // cStat 137 nao cria bloqueio local. A tentativa manual fica sob
      // decisao do usuario; somente um 656 efetivo ativa o cooldown.
      nextSyncAfter = null;
      const docs = cStat === "138" ? extractDocZipList(ret).map(prepararDocumentoDfe) : [];

      novosDocumentos += await salvarLoteDfeComControle(empresaId, docs, {
        ultNSU,
        maxNSU,
        cStat,
        xMotivo,
        nextSyncAfter,
        consumoIndevidoUntil,
      });

      // O ultNSU retornado pela SEFAZ precisa ser persistido antes de processar
      // docZip. Se uma gravação de XML falhar, a próxima consulta ainda parte
      // do NSU correto e evita rejeição 656 por repetição de NSU antigo.
      if (cStat !== "138" || ultNSU === maxNSU) break;
    }

    return {
      success: cStat === "138" || cStat === "137" || cStat === "",
      cStat: cStat || "137",
      xMotivo: xMotivo || "Nenhum documento localizado.",
      novosDocumentos,
      ultNSU,
      maxNSU,
      consumoIndevidoUntil,
      nextSyncAfter,
    };
  } finally {
    await releaseLock(empresaId);
  }
}

const MANIFESTACAO_CONFIG: Record<
  TipoManifestacaoDestinatario,
  { tpEvento: string; descEvento: string; status: string }
> = {
  CIENCIA: {
    tpEvento: "210210",
    descEvento: "Ciencia da Operacao",
    status: "CIENCIA",
  },
  CONFIRMACAO: {
    tpEvento: "210200",
    descEvento: "Confirmacao da Operacao",
    status: "CONFIRMACAO",
  },
  DESCONHECIMENTO: {
    tpEvento: "210220",
    descEvento: "Desconhecimento da Operacao",
    status: "DESCONHECIMENTO",
  },
  OPERACAO_NAO_REALIZADA: {
    tpEvento: "210240",
    descEvento: "Operacao nao Realizada",
    status: "OPERACAO_NAO_REALIZADA",
  },
};

function buildEnvEventoManifestacao(params: {
  empresa: EmpresaRow;
  chave: string;
  tipo: TipoManifestacaoDestinatario;
  justificativa?: string;
}) {
  const config = MANIFESTACAO_CONFIG[params.tipo];
  const chave = onlyDigits(params.chave);
  const cnpj = normalizeCnpj(params.empresa.cnpj);
  const tpAmb = params.empresa.ambiente === "PRODUCAO" ? "1" : "2";
  const nSeqEvento = 1;
  const nSeqEventoId = String(nSeqEvento).padStart(2, "0");
  const id = `ID${config.tpEvento}${chave}${nSeqEventoId}`;
  const xJust =
    params.tipo === "OPERACAO_NAO_REALIZADA"
      ? `<xJust>${escapeXml(params.justificativa?.trim())}</xJust>`
      : "";

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<envEvento versao="1.00" xmlns="http://www.portalfiscal.inf.br/nfe">` +
    `<idLote>${String(Date.now()).slice(-15).padStart(15, "0")}</idLote>` +
    `<evento versao="1.00">` +
    `<infEvento Id="${id}">` +
    `<cOrgao>91</cOrgao>` +
    `<tpAmb>${tpAmb}</tpAmb>` +
    `<CNPJ>${cnpj}</CNPJ>` +
    `<chNFe>${chave}</chNFe>` +
    `<dhEvento>${formatDateTimeNFe()}</dhEvento>` +
    `<tpEvento>${config.tpEvento}</tpEvento>` +
    `<nSeqEvento>${nSeqEvento}</nSeqEvento>` +
    `<verEvento>1.00</verEvento>` +
    `<detEvento versao="1.00">` +
    `<descEvento>${config.descEvento}</descEvento>` +
    xJust +
    `</detEvento>` +
    `</infEvento>` +
    `</evento>` +
    `</envEvento>`
  );
}

function buildRecepcaoEventoEnvelope(xmlEventoAssinado: string) {
  const xmlSemDeclaracao = xmlEventoAssinado.replace(/^\s*<\?xml[^>]*\?>\s*/i, "");

  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xmlns:xsd="http://www.w3.org/2001/XMLSchema" ` +
    `xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap12:Body>` +
    `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">` +
    xmlSemDeclaracao +
    `</nfeDadosMsg>` +
    `</soap12:Body>` +
    `</soap12:Envelope>`
  );
}

function findXmlNode(node: any, key: string): any {
  if (!node || typeof node !== "object") return null;
  if (node[key]) return node[key];

  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findXmlNode(item, key);
        if (found) return found;
      }
    } else {
      const found = findXmlNode(value, key);
      if (found) return found;
    }
  }

  return null;
}

function getRetEventoInfo(responseBody: string) {
  const parsed = parser.parse(responseBody);
  const retEvento = findXmlNode(parsed, "retEvento");
  const normalizedRetEvento = Array.isArray(retEvento) ? retEvento[0] : retEvento;
  const infEvento = normalizedRetEvento?.infEvento;
  return Array.isArray(infEvento) ? infEvento[0] : infEvento;
}

function extractChaveAcessoFromXml(xml: unknown) {
  const text = String(xml ?? "");
  const tagMatch = text.match(/<chNFe[^>]*>(\d{44})<\/chNFe>/i);
  if (tagMatch?.[1]) return tagMatch[1];

  const idMatch = text.match(/<infNFe\b[^>]*\bId=["']NFe(\d{44})["']/i);
  return idMatch?.[1] ?? null;
}

async function callRecepcaoEvento(empresa: EmpresaRow, xmlEventoAssinado: string, agent: https.Agent) {
  const url =
    empresa.ambiente === "PRODUCAO"
      ? "https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx"
      : "https://hom.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx";
  const response = await postSoapComCert(
    url,
    buildRecepcaoEventoEnvelope(xmlEventoAssinado),
    agent,
    "http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento",
  );

  if (response.httpStatus !== 200) {
    throw new Error(`Erro HTTP ${response.httpStatus} ao enviar manifestação do destinatário.`);
  }

  const infEvento = getRetEventoInfo(response.body);
  if (!infEvento) {
    throw new Error("Retorno retEvento não encontrado na resposta da SEFAZ.");
  }

  return infEvento;
}

export async function consultarDfePorChave(params: ConsultaChaveParams) {
  const chave = onlyDigits(params.chave);
  if (chave.length !== 44) {
    throw new Error("Informe uma chave de acesso com 44 dígitos.");
  }

  const empresa = await getEmpresa(params.empresaId);
  const empresaId = Number(empresa.id);
  const controle = await getControle(empresaId);

  if (
    controle.consumo_indevido_until &&
    new Date(controle.consumo_indevido_until).getTime() > Date.now()
  ) {
    return {
      success: false,
      blocked: true,
      cStat: controle.last_cstat,
      xMotivo: controle.last_xmotivo,
      novosDocumentos: 0,
      consumoIndevidoUntil: controle.consumo_indevido_until,
    };
  }

  const locked = await tryLock(empresaId);

  if (!locked) {
    return {
      success: false,
      locked: true,
      cStat: controle.last_cstat,
      xMotivo: "Já existe uma sincronização em andamento para esta empresa.",
      novosDocumentos: 0,
    };
  }

  try {
    const { privateKeyPem, certificatePem } = await carregarCertificadoA1(empresa);
    const agent = new https.Agent({
      key: privateKeyPem,
      cert: certificatePem,
      rejectUnauthorized: false,
    });
    const ret = await callDistribuicaoDfe(empresa, { tipo: "consChNFe", chave }, agent);
    const cStat = String(ret.cStat ?? "");
    const xMotivo = String(ret.xMotivo ?? "");
    const docs = cStat === "138" ? extractDocZipList(ret).map(prepararDocumentoDfe) : [];
    const consumoIndevidoUntil =
      cStat === "656" ? new Date(Date.now() + DFE_SYNC_COOLDOWN_MS).toISOString() : null;
    const novosDocumentos = await salvarConsultaPontualDfe(empresaId, docs, {
      cStat,
      xMotivo,
      consumoIndevidoUntil,
    });

    return {
      success: cStat === "138",
      cStat,
      xMotivo,
      novosDocumentos,
    };
  } finally {
    await releaseLock(empresaId);
  }
}

export async function manifestarDfeRecebida(params: ManifestarParams) {
  const config = MANIFESTACAO_CONFIG[params.tipo];
  if (!config) throw new Error("Tipo de manifestação inválido.");

  const justificativa = params.justificativa?.trim() ?? "";
  if (params.tipo === "OPERACAO_NAO_REALIZADA" && justificativa.length < 15) {
    throw new Error("Informe uma justificativa com pelo menos 15 caracteres.");
  }

  const { data: documento, error } = await supabaseAdmin
    .from("fiscal_dfe_documento")
    .select("*, empresa:empresa_id (*)")
    .eq("id", params.documentoId)
    .maybeSingle();

  if (error) throw error;
  if (!documento) throw new Error("Documento fiscal recebido não encontrado.");

  const chave = onlyDigits(documento.chave_acesso);
  const chaveFromXml = chave.length === 44 ? chave : extractChaveAcessoFromXml(documento.xml);
  if (!chaveFromXml || chaveFromXml.length !== 44) {
    throw new Error("Documento fiscal recebido não possui chave de acesso válida.");
  }

  const empresa = documento.empresa as EmpresaRow | null;
  if (!empresa) throw new Error("Empresa do documento fiscal não encontrada.");

  const { privateKeyPem, certificatePem } = await carregarCertificadoA1(empresa);
  const xmlEvento = buildEnvEventoManifestacao({
    empresa,
    chave: chaveFromXml,
    tipo: params.tipo,
    justificativa,
  });
  const xmlEventoAssinado = assinarEventoNFeXml(xmlEvento, privateKeyPem, certificatePem);
  const agent = new https.Agent({
    key: privateKeyPem,
    cert: certificatePem,
    rejectUnauthorized: false,
  });
  const infEvento = await callRecepcaoEvento(empresa, xmlEventoAssinado, agent);
  const cStat = String(infEvento.cStat ?? "");
  const xMotivo = String(infEvento.xMotivo ?? "");
  const isDuplicidadeEvento = cStat === "573" || xMotivo.toLowerCase().includes("duplicidade de evento");
  const aceito = ["135", "136"].includes(cStat) || isDuplicidadeEvento;
  let xmlCompletoConsulta: { cStat?: string; xMotivo?: string; novosDocumentos?: number } | null = null;

  if (aceito) {
    if (["CIENCIA", "CONFIRMACAO", "OPERACAO_NAO_REALIZADA"].includes(params.tipo)) {
      xmlCompletoConsulta = await consultarDfePorChave({
        empresaId: Number(empresa.id),
        chave: chaveFromXml,
      });
    }

    const resumo = documento.resumo && typeof documento.resumo === "object" ? documento.resumo : {};
    const procNfe = await buscarProcNfePorChave(Number(empresa.id), chaveFromXml);
    const manifestacaoPayload = {
      tipo: params.tipo,
      cStat,
      xMotivo,
      nProt: infEvento.nProt ?? null,
      duplicidade: isDuplicidadeEvento,
      manifestadoEm: new Date().toISOString(),
    };
    const xmlCompletoConsultaPayload = {
      cStat: xmlCompletoConsulta?.cStat ?? null,
      xMotivo: xmlCompletoConsulta?.xMotivo ?? null,
      novosDocumentos: xmlCompletoConsulta?.novosDocumentos ?? 0,
      disponivel: Boolean(procNfe?.xml && isXmlCompletoNfe(procNfe)),
      consultadoEm: new Date().toISOString(),
    };

    const { data: documentosMesmaChave, error: selectMesmaChaveError } = await supabaseAdmin
      .from("fiscal_dfe_documento")
      .select("id, resumo")
      .eq("empresa_id", Number(empresa.id))
      .eq("chave_acesso", chaveFromXml);

    if (selectMesmaChaveError) throw selectMesmaChaveError;

    for (const doc of documentosMesmaChave ?? [{ id: params.documentoId, resumo }]) {
      const docResumo = doc.resumo && typeof doc.resumo === "object" ? doc.resumo : {};
      const { error: updateError } = await supabaseAdmin
        .from("fiscal_dfe_documento")
        .update({
          chave_acesso: chaveFromXml,
          status_manifestacao: config.status,
          resumo: {
            ...docResumo,
            manifestacao: manifestacaoPayload,
            xmlCompletoConsulta: xmlCompletoConsultaPayload,
          },
          updatedat: new Date().toISOString(),
        })
        .eq("id", doc.id);

      if (updateError) throw updateError;
    }
  }

  return {
    success: aceito,
    cStat,
    xMotivo,
    statusManifestacao: aceito ? config.status : documento.status_manifestacao,
    xmlCompletoConsulta,
  };
}

function buildConsultaProtocoloEnvelope(params: { empresa: EmpresaRow; chave: string }) {
  const tpAmb = params.empresa.ambiente === "PRODUCAO" ? "1" : "2";

  const consSitNFeXml =
    `<consSitNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
    `<tpAmb>${tpAmb}</tpAmb>` +
    `<xServ>CONSULTAR</xServ>` +
    `<chNFe>${params.chave}</chNFe>` +
    `</consSitNFe>`;

  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xmlns:xsd="http://www.w3.org/2001/XMLSchema" ` +
    `xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap12:Body>` +
    `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4">` +
    consSitNFeXml +
    `</nfeDadosMsg>` +
    `</soap12:Body>` +
    `</soap12:Envelope>`
  );
}

function mapStatusConsultaProtocolo(cStat?: string | null) {
  if (cStat === "100") return "100";
  if (cStat === "101") return "101";
  if (["110", "301", "302"].includes(cStat ?? "")) return "110";
  return cStat ?? null;
}

export async function consultarStatusDfeRecebida(id: number) {
  const { data: documento, error } = await supabaseAdmin
    .from("fiscal_dfe_documento")
    .select("id, empresa_id, chave_acesso, xml, resumo, status")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!documento) throw new Error("Documento fiscal recebido não encontrado.");

  const chave = onlyDigits(documento.chave_acesso).length === 44
    ? onlyDigits(documento.chave_acesso)
    : extractChaveAcessoFromXml(documento.xml);
  if (!chave || chave.length !== 44) {
    throw new Error("Documento fiscal recebido não possui chave de acesso válida.");
  }

  const empresa = await getEmpresa(Number(documento.empresa_id));
  const { privateKeyPem, certificatePem } = await carregarCertificadoA1(empresa);
  const agent = new https.Agent({
    key: privateKeyPem,
    cert: certificatePem,
    rejectUnauthorized: false,
  });
  const url = getNfeConsultaProtocoloUrl({
    chaveAcesso: chave,
    ambiente: empresa.ambiente,
  });
  const response = await postSoapComCert(
    url,
    buildConsultaProtocoloEnvelope({ empresa, chave }),
    agent,
    "http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4/nfeConsultaNF",
  );

  if (response.httpStatus !== 200) {
    throw new Error(`Erro HTTP ${response.httpStatus} ao consultar status da NF-e.`);
  }

  const parsed = parser.parse(response.body);
  const retConsSitNFe = findXmlNode(parsed, "retConsSitNFe");
  const cStat = retConsSitNFe?.cStat != null ? String(retConsSitNFe.cStat) : null;
  const xMotivo = retConsSitNFe?.xMotivo != null ? String(retConsSitNFe.xMotivo) : null;
  const infProt = retConsSitNFe?.protNFe?.infProt;
  const protCStat = infProt?.cStat != null ? String(infProt.cStat) : null;
  const protXMotivo = infProt?.xMotivo != null ? String(infProt.xMotivo) : null;
  const nProt = infProt?.nProt != null ? String(infProt.nProt) : null;
  const dhRecbto = infProt?.dhRecbto != null ? String(infProt.dhRecbto) : null;
  const statusFinal = mapStatusConsultaProtocolo(protCStat ?? cStat);

  const { data: documentosMesmaChave, error: selectError } = await supabaseAdmin
    .from("fiscal_dfe_documento")
    .select("id, resumo")
    .eq("empresa_id", Number(documento.empresa_id))
    .eq("chave_acesso", chave);

  if (selectError) throw selectError;

  for (const doc of documentosMesmaChave ?? []) {
    const resumo = doc.resumo && typeof doc.resumo === "object" ? doc.resumo : {};
    const { error: updateError } = await supabaseAdmin
      .from("fiscal_dfe_documento")
      .update({
        status: statusFinal ?? documento.status,
        resumo: {
          ...resumo,
          nProt: nProt ?? resumo.nProt ?? null,
          xMotivo: protXMotivo ?? xMotivo ?? resumo.xMotivo ?? null,
          dhRecbto: dhRecbto ?? resumo.dhRecbto ?? null,
          consultaStatus: {
            cStat,
            xMotivo,
            protCStat,
            protXMotivo,
            nProt,
            dhRecbto,
            consultadoEm: new Date().toISOString(),
          },
        },
        updatedat: new Date().toISOString(),
      })
      .eq("id", doc.id);

    if (updateError) throw updateError;
  }

  return {
    ok: true,
    sefaz: {
      cStat,
      xMotivo,
      protocolo: {
        cStat: protCStat,
        xMotivo: protXMotivo,
        nProt,
        dhRecbto,
      },
    },
    status: statusFinal,
  };
}

function mapStatusDfeRecebida(status: string) {
  const value = status.trim().toUpperCase();
  const labels: Record<string, string> = {
    RESUMO_NFE: "Resumo da NF-e",
    PROC_NFE: "NF-e completa",
  };

  return labels[value] ?? traduzStatusNfe(value);
}

function mapXmlStatusDfeRecebida(row: any) {
  if (isXmlCompletoNfe(row) || row.resumo?.xmlCompletoConsulta?.disponivel === true) {
    return "XML_COMPLETO";
  }

  const manifestacao = String(row.status_manifestacao ?? "");
  if (manifestacao === "DESCONHECIMENTO") return "NAO_AUTORIZADO";
  if (["CIENCIA", "CONFIRMACAO", "OPERACAO_NAO_REALIZADA"].includes(manifestacao)) {
    return "AGUARDANDO_XML";
  }

  return "AGUARDANDO_MANIFESTACAO";
}

function mapXmlStatusLabel(status: string) {
  const labels: Record<string, string> = {
    XML_COMPLETO: "XML completo",
    AGUARDANDO_XML: "Aguardando XML",
    AGUARDANDO_MANIFESTACAO: "Aguardando manifestação",
    NAO_AUTORIZADO: "Não autorizado",
  };

  return labels[status] ?? status;
}

function extractIdentificacaoNfe(chave: string, resumo: any) {
  const chaveDigits = onlyDigits(chave);
  const modelo = String(resumo?.modelo ?? (chaveDigits.length === 44 ? chaveDigits.slice(20, 22) : "55"));
  const serie = Number(resumo?.serie ?? (chaveDigits.length === 44 ? chaveDigits.slice(22, 25) : 0));
  const numero = Number(resumo?.nNF ?? (chaveDigits.length === 44 ? chaveDigits.slice(25, 34) : 0));

  return {
    modelo: modelo === "65" ? "NFC-e" : "NF-e",
    serie: Number.isFinite(serie) ? serie : 0,
    numero: Number.isFinite(numero) ? numero : 0,
  };
}

function mapDocumento(row: any) {
  const chaveAcesso = onlyDigits(row.chave_acesso).length === 44
    ? String(row.chave_acesso)
    : extractChaveAcessoFromXml(row.xml) ?? String(row.chave_acesso ?? "");
  const statusRaw = String(row.status ?? row.tipo_documento ?? "");
  const xmlStatus = mapXmlStatusDfeRecebida(row);
  const identificacao = extractIdentificacaoNfe(chaveAcesso, row.resumo);

  return {
    id: Number(row.id),
    modelo: row.tipo_documento?.includes("EVENTO") ? "EVENTO" : identificacao.modelo,
    serie: identificacao.serie,
    numero: identificacao.numero,
    chave_acesso: chaveAcesso,
    ambiente: "",
    status: mapStatusDfeRecebida(statusRaw),
    dataemissao: String(row.data_emissao ?? row.createdat ?? ""),
    dataautorizacao: null,
    protocolo: row.resumo?.nProt ?? null,
    total_nfe: Number(row.valor_total ?? 0),
    ordemservicoid: null,
    vendaid: null,
    entradaid: null,
    clienteid: null,
    fornecedorid: null,
    empresaid: Number(row.empresa_id),
    tpNF: null,
    direcao: "EMITIDAS_TERCEIROS" as const,
    nsu: String(row.nsu ?? ""),
    tipoDocumento: String(row.tipo_documento ?? ""),
    statusManifestacao: row.status_manifestacao ? String(row.status_manifestacao) : null,
    xmlStatus,
    xmlStatusLabel: mapXmlStatusLabel(xmlStatus),
    origem: "TERCEIROS" as const,
    destinatarioOuEmitente: row.emitente_nome || row.emitente_cnpj
      ? {
          id: Number(row.id),
          nomerazaosocial: row.emitente_nome ?? null,
          cpfcnpj: row.emitente_cnpj ?? null,
        }
      : null,
    empresa: row.empresa
      ? {
          id: Number(row.empresa.id),
          razaosocial: row.empresa.razaosocial ?? null,
          nomefantasia: row.empresa.nomefantasia ?? null,
          cnpj: row.empresa.cnpj ?? null,
        }
      : null,
  };
}

function applyDfeRecebidasFilters(query: any, params: ListDfeParams) {
  const status = normalizeText(params.status).toUpperCase();
  const modelo = normalizeText(params.modelo).toUpperCase();

  query = query.in("tipo_documento", ["RESUMO_NFE", "PROC_NFE"]);
  if (params.dateFrom) query = query.gte("data_emissao", params.dateFrom);
  if (params.dateTo) query = query.lte("data_emissao", `${params.dateTo}T23:59:59.999`);

  if (status) {
    if (["AUTORIZADA", "AUTORIZADO", "EMITIDA"].includes(status)) {
      query = query.in("status", ["1", "100", "150"]);
    } else if (status === "CANCELADA") {
      query = query.in("status", ["3", "101", "151"]);
    } else if (status === "DENEGADA") {
      query = query.in("status", ["2", "110"]);
    } else {
      query = query.eq("status", status);
    }
  }

  if (modelo) {
    if (modelo === "NFE") {
      query = query.in("tipo_documento", ["RESUMO_NFE", "PROC_NFE"]);
    } else if (modelo === "NFCE") {
      query = query.eq("id", -1);
    } else {
      query = query.eq("tipo_documento", modelo);
    }
  }

  return query;
}

function buildDfeRecebidasKpis(rows: ReturnType<typeof mapDocumento>[]) {
  const autorizadas = rows.filter((row) =>
    ["Uso autorizado", "Uso autorizado fora do prazo"].includes(row.status),
  ).length;
  const canceladas = rows.filter((row) => row.status.toLowerCase().includes("cancel")).length;
  const rejeitadas = rows.filter((row) => {
    const status = row.status.toLowerCase();
    return status.includes("rejeição") || status.includes("denegad") || status.includes("não consta");
  }).length;
  const valorTotal = rows.reduce((sum, row) => sum + row.total_nfe, 0);

  return {
    total: rows.length,
    emitidasPorNos: 0,
    emitidasTerceiros: rows.length,
    autorizadas,
    canceladas,
    rejeitadas,
    valorTotal,
    valorEmitidasPorNos: 0,
    valorEmitidasTerceiros: valorTotal,
  };
}

export async function buscarKpisDfeRecebidasGeral() {
  const { data, error } = await supabaseAdmin
    .from("fiscal_dfe_documento")
    .select("*");

  if (error) throw error;

  const dedupedRows = preferirXmlCompletoPorChave(data ?? []);
  return buildDfeRecebidasKpis(dedupedRows.map(mapDocumento));
}

function preferirXmlCompletoPorChave(rows: any[]) {
  const byChave = new Map<string, any>();

  const mergeRows = (preferred: any, fallback: any) => ({
    ...preferred,
    status_manifestacao: preferred.status_manifestacao ?? fallback.status_manifestacao,
    resumo: {
      ...(fallback.resumo && typeof fallback.resumo === "object" ? fallback.resumo : {}),
      ...(preferred.resumo && typeof preferred.resumo === "object" ? preferred.resumo : {}),
    },
  });

  for (const row of rows) {
    const chave = onlyDigits(row.chave_acesso).length === 44
      ? onlyDigits(row.chave_acesso)
      : extractChaveAcessoFromXml(row.xml) ?? `id:${row.id}`;
    const current = byChave.get(chave);

    if (!current) {
      byChave.set(chave, row);
      continue;
    }

    if (isXmlCompletoNfe(row) && !isXmlCompletoNfe(current)) {
      byChave.set(chave, mergeRows(row, current));
    } else if (!isXmlCompletoNfe(row) && isXmlCompletoNfe(current)) {
      byChave.set(chave, mergeRows(current, row));
    }
  }

  return Array.from(byChave.values());
}

function getDataOrdenacaoEmissao(row: any) {
  const dataEmissao = new Date(row.data_emissao ?? "").getTime();
  if (Number.isFinite(dataEmissao)) return dataEmissao;

  const createdAt = new Date(row.createdat ?? "").getTime();
  return Number.isFinite(createdAt) ? createdAt : 0;
}

function ordenarPorDataEmissaoDesc(rows: any[]) {
  return [...rows].sort((a, b) => {
    const byDate = getDataOrdenacaoEmissao(b) - getDataOrdenacaoEmissao(a);
    if (byDate !== 0) return byDate;
    return Number(b.id ?? 0) - Number(a.id ?? 0);
  });
}

export async function listarDfeRecebidas(params: ListDfeParams = {}) {
  const page = clampInt(params.page, 1, 1, 10_000);
  const limit = clampInt(params.limit, 20, 1, 100);
  const from = (page - 1) * limit;
  const query = applyDfeRecebidasFilters(
    supabaseAdmin
      .from("fiscal_dfe_documento")
      .select("*, empresa:empresa_id ( id, razaosocial, nomefantasia, cnpj )")
      .order("data_emissao", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false }),
    params,
  );

  const { data, error } = await query;
  if (error) throw error;
  const mappedRows = ordenarPorDataEmissaoDesc(preferirXmlCompletoPorChave(data ?? []))
    .map(mapDocumento)
    .filter((nota) => matchesFiscalNoteSearch(nota, params.search));
  const rows = mappedRows.slice(from, from + limit);
  const kpiRows = mappedRows;

  return {
    data: rows,
    kpis: buildDfeRecebidasKpis(kpiRows),
    pagination: {
      total: mappedRows.length,
      page,
      limit,
      totalPages: Math.ceil(mappedRows.length / limit),
    },
  };
}

function isXmlCompletoNfe(row: { schema?: string | null; xml?: string | null }) {
  const schema = String(row.schema ?? "");
  const xml = String(row.xml ?? "");
  return schema.startsWith("procNFe") || xml.includes("<nfeProc") || xml.includes("<NFe");
}

function getLastXmlCompletoCheck(row: { resumo?: any }) {
  const value = row.resumo?.xmlCompletoConsulta?.consultadoEm;
  if (!value) return 0;

  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

async function buscarProcNfePorChave(empresaId: number, chave: string) {
  const { data, error } = await supabaseAdmin
    .from("fiscal_dfe_documento")
    .select("id, chave_acesso, nsu, schema, xml")
    .eq("empresa_id", empresaId)
    .eq("chave_acesso", chave)
    .like("schema", "procNFe%")
    .order("createdat", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function buscarXmlDfeRecebida(id: number) {
  const { data, error } = await supabaseAdmin
    .from("fiscal_dfe_documento")
    .select("id, empresa_id, chave_acesso, nsu, schema, xml, status_manifestacao, resumo")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const empresaId = Number(data.empresa_id);
  const chave = onlyDigits(data.chave_acesso).length === 44
    ? onlyDigits(data.chave_acesso)
    : extractChaveAcessoFromXml(data.xml);

  if (chave) {
    const procNfeSalvo = await buscarProcNfePorChave(empresaId, chave);
    if (procNfeSalvo?.xml && isXmlCompletoNfe(procNfeSalvo)) {
      return {
        id: Number(procNfeSalvo.id),
        chave,
        xml: String(procNfeSalvo.xml ?? ""),
        completo: true,
      };
    }
  }

  if (chave && !isXmlCompletoNfe(data) && String(data.schema ?? "").startsWith("resNFe")) {
    let consulta: { cStat?: string; xMotivo?: string } | null = null;
    const lastCheck = getLastXmlCompletoCheck(data);
    const nextCheckAfter = lastCheck
      ? new Date(lastCheck + XML_COMPLETO_RETRY_INTERVAL_MS).toISOString()
      : null;
    const canCheckAgain = Date.now() - lastCheck > XML_COMPLETO_RETRY_INTERVAL_MS;

    if (canCheckAgain) {
      consulta = await consultarDfePorChave({
        empresaId,
        chave,
      });

      const resumo = data.resumo && typeof data.resumo === "object" ? data.resumo : {};
      await supabaseAdmin
        .from("fiscal_dfe_documento")
        .update({
          resumo: {
            ...resumo,
            xmlCompletoConsulta: {
              cStat: consulta.cStat ?? null,
              xMotivo: consulta.xMotivo ?? null,
              consultadoEm: new Date().toISOString(),
            },
          },
          updatedat: new Date().toISOString(),
        })
        .eq("id", data.id);
    }

    const procNfeConsultado = await buscarProcNfePorChave(empresaId, chave);
    if (procNfeConsultado?.xml && isXmlCompletoNfe(procNfeConsultado)) {
      return {
        id: Number(procNfeConsultado.id),
        chave,
        xml: String(procNfeConsultado.xml ?? ""),
        completo: true,
      };
    }

    return {
      id: Number(data.id),
      chave,
      xml: String(data.xml ?? ""),
      completo: false,
      nextCheckAfter: consulta ? new Date(Date.now() + XML_COMPLETO_RETRY_INTERVAL_MS).toISOString() : nextCheckAfter,
      motivo:
        consulta?.xMotivo ||
        "A SEFAZ ainda não disponibilizou o XML completo da NF-e.",
    };
  }

  return {
    id: Number(data.id),
    chave: String(chave ?? data.chave_acesso ?? data.nsu ?? data.id),
    xml: String(data.xml ?? ""),
    completo: isXmlCompletoNfe(data),
  };
}
