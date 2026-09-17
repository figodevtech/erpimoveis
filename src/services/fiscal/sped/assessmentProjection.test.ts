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
