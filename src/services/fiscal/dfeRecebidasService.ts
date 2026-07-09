import https from "https";
import { XMLParser } from "fast-xml-parser";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { carregarCertificadoA1 } from "@/lib/nfe/certificado";
import type { EmpresaRow } from "@/lib/nfe/types";

import {
  extractDocZipList,
  findRetDistDFeInt,
  parseDfeXml,
  unzipDocZip,
} from "./dfeXmlParser";

type SyncDfeParams = {
  empresaId?: number;
  force?: boolean;
};

type ListDfeParams = {
  page?: number;
  limit?: number;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: string;
  modelo?: string;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
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

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function onlyDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeNsu(value: unknown) {
  return String(value ?? "").replace(/\D/g, "").padStart(15, "0").slice(-15);
}

function getCufAutor(empresa: EmpresaRow) {
  const uf = String(empresa.uf ?? "").toUpperCase();
  return UF_CODES[uf] ?? "35";
}

async function getEmpresa(empresaId?: number) {
  let query = supabaseAdmin.from("empresa").select("*");
  if (empresaId) query = query.eq("id", empresaId);
  const { data, error } = await query.order("id", { ascending: true }).limit(1).maybeSingle<EmpresaRow>();

  if (error) throw error;
  if (!data) throw new Error("Empresa não encontrada para sincronização fiscal.");
  if (!onlyDigits(data.cnpj)) throw new Error("Empresa não possui CNPJ válido.");

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

function buildDistDFeEnvelope(empresa: EmpresaRow, ultNsu: string) {
  const ambiente = empresa.ambiente === "PRODUCAO" ? "1" : "2";
  const cnpj = onlyDigits(empresa.cnpj);
  const cUFAutor = getCufAutor(empresa);
  const nsu = ultNsu.padStart(15, "0");

  const distDFeInt =
    `<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">` +
    `<tpAmb>${ambiente}</tpAmb>` +
    `<cUFAutor>${cUFAutor}</cUFAutor>` +
    `<CNPJ>${cnpj}</CNPJ>` +
    `<distNSU><ultNSU>${nsu}</ultNSU></distNSU>` +
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
          "Content-Type":
            'application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse"',
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

async function callDistribuicaoDfe(empresa: EmpresaRow, ultNsu: string, agent: https.Agent) {
  const url =
    empresa.ambiente === "PRODUCAO"
      ? "https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx"
      : "https://hom.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx";

  const envelope = buildDistDFeEnvelope(empresa, ultNsu);
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

async function salvarDocumento(empresaId: number, doc: { nsu: string; schema: string; content: string }) {
  if (!doc.nsu || !doc.schema || !doc.content) return false;

  const { data: existing, error: existingError } = await supabaseAdmin
    .from("fiscal_dfe_documento")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("nsu", doc.nsu)
    .maybeSingle();

  if (existingError) throw existingError;

  const xml = unzipDocZip(doc.content);
  const parsed = parseDfeXml(xml, doc.schema);

  const { error } = await supabaseAdmin
    .from("fiscal_dfe_documento")
    .upsert(
      {
        empresa_id: empresaId,
        nsu: doc.nsu,
        schema: doc.schema,
        tipo_documento: parsed.tipoDocumento,
        chave_acesso: parsed.chaveAcesso,
        data_emissao: parsed.dataEmissao,
        emitente_nome: parsed.emitenteNome,
        emitente_cnpj: parsed.emitenteCnpj,
        valor_total: parsed.valorTotal,
        status: parsed.status,
        xml,
        resumo: parsed.resumo,
        updatedat: new Date().toISOString(),
      },
      {
        onConflict: "empresa_id,nsu",
        ignoreDuplicates: false,
      },
    );

  if (error) throw error;
  return !existing;
}

export async function sincronizarDfeRecebidas(params: SyncDfeParams = {}) {
  const empresa = await getEmpresa(params.empresaId);
  const empresaId = Number(empresa.id);
  const controle = await getControle(empresaId);

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

  if (!params.force && controle.ult_nsu === controle.max_nsu && controle.max_nsu !== "000000000000000") {
    return {
      success: true,
      skipped: true,
      cStat: controle.last_cstat ?? "137",
      xMotivo: "Nenhum NSU novo para consultar.",
      novosDocumentos: 0,
      ultNSU: controle.ult_nsu,
      maxNSU: controle.max_nsu,
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

  try {
    const { privateKeyPem, certificatePem } = await carregarCertificadoA1(empresa);
    const agent = new https.Agent({
      key: privateKeyPem,
      cert: certificatePem,
      rejectUnauthorized: false,
    });

    for (let i = 0; i < 10; i += 1) {
      const ret = await callDistribuicaoDfe(empresa, ultNSU, agent);
      cStat = String(ret.cStat ?? "");
      xMotivo = String(ret.xMotivo ?? "");

      if (ret.ultNSU != null) {
        ultNSU = normalizeNsu(ret.ultNSU);
      }

      if (ret.maxNSU != null) {
        const nextMaxNsu = normalizeNsu(ret.maxNSU);
        if (!(cStat === "656" && nextMaxNsu === "000000000000000")) {
          maxNSU = nextMaxNsu;
        }
      }

      if (cStat === "656") {
        const until = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        await supabaseAdmin
          .from("fiscal_dfe_controle")
          .update({
            ult_nsu: ultNSU,
            max_nsu: maxNSU,
            last_cstat: cStat,
            last_xmotivo: xMotivo,
            last_sync_at: new Date().toISOString(),
            consumo_indevido_until: until,
            updatedat: new Date().toISOString(),
          })
          .eq("empresa_id", empresaId);
        break;
      }

      if (cStat === "138") {
        const docs = extractDocZipList(ret);
        for (const doc of docs) {
          const saved = await salvarDocumento(empresaId, doc);
          if (saved) novosDocumentos += 1;
        }
      }

      await supabaseAdmin
        .from("fiscal_dfe_controle")
        .update({
          ult_nsu: ultNSU,
          max_nsu: maxNSU,
          last_cstat: cStat,
          last_xmotivo: xMotivo,
          last_sync_at: new Date().toISOString(),
          updatedat: new Date().toISOString(),
        })
        .eq("empresa_id", empresaId);

      if (cStat !== "138" || ultNSU === maxNSU) break;
    }

    return {
      success: cStat === "138" || cStat === "137" || cStat === "",
      cStat: cStat || "137",
      xMotivo: xMotivo || "Nenhum documento localizado.",
      novosDocumentos,
      ultNSU,
      maxNSU,
    };
  } finally {
    await releaseLock(empresaId);
  }
}

function mapDocumento(row: any) {
  return {
    id: Number(row.id),
    modelo: row.tipo_documento?.includes("EVENTO") ? "EVENTO" : "NFE",
    serie: 0,
    numero: 0,
    chave_acesso: String(row.chave_acesso ?? ""),
    ambiente: "",
    status: String(row.status ?? row.tipo_documento ?? ""),
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

export async function listarDfeRecebidas(params: ListDfeParams = {}) {
  const page = clampInt(params.page, 1, 1, 10_000);
  const limit = clampInt(params.limit, 20, 1, 100);
  const from = (page - 1) * limit;
  const to = from + limit - 1;
  const search = normalizeText(params.search);

  let query = supabaseAdmin
    .from("fiscal_dfe_documento")
    .select("*, empresa:empresa_id ( id, razaosocial, nomefantasia, cnpj )", { count: "exact" })
    .order("createdat", { ascending: false })
    .range(from, to);

  if (params.dateFrom) query = query.gte("data_emissao", params.dateFrom);
  if (params.dateTo) query = query.lte("data_emissao", `${params.dateTo}T23:59:59.999`);
  if (params.status) query = query.eq("status", params.status);
  if (params.modelo) query = query.eq("tipo_documento", params.modelo);
  if (search) {
    query = query.or(
      `chave_acesso.ilike.%${search}%,emitente_nome.ilike.%${search}%,emitente_cnpj.ilike.%${onlyDigits(search)}%,nsu.ilike.%${search}%`,
    );
  }

  const { data, error, count } = await query;
  if (error) throw error;

  const rows = (data ?? []).map(mapDocumento);

  return {
    data: rows,
    kpis: {
      total: rows.length,
      emitidasPorNos: 0,
      emitidasTerceiros: count ?? rows.length,
      autorizadas: rows.filter((row) => row.status === "1" || row.status === "100").length,
      canceladas: rows.filter((row) => row.status === "101").length,
      rejeitadas: 0,
      valorTotal: rows.reduce((sum, row) => sum + row.total_nfe, 0),
      valorEmitidasPorNos: 0,
      valorEmitidasTerceiros: rows.reduce((sum, row) => sum + row.total_nfe, 0),
    },
    pagination: {
      total: count ?? 0,
      page,
      limit,
      totalPages: Math.ceil((count ?? 0) / limit),
    },
  };
}

export async function buscarXmlDfeRecebida(id: number) {
  const { data, error } = await supabaseAdmin
    .from("fiscal_dfe_documento")
    .select("id, chave_acesso, nsu, xml")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    id: Number(data.id),
    chave: String(data.chave_acesso ?? data.nsu ?? data.id),
    xml: String(data.xml ?? ""),
  };
}
