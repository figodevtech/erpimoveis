import assert from "node:assert/strict";
import test from "node:test";

import { projectSpedAssessment } from "./assessmentProjection";
import type { ProjectedFiscalDocument } from "./documentProjection";

function document(
  operation: "ENTRADA" | "SAIDA",
  icms: number,
  creditTreatment: string = operation === "ENTRADA" ? "CREDITAVEL" : "NAO_APLICAVEL",
): ProjectedFiscalDocument {
  return {
    sourceType: operation === "ENTRADA" ? "NFE_RECEBIDA" : "NFE_EMITIDA",
    sourceTable: operation === "ENTRADA" ? "entrada" : "nfe",
    sourceId: operation,
    operation,
    key: operation === "ENTRADA" ? "1".repeat(44) : "2".repeat(44),
    model: "55",
    situationCode: "00",
    emissionDate: { civilDate: "2026-08-10" },
    bookkeepingDate: "2026-08-10",
    participantCode: "P1",
    participantDocumentType: "CNPJ",
    participantDocumentCanonical: "04252011000110",
    participantDocumentOriginal: "04.252.011/0001-10",
    xmlSha256: "a".repeat(64),
    payload: { totais: { vICMS: operation === "SAIDA" ? icms : 0 }, participanteUf: "PB" },
    items: [{
      number: 1,
      code: "ITEM-1",
      productId: 1,
      itemConfigId: 1,
      documentUnit: "UN",
      inventoryUnit: "UN",
      creditTreatment,
      payload: { valor_icms: operation === "ENTRADA" ? icms : 0 },
      sourceRefs: [],
    }],
    catalogRecords: [],
    blockCRecords: [],
    diagnostics: [],
  };
}

test("apura ICMS próprio usando apenas entradas explicitamente creditáveis", () => {
  const result = projectSpedAssessment({
    competence: "2026-08",
    documents: [document("SAIDA", 100), document("ENTRADA", 40)],
    priorEfd: { saldos_apuracao: { icmsProprio: { saldoCredorTransportar: 10 } } },
  });
  const e110 = result.blockERecords.find((record) => record.code === "E110");
  assert.equal(e110?.values.VL_TOT_DEBITOS, 100);
  assert.equal(e110?.values.VL_TOT_CREDITOS, 40);
  assert.equal(e110?.values.VL_SLD_CREDOR_ANT, 10);
  assert.equal(e110?.values.VL_ICMS_RECOLHER, 50);
  assert.ok(result.diagnostics.some((item) => item.code === "E116_RECOLHIMENTO_AUSENTE"));
});

test("E116 revisado e conciliado libera o bloqueio de recolhimento", () => {
  const result = projectSpedAssessment({
    competence: "2026-08",
    documents: [document("SAIDA", 100), document("ENTRADA", 40)],
    priorEfd: { saldos_apuracao: { icmsProprio: { saldoCredorTransportar: 10 } } },
    adjustments: [{
      id: 1,
      destination: "E116",
      nature: "RECOLHIMENTO",
      code: "000",
      value: 50,
      description: "ICMS normal",
      reference: { dataVencimento: "2026-09-15" },
    }],
  });
  assert.equal(result.blockERecords.some((record) => record.code === "E116"), true);
  assert.equal(result.diagnostics.some((item) => item.code.startsWith("E116_")), false);
});

test("entrada sem direito a crédito não reduz o imposto", () => {
  const result = projectSpedAssessment({
    competence: "2026-08",
    documents: [document("SAIDA", 100), document("ENTRADA", 40, "SEM_CREDITO")],
    priorEfd: { saldos_apuracao: { icmsProprio: { saldoCredorTransportar: 0 } } },
  });
  const e110 = result.blockERecords.find((record) => record.code === "E110");
  assert.equal(e110?.values.VL_TOT_CREDITOS, 0);
  assert.equal(e110?.values.VL_ICMS_RECOLHER, 100);
});

test("ajustes E111 com filhos E112 e E113 são projetados ordenados", () => {
  const result = projectSpedAssessment({
    competence: "2026-08",
    documents: [document("SAIDA", 100), document("ENTRADA", 100)],
    priorEfd: { saldos_apuracao: { icmsProprio: { saldoCredorTransportar: 0 } } },
    adjustments: [
      {
        id: 10,
        destination: "E111",
        nature: "DEBITO",
        code: "PB000001",
        value: 20,
        description: "Ajuste a débito",
      },
      {
        id: 11,
        destination: "E112",
        nature: "REFERENCIA",
        code: "DA-12345",
        value: 0,
        description: "DA referente ao ajuste",
        reference: { numeroDa: "DA-12345", numeroProcesso: "PROC-999" },
      },
      {
        id: 12,
        destination: "E113",
        nature: "REFERENCIA",
        code: "DOC-REF",
        value: 20,
        description: "Nota fiscal referenciada",
        reference: {
          modeloDocumento: "55",
          numeroDocumento: "1001",
          serie: "1",
          dataDocumento: "2026-08-05",
          chaveEletronica: "2".repeat(44),
        },
      },
      {
        id: 13,
        destination: "E116",
        nature: "RECOLHIMENTO",
        code: "000",
        value: 20,
        description: "ICMS devido ajuste",
        reference: { dataVencimento: "2026-09-15" },
      },
    ],
  });

  const codes = result.blockERecords.map((r) => r.code);
  const e111Index = codes.indexOf("E111");
  assert.ok(e111Index >= 0);
  assert.equal(codes[e111Index + 1], "E112");
  assert.equal(codes[e111Index + 2], "E113");
  assert.equal(result.blockERecords[e111Index + 1].values.NUM_DA, "DA-12345");
  assert.equal(result.blockERecords[e111Index + 2].values.NUM_DOC, "1001");
  assert.equal(result.diagnostics.some((d) => d.code === "AJUSTE_REFERENCIA_SEM_PAI"), false);
});

test("bloqueia ajuste referencial E112 órfão sem E111", () => {
  const result = projectSpedAssessment({
    competence: "2026-08",
    documents: [document("SAIDA", 100), document("ENTRADA", 100)],
    priorEfd: { saldos_apuracao: { icmsProprio: { saldoCredorTransportar: 0 } } },
    adjustments: [
      {
        id: 15,
        destination: "E112",
        nature: "REFERENCIA",
        code: "DA-9999",
        value: 0,
        description: "DA órfão",
        reference: { numeroDa: "DA-9999" },
      },
    ],
  });

  assert.ok(result.diagnostics.some((d) => d.code === "AJUSTE_REFERENCIA_SEM_PAI"));
});

test("múltiplos ajustes E111 aninham filhos apenas no pai correto e não duplicam", () => {
  const result = projectSpedAssessment({
    competence: "2026-08",
    documents: [document("SAIDA", 100), document("ENTRADA", 100)],
    priorEfd: { saldos_apuracao: { icmsProprio: { saldoCredorTransportar: 0 } } },
    adjustments: [
      {
        id: 10,
        destination: "E111",
        nature: "DEBITO",
        code: "PB000001",
        value: 30,
        description: "Ajuste Débito 1",
      },
      {
        id: 20,
        destination: "E111",
        nature: "DEBITO",
        code: "PB000002",
        value: 20,
        description: "Ajuste Débito 2",
      },
      {
        id: 101,
        destination: "E112",
        nature: "REFERENCIA",
        code: "DA-01",
        value: 0,
        description: "DA do ajuste 1",
        reference: { ajustePaiId: 10, numeroDa: "DA-01" },
      },
      {
        id: 102,
        destination: "E113",
        nature: "REFERENCIA",
        code: "NF-01",
        value: 0,
        description: "NF do ajuste 1",
        reference: { ajustePaiId: 10, modeloDocumento: "55", numeroDocumento: "501" },
      },
      {
        id: 30,
        destination: "E116",
        nature: "RECOLHIMENTO",
        code: "000",
        value: 50,
        description: "ICMS a recolher",
        reference: { dataVencimento: "2026-09-15" },
      },
    ],
  });

  assert.equal(result.diagnostics.some((d) => d.code === "AJUSTE_REFERENCIA_SEM_PAI"), false);
  assert.equal(result.diagnostics.some((d) => d.code === "AJUSTE_PAI_AMBIGUO"), false);

  const codes = result.blockERecords.map((r) => r.code);
  // Deve haver exatamente dois E111, um E112 e um E113
  assert.equal(codes.filter((c) => c === "E111").length, 2);
  assert.equal(codes.filter((c) => c === "E112").length, 1);
  assert.equal(codes.filter((c) => c === "E113").length, 1);

  // E112 e E113 devem estar imediatamente após o primeiro E111 (id 10)
  const firstE111 = codes.indexOf("E111");
  assert.equal(codes[firstE111 + 1], "E112");
  assert.equal(codes[firstE111 + 2], "E113");
  assert.equal(codes[firstE111 + 3], "E111"); // O segundo E111 não tem filhos
});

test("múltiplos ajustes E111 bloqueiam filho sem ajustePaiId com AJUSTE_PAI_AMBIGUO", () => {
  const result = projectSpedAssessment({
    competence: "2026-08",
    documents: [document("SAIDA", 100), document("ENTRADA", 100)],
    priorEfd: { saldos_apuracao: { icmsProprio: { saldoCredorTransportar: 0 } } },
    adjustments: [
      { id: 10, destination: "E111", nature: "DEBITO", code: "PB000001", value: 10, description: "A1" },
      { id: 20, destination: "E111", nature: "DEBITO", code: "PB000002", value: 10, description: "A2" },
      { id: 30, destination: "E112", nature: "REFERENCIA", code: "DA-X", value: 0, description: "DA sem pai", reference: { numeroDa: "DA-X" } },
      { id: 40, destination: "E116", nature: "RECOLHIMENTO", code: "000", value: 20, description: "ICMS", reference: { dataVencimento: "2026-09-15" } },
    ],
  });

  assert.ok(result.diagnostics.some((d) => d.code === "AJUSTE_PAI_AMBIGUO"));
  // Garante que o filho ambíguo NÃO foi injetado em nenhum dos pais
  assert.equal(result.blockERecords.filter((r) => r.code === "E112").length, 0);
});

test("múltiplos ajustes E311 DIFAL aninham filhos apenas no pai correto e barram ambiguidade", () => {
  const difalDoc: ProjectedFiscalDocument = {
    ...document("SAIDA", 0),
    payload: { totais: { vICMS: 0 }, participanteUf: "SP" },
    items: [{
      number: 1,
      code: "ITEM-1",
      productId: 1,
      itemConfigId: 1,
      documentUnit: "UN",
      inventoryUnit: "UN",
      creditTreatment: "NAO_APLICAVEL",
      payload: { valor_icms: 0, valor_icms_uf_dest: 50, valor_fcp_uf_dest: 10 },
      sourceRefs: [],
    }],
  };
  const result = projectSpedAssessment({
    competence: "2026-08",
    documents: [difalDoc],
    priorEfd: { saldos_apuracao: { difalFcpByUf: [{ uf: "SP", saldoCredorDifalTransportar: 0, saldoCredorFcpTransportar: 0 }] } },
    adjustments: [
      { id: 1, destination: "E311", uf: "SP", nature: "DEBITO", code: "SP000001", value: 10, description: "Ajuste SP 1", reference: { tributo: "DIFAL" } },
      { id: 2, destination: "E311", uf: "SP", nature: "DEBITO", code: "SP000002", value: 5, description: "Ajuste SP 2", reference: { tributo: "DIFAL" } },
      { id: 101, destination: "E312", uf: "SP", nature: "REFERENCIA", code: "DA-SP", value: 0, description: "DA SP", reference: { ajustePaiId: 1, numeroDa: "DA-SP" } },
      { id: 300, destination: "E316", uf: "SP", nature: "RECOLHIMENTO", code: "000", value: 75, description: "DIFAL+FCP SP", reference: { dataVencimento: "2026-09-15" } },
    ],
  });

  assert.equal(result.diagnostics.some((d) => d.code === "AJUSTE_PAI_DIFAL_AMBIGUO"), false);
  const codes = result.blockERecords.map((r) => r.code);
  assert.equal(codes.filter((c) => c === "E311").length, 2);
  assert.equal(codes.filter((c) => c === "E312").length, 1);
  const firstE311 = codes.indexOf("E311");
  assert.equal(codes[firstE311 + 1], "E312");
  assert.equal(codes[firstE311 + 2], "E311");
});

