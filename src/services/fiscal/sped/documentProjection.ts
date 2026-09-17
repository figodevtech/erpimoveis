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

type Row = Record<string, any>;

export type SpedItemAssignment = {
  code: string;
  productId?: number | null;
  itemConfigId?: number | null;
  inventoryUnit?: string | null;
  itemType?: string | null;
  creditTreatment?: string | null;
};

export type ProjectableFiscalDocument = {
  sourceType: "NFE_EMITIDA" | "NFE_RECEBIDA" | "NFC_E";
  sourceTable: "nfe" | "entrada";
  sourceId: string | number;
  operation: "ENTRADA" | "SAIDA";
  status: string;
  xml: string;
  xmlSha256: string;
  receivedDocumentId?: number | null;
  bookkeepingDate?: string | null;
  itemAssignments?: Map<number, SpedItemAssignment>;
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

function cstIcms(item: DanfeItem): string | null {
  const origin = text(item.origem);
  const cst = text(item.cst_icms);
  if (origin.length === 1 && /^\d{2}$/.test(cst)) return `${origin}${cst}`;
  return null;
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

function buildC190(
  items: DanfeItem[],
  fiscalItems: Map<number, ItemFiscalDaNota>,
  sourceRef: SpedSourceRef,
): { records: EfdRecord[]; missingCst: number[]; missingReducedBase: number[] } {
  const groups = new Map<string, Row>();
  const missingCst: number[] = [];
  const missingReducedBase: number[] = [];
  for (const item of items) {
    const cst = cstIcms(item);
    const fiscalItem = fiscalItems.get(item.n_item);
    const reducedBase = reducedBaseValue(item, fiscalItem, cst);
    if (!cst) missingCst.push(item.n_item);
    if (reducedBase == null) missingReducedBase.push(item.n_item);
    const safeCst = cst ?? "000";
    const rate = cents(item.aliquotaicms);
    const key = `${safeCst}|${item.cfop}|${rate.toFixed(2)}`;
    const group = groups.get(key) ?? {
      CST_ICMS: safeCst,
      CFOP: item.cfop,
      ALIQ_ICMS: rate,
      VL_OPR: 0,
      VL_BC_ICMS: 0,
      VL_ICMS: 0,
      VL_BC_ICMS_ST: 0,
      VL_ICMS_ST: 0,
      VL_RED_BC: 0,
      VL_IPI: 0,
    };
    group.VL_OPR = cents(group.VL_OPR + itemOperationValue(item, fiscalItem));
    group.VL_BC_ICMS = cents(group.VL_BC_ICMS + item.valor_bc_icms);
    group.VL_ICMS = cents(group.VL_ICMS + item.valor_icms + (fiscalItem?.informativos.fcp ?? 0));
    group.VL_BC_ICMS_ST = cents(group.VL_BC_ICMS_ST + (item.valor_bc_icms_st ?? 0));
    group.VL_ICMS_ST = cents(group.VL_ICMS_ST + (fiscalItem?.valorIcmsST ?? item.valor_icms_st ?? 0) + (fiscalItem?.valorFcpST ?? 0));
    group.VL_RED_BC = cents(group.VL_RED_BC + (reducedBase ?? 0));
    group.VL_IPI = cents(group.VL_IPI + (fiscalItem?.valorIpi ?? item.valor_ipi));
    group.VL_FCP_OP = cents((group.VL_FCP_OP ?? 0) + (fiscalItem?.informativos.fcp ?? 0));
    group.VL_FCP_ST = cents((group.VL_FCP_ST ?? 0) + (fiscalItem?.valorFcpST ?? 0));
    group.VL_FCP_RET = cents((group.VL_FCP_RET ?? 0) + (fiscalItem?.informativos.fcpSTRet ?? 0));
    groups.set(key, group);
  }
  return {
    records: Array.from(groups.entries()).sort(([left], [right]) => left.localeCompare(right, "en"))
      .flatMap(([, groupedValues]) => {
        const { VL_FCP_OP, VL_FCP_ST, VL_FCP_RET, ...values } = groupedValues;
        const records: EfdRecord[] = [{ code: "C190", values, source: sourceRef }];
        if (VL_FCP_OP || VL_FCP_ST || VL_FCP_RET) records.push({
          code: "C191",
          values: { VL_FCP_OP, VL_FCP_ST, VL_FCP_RET },
          source: sourceRef,
        });
        return records;
      }),
    missingCst,
    missingReducedBase,
  };
}

function buildC170(item: DanfeItem, assignment: SpedItemAssignment, sourceRef: SpedSourceRef): EfdRecord {
  return {
    code: "C170",
    values: {
      NUM_ITEM: item.n_item,
      COD_ITEM: assignment.code,
      DESCR_COMPL: item.descricao,
      QTD: item.quantidade,
      UNID: item.unidade,
      VL_ITEM: item.valor_total,
      VL_DESC: item.valor_desconto,
      IND_MOV: "0",
      CST_ICMS: cstIcms(item) ?? "000",
      CFOP: item.cfop,
      VL_BC_ICMS: item.valor_bc_icms,
      ALIQ_ICMS: item.aliquotaicms,
      VL_ICMS: item.valor_icms,
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
  const canceled = text(input.status).toUpperCase().includes("CANCEL");
  const party = input.operation === "ENTRADA" ? parsed.emitente : parsed.destinatario;
  const document = participantDocument(party);
  const code = participantCode(document.type, document.canonical);
  const sourceRef = source(input, key);
  const diagnostics: SpedDiagnostic[] = [];
  const model = text(parsed.ide.modelo) || key.slice(20, 22);
  const bookkeepingDate = input.operation === "ENTRADA"
    ? text(input.bookkeepingDate) || null
    : parseFiscalDate(parsed.ide.dhSaiEnt)?.civilDate ?? emissionDate.civilDate;

  if (input.operation === "ENTRADA" && !bookkeepingDate) diagnostics.push({
    code: "DATA_ENTRADA_FISCAL_NAO_CONFIRMADA",
    severity: "BLOQUEIO",
    message: `A entrada ${input.sourceId} não possui data de escrituração confirmada.`,
    source: sourceRef,
  });

  const c100Identification = {
    IND_OPER: input.operation === "ENTRADA" ? "0" : "1",
    IND_EMIT: input.operation === "ENTRADA" ? "1" : "0",
    COD_PART: code,
    COD_MOD: model,
    COD_SIT: canceled ? "02" : "00",
    SER: parsed.ide.serie,
    NUM_DOC: parsed.ide.numero,
    CHV_NFE: key,
    DT_DOC: emissionDate,
  };
  const c100: EfdRecord = {
    code: "C100",
    values: canceled ? c100Identification : {
      ...c100Identification,
      DT_E_S: bookkeepingDate,
      VL_DOC: parsed.totais.vNF,
      IND_PGTO: parsed.ide.indicadorPagamento,
      VL_DESC: parsed.totais.vDesc,
      VL_MERC: parsed.totais.vProd,
      IND_FRT: parsed.transporte.modFrete,
      VL_FRT: parsed.totais.vFrete,
      VL_SEG: parsed.totais.vSeg,
      VL_OUT_DA: parsed.totais.vOutro,
      VL_BC_ICMS: parsed.totais.vBC,
      VL_ICMS: parsed.totais.vICMS,
      VL_BC_ICMS_ST: parsed.totais.vBCST,
      VL_ICMS_ST: parsed.totais.vST,
      VL_IPI: parsed.totais.vIPI,
      VL_PIS: parsed.totais.vPIS,
      VL_COFINS: parsed.totais.vCOFINS,
    },
    source: sourceRef,
  };

  const catalogRecords: EfdRecord[] = [];
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

  const projectedItems: ProjectedFiscalItem[] = [];
  const blockCRecords: EfdRecord[] = [c100];
  if (!canceled) {
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
        context: { itemNumber: item.n_item, xmlProductCode: item.produtoid },
      });
      if (input.operation === "ENTRADA" && !effective.creditTreatment) diagnostics.push({
        code: "TRATAMENTO_CREDITO_PENDENTE",
        severity: "BLOQUEIO",
        message: `O item ${item.n_item} da entrada ${input.sourceId} não possui decisão explícita de crédito.`,
        record: "C170",
        source: sourceRef,
      });
      projectedItems.push({
        number: item.n_item,
        code: effective.code,
        productId: effective.productId ?? null,
        itemConfigId: effective.itemConfigId ?? null,
        documentUnit: item.unidade,
        inventoryUnit: effective.inventoryUnit ?? null,
        creditTreatment: effective.creditTreatment ?? (input.operation === "SAIDA" ? "NAO_APLICAVEL" : "PENDENTE"),
        payload: { ...item, assignment: effective },
        sourceRefs: [sourceRef],
      });
      catalogRecords.push({
        code: "0190",
        values: { UNID: item.unidade, DESCR: item.unidade },
        source: sourceRef,
      });
      catalogRecords.push({
        code: "0200",
        values: {
          COD_ITEM: effective.code,
          DESCR_ITEM: item.descricao,
          COD_BARRA: item.ean,
          UNID_INV: effective.inventoryUnit || item.unidade,
          TIPO_ITEM: effective.itemType || "99",
          COD_NCM: item.ncm,
          ALIQ_ICMS: item.aliquotaicms,
          CEST: item.cest,
        },
        source: sourceRef,
      });
      if (input.operation === "ENTRADA") blockCRecords.push(buildC170(item, effective, sourceRef));
    }
    const grouped = buildC190(parsed.itens, fiscalItems, sourceRef);
    blockCRecords.push(...grouped.records);
    for (const itemNumber of grouped.missingCst) diagnostics.push({
      code: "CST_ICMS_EFD_NAO_RESOLVIDO",
      severity: "BLOQUEIO",
      message: `Não foi possível formar origem+CST do item ${itemNumber} da NF-e ${key}. CSOSN não é convertido automaticamente em CST.`,
      record: "C170",
      field: "CST_ICMS",
      source: sourceRef,
    });
    for (const itemNumber of grouped.missingReducedBase) diagnostics.push({
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
  }

  return {
    sourceType: input.sourceType,
    sourceTable: input.sourceTable,
    sourceId: String(input.sourceId),
    operation: input.operation,
    key,
    model,
    situationCode: canceled ? "02" : "00",
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
    },
    items: projectedItems,
    catalogRecords,
    blockCRecords,
    diagnostics,
  };
}
