import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  hasBlockingDiagnostics,
  resolveSpedLayout,
  serializeEfd,
  validateEfdCrossReferences,
  validateEfdRecords,
  type EfdRecord,
} from "@/lib/sped/efd-icms-ipi";

import { projectSpedAssessment } from "./assessmentProjection";
import { projectSpedCatalog } from "./catalogProjection";
import { projectFiscalDocument, type ProjectedFiscalDocument, type SpedItemAssignment } from "./documentProjection";
import { CUSTOMER_CPF, fixtureKey, nfeXml, OWN_CNPJ, SUPPLIER_CNPJ } from "./fixtures.test-helpers";
import { buildFoundationRecords } from "./projection";
import { reconcileDocuments } from "./reconciliation";

const company = {
  id: 1,
  razaosocial: "AUTO ELETRICA DEMIR LTDA",
  nomefantasia: "DEMIR DIESEL",
  cnpj: OWN_CNPJ,
  inscricaoestadual: "161726542",
  codigomunicipio: "2507507",
  uf: "PB",
  cep: "58000000",
  endereco: "Rua Principal",
  numero: "100",
  complemento: "",
  bairro: "Centro",
  telefone: "8333334444",
  inscricaomunicipal: "",
};
const config = { perfil_efd: "B", indicador_atividade: "1" };
const accountant = { nome: "CONTADOR", cpf: "52998224725", crc: "PB-001", cep: "58000000", endereco: "Rua C", numero: "3", bairro: "Centro", email: "c@x.com", codigo_municipio: "2507507" };
const layout = resolveSpedLayout("2026-08");

const product = (id: number): SpedItemAssignment => ({
  code: String(id),
  productId: id,
  itemConfigId: id,
  itemType: "00",
  master: { description: `PEÇA Nº ${id} AÇÃO`, unit: "UN", ncm: "87089990", cest: null, barcode: null, internalIcmsRate: 20 },
});

function sale(seed: number, status = "AUTORIZADA", extra: Parameters<typeof nfeXml>[0] = {}) {
  return projectFiscalDocument({
    sourceType: extra.model === "65" ? "NFC_E" : "NFE_EMITIDA",
    sourceTable: "nfe",
    sourceId: seed,
    operation: "SAIDA",
    status,
    xml: nfeXml({ key: fixtureKey(seed), recipient: { cpf: CUSTOMER_CPF, uf: "PB" }, items: [{ cfop: "5102", vProd: 100 }], ...extra }),
    xmlSha256: "a".repeat(64),
    itemAssignments: new Map([[1, product(10 + (seed % 5))]]),
  });
}

function purchase(seed: number, creditTreatment: string, uCom = "UN") {
  return projectFiscalDocument({
    sourceType: "NFE_RECEBIDA",
    sourceTable: "entrada",
    sourceId: seed,
    operation: "ENTRADA",
    status: "CONFIRMADA",
    xml: nfeXml({ key: fixtureKey(seed), emitter: { cnpj: SUPPLIER_CNPJ, uf: "PB" }, recipient: { cnpj: OWN_CNPJ, uf: "PB" }, items: [{ cfop: "5102", vProd: 50, uCom }] }),
    xmlSha256: "b".repeat(64),
    bookkeepingDate: "2026-08-05",
    receivedDocumentId: seed,
    itemAssignments: new Map([[1, { ...product(10 + (seed % 5)), creditTreatment }]]),
  });
}

/** Mesma composição do serviço: documentos → apuração → catálogo → registros. */
function compose(documents: ProjectedFiscalDocument[], options: { finalidade?: "ORIGINAL" | "RETIFICADORA" } = {}) {
  const catalogs = new Map<string, EfdRecord>();
  const blockC: EfdRecord[] = [];
  for (const document of documents) {
    blockC.push(...document.blockCRecords);
    for (const record of document.catalogRecords) {
      const id = `${record.code}|${record.values.COD_PART ?? record.values.UNID ?? record.values.COD_ITEM}`;
      if (!catalogs.has(id)) catalogs.set(id, record);
    }
  }
  const assessment = projectSpedAssessment({ competence: "2026-08", documents, priorEfd: null });
  const catalog = projectSpedCatalog({ baseCatalogRecords: Array.from(catalogs.values()), competenceStart: "2026-08-01", competenceEnd: "2026-08-31" });
  const records = buildFoundationRecords({
    competence: "2026-08",
    layoutCode: layout.code,
    finalidade: options.finalidade,
    company,
    config,
    accountant,
    catalogRecords: catalog.catalogRecords,
    blockCRecords: blockC,
    blockERecords: assessment.blockERecords,
  });
  return { records, assessment };
}

function lines(text: string) {
  return text.split("\r\n").filter(Boolean);
}

describe("arquivo da competência", () => {
  it("empresa sem movimento: blocos com IND_MOV 1, apuração zerada e totalizadores corretos", () => {
    const { records } = compose([]);
    const file = serializeEfd(records, layout);
    const all = lines(file.text);
    assert.match(all[0], /^\|0000\|020\|0\|01082026\|31082026\|/);
    assert.ok(all.includes("|C001|1|"));
    assert.ok(all.some((line) => line.startsWith("|E110|0,00|")));
    assert.equal(all.at(-1), `|9999|${all.length}|`);
    assert.equal(validateEfdCrossReferences(records).filter((item) => item.severity === "BLOQUEIO").length, 0);
  });

  it("competência completa: totalizadores, conciliação E110 × C190 e codificação Latin-1/CRLF", () => {
    const documents = [
      sale(1),
      sale(2, "CANCELADA"),
      sale(3, "DENEGADA"),
      sale(4, "AUTORIZADA", { model: "65" }),
      purchase(5, "CREDITAVEL"),
      purchase(6, "SEM_CREDITO"),
    ];
    const { records, assessment } = compose(documents);
    const blocking = [...validateEfdRecords(records, layout), ...validateEfdCrossReferences(records)].filter((item) => item.severity === "BLOQUEIO");
    assert.deepEqual(blocking, []);
    const e110 = assessment.blockERecords.find((record) => record.code === "E110")!;
    assert.equal(e110.values.VL_TOT_DEBITOS, 36, "duas saídas autorizadas de 100 a 18%");
    assert.equal(e110.values.VL_TOT_CREDITOS, 9, "só a entrada creditável (50 a 18%)");

    const file = serializeEfd(records, layout);
    const all = lines(file.text);
    assert.ok(file.text.endsWith("\r\n"));
    assert.equal(file.text.replace(/\r\n/g, "").includes("\n"), false);
    // "PEÇA Nº ... AÇÃO" em Latin-1: um byte por caractere, sem "?".
    const encoded = Buffer.from(file.bytes).toString("latin1");
    assert.ok(encoded.includes("PEÇA Nº 10 AÇÃO"));
    assert.equal(file.bytes.length, encoded.length);
    // 9900 conta cada registro; 9999 conta todas as linhas.
    const counts = new Map<string, number>();
    for (const line of all) counts.set(line.split("|")[1], (counts.get(line.split("|")[1]) ?? 0) + 1);
    for (const line of all.filter((item) => item.startsWith("|9900|"))) {
      const [, , code, quantity] = line.split("|");
      assert.equal(Number(quantity), counts.get(code), `9900 de ${code}`);
    }
    assert.equal(counts.get("C100"), 6);
    assert.equal(all.at(-1), `|9999|${all.length}|`);
    const c990 = all.find((line) => line.startsWith("|C990|"))!;
    assert.equal(Number(c990.split("|")[2]), all.filter((line) => line.startsWith("|C")).length);
    // Cancelada e denegada: C100 com identificação apenas.
    for (const [key, situation] of [[fixtureKey(2), "02"], [fixtureKey(3), "04"]]) {
      const fields = all.find((line) => line.includes(`|${key}|`) && line.startsWith("|C100|"))!.split("|").slice(1, -1);
      // REG, IND_OPER, IND_EMIT, COD_PART, COD_MOD, COD_SIT, SER, NUM_DOC, CHV_NFE, depois tudo vazio.
      assert.deepEqual(fields.slice(0, 6), ["C100", "1", "0", "", "55", situation]);
      assert.equal(fields[8], key);
      assert.ok(fields.slice(9).every((value) => value === ""), `${situation}: campos após CHV_NFE vazios`);
    }
  });

  it("retificadora informa COD_FIN 1", () => {
    const { records } = compose([], { finalidade: "RETIFICADORA" });
    assert.match(lines(serializeEfd(records, layout).text)[0], /^\|0000\|020\|1\|/);
  });

  it("entrada em unidade diferente da de estoque sem 0220 bloqueia", () => {
    const { records } = compose([purchase(7, "CREDITAVEL", "CX")]);
    const diagnostics = validateEfdCrossReferences(records);
    assert.ok(diagnostics.some((item) => item.code === "UNIDADE_CONVERSAO_AUSENTE"));
  });

  it("milhares de documentos: projeta, concilia e serializa sem perda", () => {
    const started = Date.now();
    const documents: ProjectedFiscalDocument[] = [];
    for (let seed = 1000; seed < 2500; seed += 1) documents.push(sale(seed));
    for (let seed = 5000; seed < 5300; seed += 1) documents.push(purchase(seed, "CREDITAVEL"));
    const { records } = compose(documents);
    const file = serializeEfd(records, layout);
    const c100 = lines(file.text).filter((line) => line.startsWith("|C100|")).length;
    assert.equal(c100, 1800);
    const reconciliation = reconcileDocuments({ sourceNotes: 1500, sourceEntries: 300, projected: documents.length, rejected: 0, duplicates: 0, c100 });
    assert.equal(reconciliation.summary.balanced, true);
    assert.equal(hasBlockingDiagnostics(validateEfdCrossReferences(records)), false);
    assert.ok(Date.now() - started < 60_000, "volume processado em tempo razoável");
  });
});
