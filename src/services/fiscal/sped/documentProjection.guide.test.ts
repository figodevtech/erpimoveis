import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { projectFiscalDocument, type SpedItemAssignment } from "./documentProjection";
import { CUSTOMER_CPF, fixtureKey, nfeXml, OWN_CNPJ, SUPPLIER_CNPJ } from "./fixtures.test-helpers";

const resale: SpedItemAssignment = {
  code: "1001",
  productId: 1001,
  itemConfigId: 7,
  itemType: "00",
  master: { description: "FILTRO DE OLEO", unit: "UN", ncm: "84212300", cest: null, barcode: "7891234567895", internalIcmsRate: 20 },
};

function own(status: string, xml: string) {
  return projectFiscalDocument({
    sourceType: "NFE_EMITIDA",
    sourceTable: "nfe",
    sourceId: 1,
    operation: "SAIDA",
    status,
    xml,
    xmlSha256: "a".repeat(64),
    itemAssignments: new Map([[1, resale]]),
  });
}

function entry(xml: string, assignment: SpedItemAssignment, extra: Partial<Parameters<typeof projectFiscalDocument>[0]> = {}) {
  return projectFiscalDocument({
    sourceType: "NFE_RECEBIDA",
    sourceTable: "entrada",
    sourceId: 9,
    operation: "ENTRADA",
    status: "CONFIRMADA",
    xml,
    xmlSha256: "b".repeat(64),
    bookkeepingDate: "2026-08-12",
    receivedDocumentId: 55,
    itemAssignments: new Map([[1, assignment]]),
    ...extra,
  });
}

const supplierXml = (items = [{ cfop: "5102", vProd: 200, pICMS: 18 }]) => nfeXml({
  key: fixtureKey(2),
  emitter: { cnpj: SUPPLIER_CNPJ, uf: "PB" },
  recipient: { cnpj: OWN_CNPJ, uf: "PB" },
  items,
});

describe("C100 de NF-e própria", () => {
  it("autorizada: tributos do C100 são a soma dos C190", () => {
    const result = own("AUTORIZADA", nfeXml({ items: [{ cfop: "5102", vProd: 100 }, { cfop: "5102", vProd: 50 }] }));
    const c100 = result.blockCRecords.find((record) => record.code === "C100");
    const c190 = result.blockCRecords.filter((record) => record.code === "C190");
    assert.equal(c100?.values.IND_OPER, "1");
    assert.equal(c100?.values.IND_EMIT, "0");
    assert.equal(c100?.values.COD_SIT, "00");
    assert.equal(c100?.values.VL_ICMS, c190.reduce((sum, record) => sum + Number(record.values.VL_ICMS), 0));
    assert.equal(result.icmsTotals?.icms, 27);
    assert.equal(result.blockCRecords.some((record) => record.code === "C170"), false);
  });

  it("cancelada (02): só identificação, sem participante, sem data e sem 0150", () => {
    const result = own("CANCELADA", nfeXml());
    assert.deepEqual(result.blockCRecords.map((record) => record.code), ["C100"]);
    const values = result.blockCRecords[0].values;
    assert.equal(values.COD_SIT, "02");
    assert.equal(values.COD_PART, undefined);
    assert.equal(values.DT_DOC, undefined);
    assert.equal(values.VL_DOC, undefined);
    assert.equal(values.CHV_NFE, fixtureKey(1));
    assert.equal(result.catalogRecords.length, 0);
    assert.equal(result.participantCode, null);
    assert.equal(result.items.length, 0);
  });

  it("denegada (04): mesma regra de identificação mínima", () => {
    const result = own("DENEGADA", nfeXml());
    assert.equal(result.situationCode, "04");
    assert.deepEqual(Object.keys(result.blockCRecords[0].values).sort(), ["CHV_NFE", "COD_MOD", "COD_SIT", "IND_EMIT", "IND_OPER", "NUM_DOC", "SER"]);
    assert.equal(result.catalogRecords.length, 0);
  });

  it("NFC-e: sem participante, sem 0150 e sem campos de ST/IPI/PIS/COFINS", () => {
    const result = projectFiscalDocument({
      sourceType: "NFC_E",
      sourceTable: "nfe",
      sourceId: 3,
      operation: "SAIDA",
      status: "AUTORIZADA",
      xml: nfeXml({ key: fixtureKey(3), model: "65", recipient: { cpf: CUSTOMER_CPF, uf: "PB" }, items: [{ cfop: "5102" }] }),
      xmlSha256: "c".repeat(64),
      itemAssignments: new Map([[1, resale]]),
    });
    const c100 = result.blockCRecords.find((record) => record.code === "C100");
    assert.equal(c100?.values.COD_MOD, "65");
    assert.equal(c100?.values.COD_PART, undefined);
    for (const field of ["VL_BC_ICMS_ST", "VL_ICMS_ST", "VL_IPI", "VL_PIS", "VL_COFINS"]) assert.equal(c100?.values[field], undefined);
    assert.equal(result.catalogRecords.some((record) => record.code === "0150"), false);
    assert.equal(result.blockCRecords.some((record) => record.code === "C190"), true);
  });

  it("NF-e própria de entrada (devolução de venda, tpNF=0) vira IND_OPER 0 e crédito", () => {
    const result = own("AUTORIZADA", nfeXml({
      key: fixtureKey(4),
      tpNF: "0",
      finNFe: "4",
      recipient: { cnpj: SUPPLIER_CNPJ, uf: "PB" },
      items: [{ cfop: "1202", vProd: 100 }],
    }));
    const c100 = result.blockCRecords.find((record) => record.code === "C100");
    assert.equal(result.operation, "ENTRADA");
    assert.equal(c100?.values.IND_OPER, "0");
    assert.equal(c100?.values.IND_EMIT, "0");
    assert.equal(result.blockCRecords.find((record) => record.code === "C190")?.values.CFOP, "1202");
    assert.equal(result.payload.finNFe, "4");
    assert.equal(result.icmsTotals?.icms, 18);
  });

  it("DIFAL: C101 só na saída própria com partilha", () => {
    const result = own("AUTORIZADA", nfeXml({
      key: fixtureKey(5),
      recipient: { cpf: CUSTOMER_CPF, uf: "PE" },
      items: [{ cfop: "6108", vProd: 100, pICMS: 12, difal: { vICMSUFDest: 6, vFCPUFDest: 2 } }],
    }));
    const c101 = result.blockCRecords.find((record) => record.code === "C101");
    assert.equal(c101?.values.VL_ICMS_UF_DEST, 6);
    assert.equal(c101?.values.VL_FCP_UF_DEST, 2);
  });
});

describe("Entradas de terceiros", () => {
  it("converte o CFOP do fornecedor no CFOP de entrada conforme a destinação", () => {
    const xml = supplierXml([{ cfop: "5102", vProd: 200, pICMS: 18 }, { cfop: "6405", vProd: 50, pICMS: 0, cst: "60" } as never]);
    const both = entry(xml, { ...resale, creditTreatment: "CREDITAVEL" }, {
      itemAssignments: new Map([[1, { ...resale, creditTreatment: "CREDITAVEL" }], [2, { ...resale, code: "1002", creditTreatment: "SEM_CREDITO" }]]),
    });
    const c170 = both.blockCRecords.filter((record) => record.code === "C170");
    assert.deepEqual(c170.map((record) => record.values.CFOP), ["1102", "2403"]);
    const c190Cfops = both.blockCRecords.filter((record) => record.code === "C190").map((record) => record.values.CFOP);
    assert.ok(c190Cfops.every((cfop) => /^[123]/.test(String(cfop))));
    assert.equal(both.diagnostics.some((item) => item.code === "CFOP_ENTRADA_NAO_RESOLVIDO"), false);

    // Item sem produto: sem destinação, a conversão bloqueia em vez de adivinhar.
    const partial = entry(xml, { ...resale, creditTreatment: "CREDITAVEL" });
    assert.equal(partial.diagnostics.some((item) => item.code === "CFOP_ENTRADA_NAO_RESOLVIDO"), true);
  });

  it("sem crédito: base e ICMS zerados no C170/C190 e no C100", () => {
    const result = entry(supplierXml(), { ...resale, creditTreatment: "SEM_CREDITO" });
    const c170 = result.blockCRecords.find((record) => record.code === "C170");
    const c190 = result.blockCRecords.find((record) => record.code === "C190");
    const c100 = result.blockCRecords.find((record) => record.code === "C100");
    assert.equal(c170?.values.VL_ICMS, 0);
    assert.equal(c170?.values.VL_BC_ICMS, 0);
    assert.equal(c190?.values.VL_ICMS, 0);
    assert.equal(c100?.values.VL_ICMS, 0);
    assert.equal(result.icmsTotals?.icms, 0);
  });

  it("creditável: ICMS do XML vira crédito conciliado", () => {
    const result = entry(supplierXml(), { ...resale, creditTreatment: "CREDITAVEL" });
    assert.equal(result.icmsTotals?.icms, 36);
    assert.equal(result.blockCRecords.find((record) => record.code === "C100")?.values.VL_ICMS, 36);
    assert.equal(result.blockCRecords.find((record) => record.code === "C100")?.values.IND_EMIT, "1");
  });

  it("uso e consumo vai para x556 sem crédito", () => {
    const result = entry(supplierXml(), { ...resale, itemType: "07", creditTreatment: "USO_CONSUMO" });
    assert.equal(result.blockCRecords.find((record) => record.code === "C170")?.values.CFOP, "1556");
    assert.equal(result.icmsTotals?.icms, 0);
  });

  it("CSOSN do fornecedor usa o de-para confirmado; sem ele, bloqueia", () => {
    const xml = supplierXml([{ cfop: "5102", vProd: 80, csosn: "102" } as never]);
    const blocked = entry(xml, { ...resale, creditTreatment: "SEM_CREDITO" });
    assert.ok(blocked.diagnostics.some((item) => item.code === "CST_ICMS_EFD_NAO_RESOLVIDO"));
    const mapped = entry(xml, { ...resale, creditTreatment: "SEM_CREDITO" }, { csosnToCst: { "102": "90" } });
    assert.equal(mapped.blockCRecords.find((record) => record.code === "C170")?.values.CST_ICMS, "090");
    assert.equal(mapped.diagnostics.some((item) => item.code === "CST_ICMS_EFD_NAO_RESOLVIDO"), false);
  });

  it("nota do fornecedor cancelada não é escriturada", () => {
    assert.throws(() => entry(supplierXml(), resale, { status: "CANCELADA" }), /não é escriturado/);
  });

  it("documento do fornecedor com tpNF=0 é recusado", () => {
    const xml = nfeXml({ key: fixtureKey(6), tpNF: "0", emitter: { cnpj: SUPPLIER_CNPJ, uf: "PB" }, recipient: { cnpj: OWN_CNPJ, uf: "PB" } });
    assert.throws(() => entry(xml, resale), /tpNF = 0/);
  });
});

describe("0200 a partir do cadastro do produto", () => {
  it("usa descrição, unidade, NCM e alíquota interna do produto; ignora GTIN inválido do XML", () => {
    const result = own("AUTORIZADA", nfeXml());
    const item = result.catalogRecords.find((record) => record.code === "0200");
    assert.equal(item?.values.COD_ITEM, "1001");
    assert.equal(item?.values.DESCR_ITEM, "FILTRO DE OLEO");
    assert.equal(item?.values.COD_NCM, "84212300");
    assert.equal(item?.values.ALIQ_ICMS, 20);
    assert.equal(item?.values.COD_BARRA, "7891234567895");
  });

  it("dois fornecedores com descrições diferentes geram o mesmo 0200", () => {
    const first = entry(supplierXml(), { ...resale, creditTreatment: "CREDITAVEL" });
    const second = entry(supplierXml().replace("Produto 1 do XML", "OUTRA DESCRICAO"), { ...resale, creditTreatment: "CREDITAVEL" });
    const a = first.catalogRecords.find((record) => record.code === "0200");
    const b = second.catalogRecords.find((record) => record.code === "0200");
    assert.deepEqual(a?.values, b?.values);
  });

  it("sem cadastro mestre, GTIN 'SEM GTIN' não vira código de barras", () => {
    const result = own("AUTORIZADA", nfeXml());
    const noMaster = projectFiscalDocument({
      sourceType: "NFE_EMITIDA", sourceTable: "nfe", sourceId: 1, operation: "SAIDA", status: "AUTORIZADA",
      xml: nfeXml(), xmlSha256: "d".repeat(64), itemAssignments: new Map([[1, { ...resale, master: null }]]),
    });
    assert.ok(result);
    assert.equal(noMaster.catalogRecords.find((record) => record.code === "0200")?.values.COD_BARRA, null);
  });
});
