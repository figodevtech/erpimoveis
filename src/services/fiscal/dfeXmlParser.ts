import { gunzipSync } from "zlib";
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
});

type ParsedDfe = {
  schema: string;
  tipoDocumento: string;
  chaveAcesso: string | null;
  dataEmissao: string | null;
  emitenteNome: string | null;
  emitenteCnpj: string | null;
  valorTotal: number | null;
  status: string | null;
  resumo: Record<string, unknown>;
};

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function onlyDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function toNumber(value: unknown) {
  const numeric = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(numeric) ? numeric : null;
}

function findFirstObjectWithKey(node: unknown, key: string): any | null {
  if (!node || typeof node !== "object") return null;
  const record = node as Record<string, unknown>;
  if (record[key] && typeof record[key] === "object") return record[key];

  for (const value of Object.values(record)) {
    const found = findFirstObjectWithKey(value, key);
    if (found) return found;
  }

  return null;
}

function schemaToTipo(schema: string) {
  if (schema.startsWith("resNFe")) return "RESUMO_NFE";
  if (schema.startsWith("procNFe")) return "PROC_NFE";
  if (schema.startsWith("procEventoNFe")) return "EVENTO_NFE";
  if (schema.startsWith("resEvento")) return "RESUMO_EVENTO";
  return "OUTRO";
}

function parseResumoNfe(parsed: any, schema: string): ParsedDfe {
  const resNFe = findFirstObjectWithKey(parsed, "resNFe");
  return {
    schema,
    tipoDocumento: schemaToTipo(schema),
    chaveAcesso: resNFe?.chNFe ? String(resNFe.chNFe) : null,
    dataEmissao: resNFe?.dhEmi ? String(resNFe.dhEmi) : null,
    emitenteNome: resNFe?.xNome ? String(resNFe.xNome) : null,
    emitenteCnpj: resNFe?.CNPJ ? onlyDigits(resNFe.CNPJ) : null,
    valorTotal: toNumber(resNFe?.vNF),
    status: resNFe?.cSitNFe ? String(resNFe.cSitNFe) : null,
    resumo: {
      cSitNFe: resNFe?.cSitNFe ?? null,
      tpNF: resNFe?.tpNF ?? null,
      dhRecbto: resNFe?.dhRecbto ?? null,
      digVal: resNFe?.digVal ?? null,
    },
  };
}

function parseProcNfe(parsed: any, schema: string): ParsedDfe {
  const nfe = findFirstObjectWithKey(parsed, "NFe");
  const infNFe = nfe?.infNFe;
  const ide = infNFe?.ide;
  const emit = infNFe?.emit;
  const total = infNFe?.total?.ICMSTot;
  const prot = findFirstObjectWithKey(parsed, "protNFe")?.infProt;
  const id = String(infNFe?.["@_Id"] ?? "");

  return {
    schema,
    tipoDocumento: schemaToTipo(schema),
    chaveAcesso: prot?.chNFe ? String(prot.chNFe) : onlyDigits(id) || null,
    dataEmissao: ide?.dhEmi ? String(ide.dhEmi) : null,
    emitenteNome: emit?.xNome ? String(emit.xNome) : null,
    emitenteCnpj: emit?.CNPJ ? onlyDigits(emit.CNPJ) : null,
    valorTotal: toNumber(total?.vNF),
    status: prot?.cStat ? String(prot.cStat) : null,
    resumo: {
      nProt: prot?.nProt ?? null,
      xMotivo: prot?.xMotivo ?? null,
      dhRecbto: prot?.dhRecbto ?? null,
      tpNF: ide?.tpNF ?? null,
    },
  };
}

function parseEvento(parsed: any, schema: string): ParsedDfe {
  const evento = findFirstObjectWithKey(parsed, "evento");
  const infEvento = evento?.infEvento;
  const retEvento = findFirstObjectWithKey(parsed, "retEvento")?.infEvento;

  return {
    schema,
    tipoDocumento: schemaToTipo(schema),
    chaveAcesso: infEvento?.chNFe ? String(infEvento.chNFe) : retEvento?.chNFe ? String(retEvento.chNFe) : null,
    dataEmissao: infEvento?.dhEvento ? String(infEvento.dhEvento) : retEvento?.dhRegEvento ? String(retEvento.dhRegEvento) : null,
    emitenteNome: null,
    emitenteCnpj: infEvento?.CNPJ ? onlyDigits(infEvento.CNPJ) : null,
    valorTotal: null,
    status: retEvento?.cStat ? String(retEvento.cStat) : null,
    resumo: {
      tpEvento: infEvento?.tpEvento ?? retEvento?.tpEvento ?? null,
      xEvento: infEvento?.detEvento?.descEvento ?? null,
      xMotivo: retEvento?.xMotivo ?? null,
      nProt: retEvento?.nProt ?? null,
    },
  };
}

export function unzipDocZip(base64Gzip: string) {
  const compressed = Buffer.from(base64Gzip, "base64");
  return gunzipSync(compressed).toString("utf8");
}

export function parseDfeXml(xml: string, schema: string): ParsedDfe {
  const parsed = parser.parse(xml);

  if (schema.startsWith("resNFe")) return parseResumoNfe(parsed, schema);
  if (schema.startsWith("procNFe")) return parseProcNfe(parsed, schema);
  if (schema.startsWith("procEventoNFe") || schema.startsWith("resEvento")) {
    return parseEvento(parsed, schema);
  }

  return {
    schema,
    tipoDocumento: schemaToTipo(schema),
    chaveAcesso: null,
    dataEmissao: null,
    emitenteNome: null,
    emitenteCnpj: null,
    valorTotal: null,
    status: null,
    resumo: {},
  };
}

export function extractDocZipList(retDistDFeInt: any) {
  const lote = retDistDFeInt?.loteDistDFeInt;
  return asArray(lote?.docZip).map((doc: any) => ({
    nsu: String(doc?.["@_NSU"] ?? doc?.NSU ?? ""),
    schema: String(doc?.["@_schema"] ?? doc?.schema ?? ""),
    content: String(doc?.["#text"] ?? doc ?? ""),
  }));
}

export function findRetDistDFeInt(node: unknown): any | null {
  return findFirstObjectWithKey(node, "retDistDFeInt");
}
