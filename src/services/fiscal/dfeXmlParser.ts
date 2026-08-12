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

function getXmlTagValue(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`, "i"));
  return match?.[1]?.trim() ?? null;
}

function normalizeChaveAcesso(value: unknown, xml: string) {
  const digits = onlyDigits(value);
  if (digits.length === 44) return digits;

  const fromTag = onlyDigits(getXmlTagValue(xml, "chNFe"));
  if (fromTag.length === 44) return fromTag;

  const idMatch = xml.match(/<infNFe\b[^>]*\bId=["']NFe(\d{44})["']/i);
  return idMatch?.[1] ?? null;
}

function extractIdentificacaoFromChave(chave: string | null) {
  if (!chave || chave.length !== 44) {
    return {
      modelo: null,
      serie: null,
      nNF: null,
    };
  }

  return {
    modelo: chave.slice(20, 22),
    serie: Number(chave.slice(22, 25)),
    nNF: Number(chave.slice(25, 34)),
  };
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

function parseResumoNfe(parsed: any, schema: string, xml: string): ParsedDfe {
  const resNFe = findFirstObjectWithKey(parsed, "resNFe");
  const chaveAcesso = normalizeChaveAcesso(resNFe?.chNFe, xml);
  const identificacao = extractIdentificacaoFromChave(chaveAcesso);

  return {
    schema,
    tipoDocumento: schemaToTipo(schema),
    chaveAcesso,
    dataEmissao: resNFe?.dhEmi ? String(resNFe.dhEmi) : null,
    emitenteNome: resNFe?.xNome ? String(resNFe.xNome) : null,
    emitenteCnpj: resNFe?.CNPJ ? onlyDigits(resNFe.CNPJ) : null,
    valorTotal: toNumber(resNFe?.vNF),
    status: resNFe?.cSitNFe ? String(resNFe.cSitNFe) : null,
    resumo: {
      cSitNFe: resNFe?.cSitNFe ?? null,
      tpNF: resNFe?.tpNF ?? null,
      modelo: identificacao.modelo,
      serie: identificacao.serie,
      nNF: identificacao.nNF,
      dhRecbto: resNFe?.dhRecbto ?? null,
      digVal: resNFe?.digVal ?? null,
    },
  };
}

function parseProcNfe(parsed: any, schema: string, xml: string): ParsedDfe {
  const nfe = findFirstObjectWithKey(parsed, "NFe");
  const infNFe = nfe?.infNFe;
  const ide = infNFe?.ide;
  const emit = infNFe?.emit;
  const total = infNFe?.total?.ICMSTot;
  const prot = findFirstObjectWithKey(parsed, "protNFe")?.infProt;
  const id = String(infNFe?.["@_Id"] ?? "");
  const chaveAcesso = normalizeChaveAcesso(prot?.chNFe ?? id, xml);
  const identificacao = extractIdentificacaoFromChave(chaveAcesso);

  return {
    schema,
    tipoDocumento: schemaToTipo(schema),
    chaveAcesso,
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
      modelo: ide?.mod ?? identificacao.modelo,
      serie: ide?.serie ?? identificacao.serie,
      nNF: ide?.nNF ?? identificacao.nNF,
    },
  };
}

function parseEvento(parsed: any, schema: string, xml: string): ParsedDfe {
  const evento = findFirstObjectWithKey(parsed, "evento");
  const infEvento = evento?.infEvento;
  const retEvento = findFirstObjectWithKey(parsed, "retEvento")?.infEvento;

  return {
    schema,
    tipoDocumento: schemaToTipo(schema),
    chaveAcesso: normalizeChaveAcesso(infEvento?.chNFe ?? retEvento?.chNFe, xml),
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

/**
 * Perfil tributário de um item da NF-e recebida, no formato que
 * `resolverPadraoFiscalItem` consome como fonte.
 *
 * A devolução deve espelhar a operação de entrada — mesmo CFOP na direção
 * inversa, mesmo CST/CSOSN, mesma tributação de PIS/COFINS. Ler isso do XML
 * original é o que evita classificar a devolução pelo cadastro do produto, que
 * descreve a venda e não a compra que está voltando.
 */
export type ItemFiscalNfeOrigem = {
  nItem: number;
  descricao: string | null;
  ncm: string | null;
  cest: string | null;
  unidade: string | null;
  quantidade: number | null;
  valorUnitario: number | null;
  /** Campos no formato de `ValoresFiscaisParciais` (lib/nfe/padraoFiscalItem). */
  valoresFiscais: {
    origem_mercadoria: string | null;
    cfop: string | null;
    csosn: string | null;
    cst: string | null;
    aliquotaicms: number | null;
    cst_pis: string | null;
    aliquota_pis: number | null;
    cst_cofins: string | null;
    aliquota_cofins: number | null;
  };
  /** Retenções de ST da entrada, necessárias para devolver mercadoria de ST. */
  substituicaoTributaria: {
    vBCSTRet: number | null;
    vICMSSTRet: number | null;
    pST: number | null;
  };
};

function textoOuNulo(value: unknown) {
  const texto = String(value ?? "").trim();
  return texto || null;
}

function numeroOuNulo(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const numero = Number(value);
  return Number.isFinite(numero) ? numero : null;
}

/**
 * Código fiscal com o zero à esquerda de volta.
 *
 * O parser converte `<CST>07</CST>` em `7`, e "7" não é um CST válido — a nota
 * sairia com PIS/COFINS de código inexistente. Só faz sentido para os campos
 * que são código de tamanho fixo, nunca para valores.
 */
function codigoFiscal(value: unknown, tamanho: number) {
  const texto = String(value ?? "").trim();
  if (!texto) return null;
  return texto.length >= tamanho ? texto : texto.padStart(tamanho, "0");
}

/** Achata ICMS00/ICMS60/ICMSSN500/… num objeto só: o grupo varia com o CST. */
function achatarGrupo(grupo: unknown): Record<string, unknown> {
  if (!grupo || typeof grupo !== "object") return {};
  const valores = Object.values(grupo as Record<string, unknown>);
  const interno = valores.find((valor) => valor && typeof valor === "object");
  return (interno as Record<string, unknown>) ?? (grupo as Record<string, unknown>);
}

function localizarInfNFe(node: unknown): any | null {
  // `findFirstObjectWithKey` já devolve o conteúdo da chave, então serve tanto
  // para procNFe > NFe > infNFe quanto para uma NFe avulsa.
  return findFirstObjectWithKey(node, "infNFe");
}

/**
 * Lê os itens de uma NF-e recebida (procNFe ou NFe pura).
 *
 * Devolve lista vazia quando o XML não é uma NF-e completa — resumo (resNFe) e
 * evento não trazem itens, e nesse caso quem chama cai para o cadastro.
 */
export function extrairItensFiscaisNfe(xml: string): ItemFiscalNfeOrigem[] {
  let parsed: unknown;
  try {
    parsed = parser.parse(xml);
  } catch {
    return [];
  }

  const infNFe = localizarInfNFe(parsed);
  if (!infNFe) return [];

  return asArray<any>(infNFe.det).flatMap((det, index) => {
    if (!det || typeof det !== "object") return [];
    const prod = det.prod ?? {};
    const imposto = det.imposto ?? {};
    const icms = achatarGrupo(imposto.ICMS);
    const pis = achatarGrupo(imposto.PIS);
    const cofins = achatarGrupo(imposto.COFINS);
    const nItem = Number(det["@_nItem"] ?? index + 1);

    return [{
      nItem: Number.isInteger(nItem) && nItem > 0 ? nItem : index + 1,
      descricao: textoOuNulo(prod.xProd),
      ncm: onlyDigits(prod.NCM) || null,
      cest: onlyDigits(prod.CEST) || null,
      unidade: textoOuNulo(prod.uCom),
      quantidade: numeroOuNulo(prod.qCom),
      valorUnitario: numeroOuNulo(prod.vUnCom),
      valoresFiscais: {
        origem_mercadoria: codigoFiscal(icms.orig, 1),
        cfop: onlyDigits(prod.CFOP) || null,
        csosn: codigoFiscal(icms.CSOSN, 3),
        cst: codigoFiscal(icms.CST, 2),
        aliquotaicms: numeroOuNulo(icms.pICMS),
        cst_pis: codigoFiscal(pis.CST, 2),
        aliquota_pis: numeroOuNulo(pis.pPIS),
        cst_cofins: codigoFiscal(cofins.CST, 2),
        aliquota_cofins: numeroOuNulo(cofins.pCOFINS),
      },
      substituicaoTributaria: {
        vBCSTRet: numeroOuNulo(icms.vBCSTRet),
        vICMSSTRet: numeroOuNulo(icms.vICMSSTRet),
        pST: numeroOuNulo(icms.pST),
      },
    }];
  });
}

/** Item de número `nItem`, ou `null` quando o XML não tem essa linha. */
export function extrairItemFiscalNfe(xml: string, nItem: unknown): ItemFiscalNfeOrigem | null {
  const numero = Number(nItem);
  if (!Number.isInteger(numero) || numero <= 0) return null;
  return extrairItensFiscaisNfe(xml).find((item) => item.nItem === numero) ?? null;
}

export function unzipDocZip(base64Gzip: string) {
  const compressed = Buffer.from(base64Gzip, "base64");
  return gunzipSync(compressed).toString("utf8");
}

export function parseDfeXml(xml: string, schema: string): ParsedDfe {
  const parsed = parser.parse(xml);

  if (schema.startsWith("resNFe")) return parseResumoNfe(parsed, schema, xml);
  if (schema.startsWith("procNFe")) return parseProcNfe(parsed, schema, xml);
  if (schema.startsWith("procEventoNFe") || schema.startsWith("resEvento")) {
    return parseEvento(parsed, schema, xml);
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
