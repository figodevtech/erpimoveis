import { parseFiscalDate, type FiscalDateValue } from "@/lib/fiscal-date";
import {
  isValidCnpj,
  isValidCpf,
  normalizeCnpj,
  normalizeCpf,
  normalizeForeignFiscalId,
} from "@/lib/fiscal-identifiers";
import { parseDanfeNFeXml, type DanfeItem, type DanfeParty } from "@/lib/nfe/danfeParser";
import {
  alocacaoPorItem,
  lerItensDaNota,
  lerNFeDoXml,
  lerTotaisDaNota,
  type ItemFiscalDaNota,
} from "@/lib/nfe/totais-nfe";
import type { EfdRecord, SpedDiagnostic, SpedSourceRef } from "@/lib/sped/efd-icms-ipi";

import { entryPurposeFor, resolveEntryCfop } from "./entryCfop";

type Row = Record<string, any>;

/** Cadastro do produto no ERP. O 0200 sai daqui, não da descrição de cada XML. */
export type SpedProductMaster = {
  description?: string | null;
  unit?: string | null;
  ncm?: string | null;
  cest?: string | null;
  barcode?: string | null;
  internalIcmsRate?: number | null;
};

export type SpedItemAssignment = {
  code: string;
  productId?: number | null;
  itemConfigId?: number | null;
  inventoryUnit?: string | null;
  itemType?: string | null;
  creditTreatment?: string | null;
  master?: SpedProductMaster | null;
};

export type ProjectableFiscalDocument = {
  sourceType: "NFE_EMITIDA" | "NFE_RECEBIDA" | "NFC_E";
  sourceTable: "nfe" | "entrada";
  sourceId: string | number;
  /**
   * Direção informada pela fonte. Para documento de emissão própria, o `tpNF`
   * do XML prevalece: uma NF-e de entrada emitida pela empresa (devolução de
   * cliente, por exemplo) é IND_OPER = 0 mesmo vindo da tabela de notas.
   */
  operation: "ENTRADA" | "SAIDA";
  status: string;
  xml: string;
  xmlSha256: string;
  /** Emissão própria (IND_EMIT = 0). Padrão: documentos da tabela `nfe`. */
  ownIssued?: boolean;
  receivedDocumentId?: number | null;
  bookkeepingDate?: string | null;
  itemAssignments?: Map<number, SpedItemAssignment>;
  /** De-para CSOSN -> CST confirmado pelo contador para entradas de optantes do Simples. */
  csosnToCst?: Record<string, string> | null;
};

export type ProjectedFiscalItem = {
  number: number;
  code: string;
  productId: number | null;
  itemConfigId: number | null;
  documentUnit: string;
  inventoryUnit: string | null;
  creditTreatment: string;
  payload: Row;
  sourceRefs: SpedSourceRef[];
};

export type ProjectedFiscalDocument = {
  sourceType: ProjectableFiscalDocument["sourceType"];
  sourceTable: ProjectableFiscalDocument["sourceTable"];
  sourceId: string;
  operation: ProjectableFiscalDocument["operation"];
  ownIssued?: boolean;
  /** Soma dos C190 do documento; é o que a apuração (E110) concilia. */
  icmsTotals?: { baseIcms: number; icms: number };
  key: string;
  model: string;
  situationCode: string;
  emissionDate: FiscalDateValue;
  bookkeepingDate: string | null;
  participantCode: string | null;
  participantDocumentType: "CNPJ" | "CPF" | "ID_EXTERIOR" | "SEM_DOCUMENTO";
  participantDocumentCanonical: string | null;
  participantDocumentOriginal: string | null;
  xmlSha256: string;
  payload: Row;
  items: ProjectedFiscalItem[];
  catalogRecords: EfdRecord[];
  blockCRecords: EfdRecord[];
  diagnostics: SpedDiagnostic[];
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function cents(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function source(input: ProjectableFiscalDocument, key?: string): SpedSourceRef {
  return {
    source: "XML",
    table: input.sourceTable,
    id: input.sourceId,
    ...(key ? { documentKey: key } : {}),
  };
}

function participantDocument(party: DanfeParty) {
  const type = party.documentoTipo ?? "SEM_DOCUMENTO";
  const raw = text(party.documento);
  if (!raw) return { type: "SEM_DOCUMENTO" as const, canonical: null, raw: null };
  if (type === "CNPJ") {
    const canonical = normalizeCnpj(raw);
    if (!isValidCnpj(canonical)) throw new Error(`CNPJ inválido no participante: ${raw}.`);
    return { type, canonical, raw };
  }
  if (type === "CPF") {
    const canonical = normalizeCpf(raw);
    if (!isValidCpf(canonical)) throw new Error(`CPF inválido no participante: ${raw}.`);
    return { type, canonical, raw };
  }
  const canonical = normalizeForeignFiscalId(raw);
  if (!canonical || canonical.includes("|")) throw new Error("Identificador estrangeiro inválido no participante.");
  return { type: "ID_EXTERIOR" as const, canonical, raw };
}

function participantCode(type: string, canonical: string | null): string | null {
  if (!canonical) return null;
  const safe = canonical.replace(/[^A-Z0-9_-]/gi, "_").toUpperCase();
  return `${type === "ID_EXTERIOR" ? "EXT" : "P"}${safe}`.slice(0, 60);
}


/** Situações em que o C100 leva somente a identificação do documento (Guia Prático, exceções do C100). */
const IDENTIFICATION_ONLY_SITUATIONS = new Set(["02", "04"]);

function situationCode(status: string): "00" | "02" | "04" {
  const normalized = text(status).toUpperCase();
  if (normalized.includes("CANCEL")) return "02";
  if (normalized.includes("DENEG")) return "04";
  return "00";
}

function xmlTag(xml: string, tag: string): string {
  return text(new RegExp(`<(?:\\w+:)?${tag}>\\s*([^<]*?)\\s*</(?:\\w+:)?${tag}>`, "i").exec(xml)?.[1]);
}

function unitCode(value: unknown): string {
  return text(value).toUpperCase();
}

function validGtin(value: unknown): string | null {
  const digits = text(value);
  return /^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(digits) ? digits : null;
}

function digitsOrNull(value: unknown, length?: number): string | null {
  const digits = text(value).replace(/\D/g, "");
  if (!digits) return null;
  if (length && digits.length !== length) return null;
  return digits;
}

type CstResolution = { cst: string | null; fromCsosn: boolean };

function cstIcms(item: DanfeItem, csosnToCst?: Record<string, string> | null): CstResolution {
  const origin = text(item.origem);
  const cst = text(item.cst_icms);
  if (origin.length === 1 && /^\d{2}$/.test(cst)) return { cst: `${origin}${cst}`, fromCsosn: false };
  const csosn = text(item.csosn);
  const mapped = csosn ? text(csosnToCst?.[csosn]) : "";
  if (origin.length === 1 && /^\d{2}$/.test(mapped)) return { cst: `${origin}${mapped}`, fromCsosn: true };
  return { cst: null, fromCsosn: Boolean(csosn) };
}

function itemOperationValue(item: DanfeItem, fiscalItem?: ItemFiscalDaNota): number {
  return cents(
    item.valor_total
      - item.valor_desconto
      + (item.valor_frete ?? 0)
      + (item.valor_seguro ?? 0)
      + (item.valor_outras_despesas ?? 0)
      + (fiscalItem?.valorIpi ?? item.valor_ipi)
      + (fiscalItem?.valorIcmsST ?? item.valor_icms_st ?? 0)
      + (fiscalItem?.valorFcpST ?? 0),
  );
}

function deepNumericValue(node: unknown, field: string): number | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = deepNumericValue(child, field);
      if (found != null) return found;
    }
    return null;
  }
  for (const [key, value] of Object.entries(node as Row)) {
    if (key === field) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    const found = deepNumericValue(value, field);
    if (found != null) return found;
  }
  return null;
}

function reducedBaseValue(item: DanfeItem, fiscalItem: ItemFiscalDaNota | undefined, cst: string | null): number | null {
  if (!cst || !["20", "70"].includes(cst.slice(1))) return 0;
  const reductionPercent = deepNumericValue(fiscalItem?.icms, "pRedBC");
  if (reductionPercent == null || reductionPercent <= 0 || reductionPercent >= 100 || item.valor_bc_icms <= 0) return null;
  return cents((item.valor_bc_icms * reductionPercent) / (100 - reductionPercent));
}

/**
 * Valores fiscais do item como entram na escrituração. Na emissão própria são
 * os do XML. Na entrada de terceiros, o CFOP é o do destinatário e a base/ICMS
 * só aparecem quando há direito a crédito: o C190 de entrada é o que o E110
 * soma como crédito, e informar ICMS sem crédito seria creditar por omissão.
 */
type EffectiveItem = {
  item: DanfeItem;
  fiscalItem?: ItemFiscalDaNota;
  cst: string | null;
  cstFromCsosn: boolean;
  cfop: string;
  cfopResolved: boolean;
  credited: boolean;
  baseIcms: number;
  rate: number;
  icms: number;
  fcp: number;
  reducedBase: number | null;
};

function effectiveItem(
  item: DanfeItem,
  fiscalItem: ItemFiscalDaNota | undefined,
  input: ProjectableFiscalDocument,
  ownIssued: boolean,
  assignment: SpedItemAssignment | undefined,
): EffectiveItem {
  const resolution = cstIcms(item, ownIssued ? null : input.csosnToCst);
  if (ownIssued) {
    return {
      item,
      fiscalItem,
      cst: resolution.cst,
      cstFromCsosn: resolution.fromCsosn,
      cfop: text(item.cfop),
      cfopResolved: true,
      credited: true,
      baseIcms: cents(item.valor_bc_icms),
      rate: cents(item.aliquotaicms),
      icms: cents(item.valor_icms),
      fcp: cents(fiscalItem?.informativos.fcp ?? 0),
      reducedBase: reducedBaseValue(item, fiscalItem, resolution.cst),
    };
  }
  const purpose = entryPurposeFor({ creditTreatment: assignment?.creditTreatment, itemType: assignment?.itemType });
  const cfop = resolveEntryCfop(item.cfop, purpose);
  const credited = assignment?.creditTreatment === "CREDITAVEL";
  return {
    item,
    fiscalItem,
    cst: resolution.cst,
    cstFromCsosn: resolution.fromCsosn,
    cfop: cfop.cfop ?? text(item.cfop),
    cfopResolved: cfop.cfop != null,
    credited,
    baseIcms: credited ? cents(item.valor_bc_icms) : 0,
    rate: credited ? cents(item.aliquotaicms) : 0,
    icms: credited ? cents(item.valor_icms) : 0,
    fcp: credited ? cents(fiscalItem?.informativos.fcp ?? 0) : 0,
    reducedBase: credited ? reducedBaseValue(item, fiscalItem, resolution.cst) : 0,
  };
}

function buildC190(
  items: EffectiveItem[],
  sourceRef: SpedSourceRef,
): { records: EfdRecord[]; totals: Row } {
  const groups = new Map<string, Row>();
  for (const effective of items) {
    const { item, fiscalItem } = effective;
    const safeCst = effective.cst ?? "000";
    const key = `${safeCst}|${effective.cfop}|${effective.rate.toFixed(2)}`;
    const group = groups.get(key) ?? {
      CST_ICMS: safeCst,
      CFOP: effective.cfop,
      ALIQ_ICMS: effective.rate,
      VL_OPR: 0,
      VL_BC_ICMS: 0,
      VL_ICMS: 0,
      VL_BC_ICMS_ST: 0,
      VL_ICMS_ST: 0,
      VL_RED_BC: 0,
      VL_IPI: 0,
    };
    group.VL_OPR = cents(group.VL_OPR + itemOperationValue(item, fiscalItem));
    group.VL_BC_ICMS = cents(group.VL_BC_ICMS + effective.baseIcms);
    group.VL_ICMS = cents(group.VL_ICMS + effective.icms + effective.fcp);
    group.VL_BC_ICMS_ST = cents(group.VL_BC_ICMS_ST + (item.valor_bc_icms_st ?? 0));
    group.VL_ICMS_ST = cents(group.VL_ICMS_ST + (fiscalItem?.valorIcmsST ?? item.valor_icms_st ?? 0) + (fiscalItem?.valorFcpST ?? 0));
    group.VL_RED_BC = cents(group.VL_RED_BC + (effective.reducedBase ?? 0));
    group.VL_IPI = cents(group.VL_IPI + (fiscalItem?.valorIpi ?? item.valor_ipi));
    group.VL_FCP_OP = cents((group.VL_FCP_OP ?? 0) + effective.fcp);
    group.VL_FCP_ST = cents((group.VL_FCP_ST ?? 0) + (fiscalItem?.valorFcpST ?? 0));
    group.VL_FCP_RET = cents((group.VL_FCP_RET ?? 0) + (fiscalItem?.informativos.fcpSTRet ?? 0));
    groups.set(key, group);
  }
  const totals = { VL_BC_ICMS: 0, VL_ICMS: 0, VL_BC_ICMS_ST: 0, VL_ICMS_ST: 0, VL_IPI: 0 };
  const records = Array.from(groups.entries()).sort(([left], [right]) => left.localeCompare(right, "en"))
    .flatMap(([, groupedValues]) => {
      const { VL_FCP_OP, VL_FCP_ST, VL_FCP_RET, ...values } = groupedValues;
      for (const field of Object.keys(totals) as Array<keyof typeof totals>) {
        totals[field] = cents(totals[field] + Number(values[field] ?? 0));
      }
      const groupRecords: EfdRecord[] = [{ code: "C190", values, source: sourceRef }];
      if (VL_FCP_OP || VL_FCP_ST || VL_FCP_RET) groupRecords.push({
        code: "C191",
        values: { VL_FCP_OP, VL_FCP_ST, VL_FCP_RET },
        source: sourceRef,
      });
      return groupRecords;
    });
  return { records, totals };
}

function buildC170(effective: EffectiveItem, assignment: SpedItemAssignment, sourceRef: SpedSourceRef): EfdRecord {
  const { item } = effective;
  return {
    code: "C170",
    values: {
      NUM_ITEM: item.n_item,
      COD_ITEM: assignment.code,
      DESCR_COMPL: item.descricao,
      QTD: item.quantidade,
      UNID: unitCode(item.unidade),
      VL_ITEM: item.valor_total,
      VL_DESC: item.valor_desconto,
      IND_MOV: "0",
      CST_ICMS: effective.cst ?? "000",
      CFOP: effective.cfop,
      VL_BC_ICMS: effective.baseIcms,
      ALIQ_ICMS: effective.rate,
      VL_ICMS: cents(effective.icms + effective.fcp),
      VL_BC_ICMS_ST: item.valor_bc_icms_st ?? 0,
      ALIQ_ST: item.aliquota_icms_st ?? 0,
      VL_ICMS_ST: item.valor_icms_st ?? 0,
      IND_APUR: "0",
      CST_IPI: item.cst_ipi,
      COD_ENQ: item.codigo_enquadramento_ipi,
      VL_BC_IPI: item.valor_bc_ipi,
      ALIQ_IPI: item.aliquota_ipi,
      VL_IPI: item.valor_ipi,
      CST_PIS: item.cst_pis,
      VL_BC_PIS: item.valor_bc_pis ?? 0,
      ALIQ_PIS: item.aliquota_pis,
      VL_PIS: item.valor_pis,
      CST_COFINS: item.cst_cofins,
      VL_BC_COFINS: item.valor_bc_cofins ?? 0,
      ALIQ_COFINS: item.aliquota_cofins,
      VL_COFINS: item.valor_cofins,
    },
    source: sourceRef,
  };
}

function build0200(item: DanfeItem, effective: SpedItemAssignment, sourceRef: SpedSourceRef): EfdRecord {
  const master = effective.master ?? null;
  const rate = master?.internalIcmsRate;
  return {
    code: "0200",
    values: {
      COD_ITEM: effective.code,
      DESCR_ITEM: text(master?.description) || item.descricao,
      COD_BARRA: validGtin(master?.barcode) ?? validGtin(item.ean),
      UNID_INV: unitCode(effective.inventoryUnit || master?.unit || item.unidade),
      TIPO_ITEM: effective.itemType || "99",
      COD_NCM: digitsOrNull(master?.ncm, 8) ?? digitsOrNull(item.ncm, 8),
      // Alíquota interna do cadastro. A do XML varia por operação (interestadual,
      // redução) e faria o mesmo item divergir entre documentos.
      ALIQ_ICMS: master && typeof rate === "number" && Number.isFinite(rate) ? cents(rate) : undefined,
      CEST: digitsOrNull(master?.cest, 7) ?? digitsOrNull(item.cest, 7),
    },
    source: sourceRef,
  };
}

export function projectFiscalDocument(input: ProjectableFiscalDocument): ProjectedFiscalDocument {
  const parsed = parseDanfeNFeXml(input.xml);
  const fiscalXml = lerNFeDoXml(input.xml);
  if (!fiscalXml.infNFe) throw new Error("NF-e sem grupo infNFe completo para projeção fiscal.");
  const fiscalItems = new Map(
    lerItensDaNota(fiscalXml.infNFe)
      .filter((item) => item.numeroItem != null)
      .map((item) => [Number(item.numeroItem), item] as const),
  );
  const fiscalTotals = lerTotaisDaNota(fiscalXml.infNFe);
  const key = text(parsed.chave);
  if (!/^\d{44}$/.test(key)) throw new Error("NF-e sem chave de acesso válida no XML completo.");
  const emissionDate = parseFiscalDate(parsed.ide.dhEmi);
  if (!emissionDate) throw new Error(`NF-e ${key} sem data civil de emissão confiável.`);

  const ownIssued = input.ownIssued ?? input.sourceTable === "nfe";
  const tpNF = text(parsed.ide.tpNF);
  if (!ownIssued && tpNF === "0") {
    throw new Error(`NF-e ${key} foi emitida pelo fornecedor como entrada (tpNF = 0); não corresponde a uma compra do estabelecimento.`);
  }
  const operation: ProjectedFiscalDocument["operation"] = ownIssued && (tpNF === "0" || tpNF === "1")
    ? (tpNF === "0" ? "ENTRADA" : "SAIDA")
    : input.operation;
  const situation = situationCode(input.status);
  if (!ownIssued && situation !== "00") {
    throw new Error(`NF-e ${key} de terceiro com situação ${input.status}: documento cancelado ou denegado do fornecedor não é escriturado.`);
  }
  const identificationOnly = IDENTIFICATION_ONLY_SITUATIONS.has(situation);
  const model = text(parsed.ide.modelo) || key.slice(20, 22);
  const consumerDocument = model === "65";

  // Emissão própria: o participante é o destinatário, mesmo numa NF-e de entrada.
  const party = ownIssued ? parsed.destinatario : parsed.emitente;
  const document = participantDocument(party);
  const sourceRef = source(input, key);
  const diagnostics: SpedDiagnostic[] = [];
  // NFC-e e documentos cancelados/denegados não referenciam participante.
  const code = consumerDocument || identificationOnly ? null : participantCode(document.type, document.canonical);
  const bookkeepingDate = !ownIssued
    ? text(input.bookkeepingDate) || null
    : parseFiscalDate(parsed.ide.dhSaiEnt)?.civilDate ?? emissionDate.civilDate;

  if (!ownIssued && !bookkeepingDate) diagnostics.push({
    code: "DATA_ENTRADA_FISCAL_NAO_CONFIRMADA",
    severity: "BLOQUEIO",
    message: `A entrada ${input.sourceId} não possui data de escrituração confirmada.`,
    source: sourceRef,
  });

  const c100Identification = {
    IND_OPER: operation === "ENTRADA" ? "0" : "1",
    IND_EMIT: ownIssued ? "0" : "1",
    COD_MOD: model,
    COD_SIT: situation,
    SER: parsed.ide.serie,
    NUM_DOC: parsed.ide.numero,
    CHV_NFE: key,
  };

  const catalogRecords: EfdRecord[] = [];
  const projectedItems: ProjectedFiscalItem[] = [];
  const blockCRecords: EfdRecord[] = [];
  let icmsTotals = { baseIcms: 0, icms: 0 };

  if (identificationOnly) {
    // Guia Prático, C100: cancelada (02) e denegada (04) informam apenas
    // REG, IND_OPER, IND_EMIT, COD_MOD, COD_SIT, SER, NUM_DOC e CHV_NFE.
    blockCRecords.push({ code: "C100", values: c100Identification, source: sourceRef });
  } else {
    if (code) catalogRecords.push({
      code: "0150",
      values: {
        COD_PART: code,
        NOME: party.nome || "PARTICIPANTE SEM NOME",
        COD_PAIS: party.endereco.codigoPais || "01058",
        CNPJ: document.type === "CNPJ" ? document.canonical : null,
        CPF: document.type === "CPF" ? document.canonical : null,
        IE: party.ie,
        COD_MUN: party.endereco.codigoMunicipio,
        END: party.endereco.logradouro,
        NUM: party.endereco.numero,
        COMPL: party.endereco.complemento,
        BAIRRO: party.endereco.bairro,
      },
      source: sourceRef,
    });

    const effectiveItems: EffectiveItem[] = [];
    const itemRecords: EfdRecord[] = [];
    for (const item of parsed.itens) {
      const assignment = input.itemAssignments?.get(item.n_item);
      const fallbackCode = `PEND-${key.slice(-8)}-${item.n_item}`;
      const effective = assignment ?? { code: fallbackCode };
      if (!assignment?.itemConfigId) diagnostics.push({
        code: "CODIGO_ITEM_CANONICO_AUSENTE",
        severity: "BLOQUEIO",
        message: `O item ${item.n_item} da NF-e ${key} não possui configuração canônica vigente para o 0200.`,
        record: "0200",
        source: sourceRef,
        context: { itemNumber: item.n_item, xmlProductCode: item.produtoid, productId: assignment?.productId ?? null },
      });
      if (!ownIssued && !effective.creditTreatment) diagnostics.push({
        code: "TRATAMENTO_CREDITO_PENDENTE",
        severity: "BLOQUEIO",
        message: `O item ${item.n_item} da entrada ${input.sourceId} não possui decisão explícita de crédito.`,
        record: "C170",
        source: sourceRef,
        context: { itemNumber: item.n_item },
      });
      const values = effectiveItem(item, fiscalItems.get(item.n_item), input, ownIssued, assignment);
      effectiveItems.push(values);
      if (!values.cfopResolved) diagnostics.push({
        code: "CFOP_ENTRADA_NAO_RESOLVIDO",
        severity: "BLOQUEIO",
        message: `Não foi possível converter o CFOP ${item.cfop} do fornecedor no CFOP de entrada do item ${item.n_item} da NF-e ${key}. Classifique a destinação do item (revenda, uso e consumo ou ativo).`,
        record: "C170",
        field: "CFOP",
        source: sourceRef,
        context: { itemNumber: item.n_item, supplierCfop: item.cfop },
      });
      if (values.cstFromCsosn && !values.cst) diagnostics.push({
        code: "CST_ICMS_EFD_NAO_RESOLVIDO",
        severity: "BLOQUEIO",
        message: `O item ${item.n_item} da NF-e ${key} informa CSOSN ${text(item.csosn)} e não há de-para CSOSN→CST confirmado para entradas.`,
        record: "C170",
        field: "CST_ICMS",
        source: sourceRef,
        context: { itemNumber: item.n_item, csosn: text(item.csosn) },
      });
      projectedItems.push({
        number: item.n_item,
        code: effective.code,
        productId: effective.productId ?? null,
        itemConfigId: effective.itemConfigId ?? null,
        documentUnit: unitCode(item.unidade),
        inventoryUnit: unitCode(effective.inventoryUnit || effective.master?.unit) || null,
        creditTreatment: effective.creditTreatment ?? (ownIssued ? "NAO_APLICAVEL" : "PENDENTE"),
        payload: { ...item, assignment: effective, cfopEscrituracao: values.cfop },
        sourceRefs: [sourceRef],
      });
      catalogRecords.push({ code: "0190", values: { UNID: unitCode(item.unidade), DESCR: unitCode(item.unidade) }, source: sourceRef });
      const record0200 = build0200(item, effective, sourceRef);
      const inventoryUnit = text(record0200.values.UNID_INV);
      if (inventoryUnit && inventoryUnit !== unitCode(item.unidade)) {
        catalogRecords.push({ code: "0190", values: { UNID: inventoryUnit, DESCR: inventoryUnit }, source: sourceRef });
      }
      catalogRecords.push(record0200);
      // C170 só para documentos de terceiros: na emissão própria o XML já está na SEFAZ.
      if (!ownIssued) itemRecords.push(buildC170(values, effective, sourceRef));
    }

    for (const itemNumber of effectiveItems.filter((item) => !item.cst && !item.cstFromCsosn).map((item) => item.item.n_item)) diagnostics.push({
      code: "CST_ICMS_EFD_NAO_RESOLVIDO",
      severity: "BLOQUEIO",
      message: `Não foi possível formar origem+CST do item ${itemNumber} da NF-e ${key}. CSOSN não é convertido automaticamente em CST.`,
      record: "C170",
      field: "CST_ICMS",
      source: sourceRef,
    });
    for (const itemNumber of effectiveItems.filter((item) => item.reducedBase == null).map((item) => item.item.n_item)) diagnostics.push({
      code: "C190_REDUCAO_BASE_NAO_RESOLVIDA",
      severity: "BLOQUEIO",
      message: `O item ${itemNumber} da NF-e ${key} usa CST com redução de base, mas o valor não pôde ser derivado com segurança do XML.`,
      record: "C190",
      field: "VL_RED_BC",
      source: sourceRef,
    });
    const c190AllocationFields = new Set(["vProd", "vDesc", "vFrete", "vSeg", "vOutro", "vST", "vFCPST", "vIPI"]);
    for (const allocation of alocacaoPorItem(fiscalTotals)) {
      if (!c190AllocationFields.has(allocation.campo) || ["AUSENTE", "TOTALMENTE_ALOCADO"].includes(allocation.status)) continue;
      diagnostics.push({
        code: "C190_COMPONENTE_SEM_ALOCACAO",
        severity: "BLOQUEIO",
        message: `${allocation.rotulo} possui R$ ${Math.abs(allocation.naoAlocado).toFixed(2)} sem alocação segura por item para formar o C190.`,
        record: "C190",
        field: "VL_OPR",
        source: sourceRef,
        context: { field: allocation.campo, status: allocation.status },
      });
    }

    const grouped = buildC190(effectiveItems, sourceRef);
    icmsTotals = { baseIcms: grouped.totals.VL_BC_ICMS, icms: grouped.totals.VL_ICMS };
    // Os tributos do C100 são a soma dos C190: é a conciliação que o PVA confere.
    const c100Values: Row = {
      ...c100Identification,
      COD_PART: code,
      DT_DOC: emissionDate,
      DT_E_S: bookkeepingDate,
      VL_DOC: parsed.totais.vNF,
      IND_PGTO: parsed.ide.indicadorPagamento,
      VL_DESC: parsed.totais.vDesc,
      VL_MERC: parsed.totais.vProd,
      IND_FRT: parsed.transporte.modFrete,
      VL_FRT: parsed.totais.vFrete,
      VL_SEG: parsed.totais.vSeg,
      VL_OUT_DA: parsed.totais.vOutro,
      VL_BC_ICMS: grouped.totals.VL_BC_ICMS,
      VL_ICMS: grouped.totals.VL_ICMS,
      VL_BC_ICMS_ST: grouped.totals.VL_BC_ICMS_ST,
      VL_ICMS_ST: grouped.totals.VL_ICMS_ST,
      VL_IPI: grouped.totals.VL_IPI,
      VL_PIS: parsed.totais.vPIS,
      VL_COFINS: parsed.totais.vCOFINS,
    };
    if (consumerDocument) {
      // NFC-e: sem participante e sem os campos de ST, IPI, PIS e COFINS no C100.
      for (const field of ["COD_PART", "VL_BC_ICMS_ST", "VL_ICMS_ST", "VL_IPI", "VL_PIS", "VL_COFINS"]) c100Values[field] = undefined;
    }
    blockCRecords.push({ code: "C100", values: c100Values, source: sourceRef });

    if (operation === "SAIDA" && ownIssued) {
      const difal = parsed.itens.reduce((totals, item) => ({
        fcp: cents(totals.fcp + (item.valor_fcp_uf_dest ?? 0)),
        destination: cents(totals.destination + (item.valor_icms_uf_dest ?? 0)),
        origin: cents(totals.origin + (item.valor_icms_uf_remet ?? 0)),
      }), { fcp: 0, destination: 0, origin: 0 });
      if (difal.fcp || difal.destination || difal.origin) blockCRecords.push({
        code: "C101",
        values: { VL_FCP_UF_DEST: difal.fcp, VL_ICMS_UF_DEST: difal.destination, VL_ICMS_UF_REM: difal.origin },
        source: sourceRef,
      });
    }
    blockCRecords.push(...itemRecords, ...grouped.records);
  }

  return {
    sourceType: input.sourceType,
    sourceTable: input.sourceTable,
    sourceId: String(input.sourceId),
    operation,
    ownIssued,
    icmsTotals,
    key,
    model,
    situationCode: situation,
    emissionDate,
    bookkeepingDate,
    participantCode: code,
    participantDocumentType: document.type,
    participantDocumentCanonical: document.canonical,
    participantDocumentOriginal: document.raw,
    xmlSha256: input.xmlSha256,
    payload: {
      serie: parsed.ide.serie,
      numero: parsed.ide.numero,
      participanteNome: party.nome,
      participanteUf: party.endereco.uf,
      fiscalDfeDocumentoId: input.receivedDocumentId ?? null,
      cfops: Array.from(new Set(parsed.itens.map((item) => item.cfop))).sort(),
      valorTotal: parsed.totais.vNF,
      totais: parsed.totais,
      tpNF,
      finNFe: xmlTag(input.xml, "finNFe") || null,
    },
    items: projectedItems,
    catalogRecords,
    blockCRecords,
    diagnostics,
  };
}
