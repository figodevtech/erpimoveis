import test, { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { EfdRecord } from "@/lib/sped/efd-icms-ipi";
import { resolveSpedLayout, serializeEfdRecord, validateEfdCrossReferences, validateEfdRecords } from "@/lib/sped/efd-icms-ipi";
import { deriveUnitConversions, mergeItemVersions, mergeParticipantVersions, projectSpedCatalog, type SpedEntryUnitUsage, type SpedUnitConversion } from "./catalogProjection";

test("projeção de cadastros: ordena 0150, 0190 e 0200 corretamente", () => {
  const baseRecords: EfdRecord[] = [
    { code: "0200", values: { COD_ITEM: "PROD_B", DESCR_ITEM: "Produto B", UNID_INV: "UN", TIPO_ITEM: "00" } },
    { code: "0150", values: { COD_PART: "PART_2", NOME: "Participante 2" } },
    { code: "0200", values: { COD_ITEM: "PROD_A", DESCR_ITEM: "Produto A", UNID_INV: "PC", TIPO_ITEM: "00" } },
    { code: "0190", values: { UNID: "UN", DESCR: "Unidade" } },
    { code: "0150", values: { COD_PART: "PART_1", NOME: "Participante 1" } },
    { code: "0190", values: { UNID: "PC", DESCR: "Peça" } },
  ];

  const result = projectSpedCatalog({
    baseCatalogRecords: baseRecords,
    competenceStart: "2026-08-01",
    competenceEnd: "2026-08-31",
  });

  assert.equal(result.diagnostics.length, 0);
  const codes = result.catalogRecords.map((r) => r.code);
  assert.deepEqual(codes, ["0150", "0150", "0190", "0190", "0200", "0200"]);

  // 0150 ordenados
  assert.equal(result.catalogRecords[0].values.COD_PART, "PART_1");
  assert.equal(result.catalogRecords[1].values.COD_PART, "PART_2");

  // 0200 ordenados
  assert.equal(result.catalogRecords[4].values.COD_ITEM, "PROD_A");
  assert.equal(result.catalogRecords[5].values.COD_ITEM, "PROD_B");
});

test("projeção de 0220: converte JGO -> UN e aninha imediatamente sob o 0200 pai", () => {
  const baseRecords: EfdRecord[] = [
    { code: "0190", values: { UNID: "UN", DESCR: "Unidade" } },
    { code: "0200", values: { COD_ITEM: "JOGO_PASTILHA", DESCR_ITEM: "Jogo de Pastilhas", UNID_INV: "UN", TIPO_ITEM: "00" } },
    { code: "0200", values: { COD_ITEM: "OLEO", DESCR_ITEM: "Óleo Motor", UNID_INV: "L", TIPO_ITEM: "00" } },
  ];

  const result = projectSpedCatalog({
    baseCatalogRecords: baseRecords,
    unitConversions: [
      {
        id: 1,
        codigoItem: "JOGO_PASTILHA",
        unidadeOrigem: "JGO",
        unidadeDestino: "UN",
        fatorConversao: 4,
        vigenciaInicio: "2026-01-01",
      },
    ],
    competenceStart: "2026-08-01",
    competenceEnd: "2026-08-31",
  });

  assert.equal(result.diagnostics.length, 0);
  assert.ok(result.itemsWith0220.has("JOGO_PASTILHA"));
  assert.ok(!result.itemsWith0220.has("OLEO"));

  // JGO foi automaticamente adicionado ao 0190
  const unids = result.catalogRecords.filter((r) => r.code === "0190").map((r) => r.values.UNID);
  assert.ok(unids.includes("JGO"));
  assert.ok(unids.includes("UN"));

  // Verificar hierarquia: 0220 deve vir imediatamente após JOGO_PASTILHA
  const itemIndex = result.catalogRecords.findIndex((r) => r.code === "0200" && r.values.COD_ITEM === "JOGO_PASTILHA");
  assert.ok(itemIndex >= 0);
  const nextRecord = result.catalogRecords[itemIndex + 1];
  assert.equal(nextRecord?.code, "0220");
  assert.equal(nextRecord?.values.UNID_CONV, "JGO");
  assert.equal(nextRecord?.values.FAT_CONV, 4);
});

test("projeção de 0221: correlação de kit composto para item atômico com validação", () => {
  const baseRecords: EfdRecord[] = [
    { code: "0200", values: { COD_ITEM: "KIT_EMBREAGEM", DESCR_ITEM: "Kit Embreagem Completo", UNID_INV: "UN", TIPO_ITEM: "00" } },
    { code: "0200", values: { COD_ITEM: "DISCO_EMBREAGEM", DESCR_ITEM: "Disco de Embreagem", UNID_INV: "UN", TIPO_ITEM: "00" } },
    { code: "0200", values: { COD_ITEM: "PLATO_EMBREAGEM", DESCR_ITEM: "Platô de Embreagem", UNID_INV: "UN", TIPO_ITEM: "00" } },
  ];

  const result = projectSpedCatalog({
    baseCatalogRecords: baseRecords,
    itemCorrelations: [
      {
        id: 10,
        codigoItemPrincipal: "KIT_EMBREAGEM",
        codigoItemAtomico: "DISCO_EMBREAGEM",
        quantidade: 1,
        vigenciaInicio: "2026-01-01",
      },
      {
        id: 11,
        codigoItemPrincipal: "KIT_EMBREAGEM",
        codigoItemAtomico: "PLATO_EMBREAGEM",
        quantidade: 1,
        vigenciaInicio: "2026-01-01",
      },
    ],
    competenceStart: "2026-08-01",
    competenceEnd: "2026-08-31",
  });

  assert.equal(result.diagnostics.length, 0);
  assert.ok(result.itemsWith0221.has("KIT_EMBREAGEM"));

  // Localizar KIT_EMBREAGEM e conferir se os dois 0221 o seguem imediatamente
  const kitIndex = result.catalogRecords.findIndex((r) => r.code === "0200" && r.values.COD_ITEM === "KIT_EMBREAGEM");
  assert.ok(kitIndex >= 0);
  assert.equal(result.catalogRecords[kitIndex + 1]?.code, "0221");
  assert.equal(result.catalogRecords[kitIndex + 1]?.values.COD_ITEM_ATOMICO, "DISCO_EMBREAGEM");
  assert.equal(result.catalogRecords[kitIndex + 2]?.code, "0221");
  assert.equal(result.catalogRecords[kitIndex + 2]?.values.COD_ITEM_ATOMICO, "PLATO_EMBREAGEM");
});

test("projeção de 0221: bloqueia quando o item atômico não consta no 0200", () => {
  const baseRecords: EfdRecord[] = [
    { code: "0200", values: { COD_ITEM: "KIT_MOTOR", DESCR_ITEM: "Kit Motor", UNID_INV: "UN", TIPO_ITEM: "00" } },
  ];

  const result = projectSpedCatalog({
    baseCatalogRecords: baseRecords,
    itemCorrelations: [
      {
        id: 20,
        codigoItemPrincipal: "KIT_MOTOR",
        codigoItemAtomico: "PISTAO_INEXISTENTE",
        quantidade: 4,
        vigenciaInicio: "2026-01-01",
      },
    ],
    competenceStart: "2026-08-01",
    competenceEnd: "2026-08-31",
  });

  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "0221_ITEM_ATOMICO_NAO_CADASTRADO");
  assert.equal(result.diagnostics[0].severity, "BLOQUEIO");
});

test("projeção de 0205: gera histórico quando houver alteração do item", () => {
  const baseRecords: EfdRecord[] = [
    { code: "0200", values: { COD_ITEM: "FILTRO_AR", DESCR_ITEM: "Filtro de Ar Motor V2", UNID_INV: "UN", TIPO_ITEM: "00" } },
  ];

  const result = projectSpedCatalog({
    baseCatalogRecords: baseRecords,
    historicalChanges: [
      {
        id: 30,
        codigoItem: "FILTRO_AR",
        descricaoAnterior: "Filtro de Ar Motor V1",
        dataInicio: "2026-01-01",
        dataFim: "2026-07-31",
      },
    ],
    competenceStart: "2026-08-01",
    competenceEnd: "2026-08-31",
  });

  assert.equal(result.diagnostics.length, 0);
  const itemIndex = result.catalogRecords.findIndex((r) => r.code === "0200" && r.values.COD_ITEM === "FILTRO_AR");
  assert.equal(result.catalogRecords[itemIndex + 1]?.code, "0205");
  assert.equal(result.catalogRecords[itemIndex + 1]?.values.DESCR_ANT_ITEM, "Filtro de Ar Motor V1");
  assert.equal(result.catalogRecords[itemIndex + 1]?.values.DT_INI, "2026-01-01");
  assert.equal(result.catalogRecords[itemIndex + 1]?.values.DT_FIM, "2026-07-31");
});

describe("participante com dados diferentes entre notas do mês (0150 + 0175)", () => {
  // Casos reais do Demir em 09/2026.
  const pedreiras = (values: Record<string, unknown>) => ({
    COD_PART: "P15851413000157", NOME: "PEDREIRAS VALERIA LTDA", COD_PAIS: "01058", CNPJ: "15851413000157", COD_MUN: "2927408", BAIRRO: "VALERIA", ...values,
  });

  it("0150 com os dados da nota mais recente e um 0175 por campo alterado", () => {
    const result = mergeParticipantVersions([
      { date: "2026-09-18", record: { code: "0150", values: pedreiras({ IE: "070670003", END: "TERRA NOVA", NUM: "000014", COMPL: "SALA 04" }), source: { source: "XML", table: "nfe", id: 168 } } },
      { date: "2026-09-11", record: { code: "0150", values: pedreiras({ IE: "70670003", END: "TRAVESSA TERRA NOVA", NUM: "00014", COMPL: null }), source: { source: "XML", table: "nfe", id: 165 } } },
    ]);
    // Zero à esquerda não é outra inscrição estadual.
    assert.equal(result.diagnostics.length, 0);
    const [participant, ...changes] = result.records;
    assert.equal(participant.values.END, "TERRA NOVA");
    assert.equal(participant.values.IE, "070670003");
    assert.deepEqual(changes.map((record) => record.values), [
      { DT_ALT: "2026-09-18", NR_CAMPO: "10", CONT_ANT: "TRAVESSA TERRA NOVA" },
      { DT_ALT: "2026-09-18", NR_CAMPO: "11", CONT_ANT: "00014" },
    ]);
    // COMPL antes vazio: sem conteúdo anterior, sem 0175.
    assert.equal(changes.every((record) => record.source?.documentKey === "P15851413000157"), true);
  });

  it("notas iguais não geram 0175", () => {
    const record = { code: "0150", values: pedreiras({ IE: "70670003", END: "TERRA NOVA" }) };
    const result = mergeParticipantVersions([{ date: "2026-09-01", record }, { date: "2026-09-20", record }]);
    assert.deepEqual(result.records.map((item) => item.code), ["0150"]);
  });

  it("mudança real de inscrição estadual bloqueia: exige outro participante", () => {
    const result = mergeParticipantVersions([
      { date: "2026-09-01", record: { code: "0150", values: pedreiras({ IE: "70670003" }) } },
      { date: "2026-09-20", record: { code: "0150", values: pedreiras({ IE: "99999999" }) } },
    ]);
    assert.equal(result.diagnostics[0]?.code, "CADASTRO_FISCAL_DIVERGENTE");
    assert.match(result.diagnostics[0].message, /inscrições estaduais diferentes/);
  });

  it("o 0175 sai logo abaixo do seu 0150 e passa no leiaute", () => {
    const merged = mergeParticipantVersions([
      { date: "2026-09-02", record: { code: "0150", values: pedreiras({ COD_PART: "P45323371000142", END: "RUA MORUMBI", BAIRRO: "JD PAULISTA" }) } },
      { date: "2026-09-25", record: { code: "0150", values: pedreiras({ COD_PART: "P45323371000142", END: "MORUMBI", BAIRRO: "JARDIM PAULISTA" }) } },
    ]);
    const result = projectSpedCatalog({
      // Os 0175 chegam antes do 0150: a projeção reagrupa pelo participante.
      baseCatalogRecords: [{ code: "0150", values: pedreiras({ COD_PART: "P99" }) }, ...merged.records.slice(1), merged.records[0]],
      competenceStart: "2026-09-01",
      competenceEnd: "2026-09-30",
    });
    assert.deepEqual(result.catalogRecords.map((record) => record.code), ["0150", "0175", "0175", "0150"]);
    const layout = resolveSpedLayout("2026-09");
    assert.deepEqual(validateEfdRecords(result.catalogRecords, layout).filter((item) => item.severity === "BLOQUEIO"), []);
    assert.equal(serializeEfdRecord(result.catalogRecords[1], layout), "|0175|25092026|10|RUA MORUMBI|");
  });
});

describe("0220 tirado da própria entrada", () => {
  const usage = (overrides: Partial<SpedEntryUnitUsage> = {}): SpedEntryUnitUsage => ({
    code: "1806", documentUnit: "PC", inventoryUnit: "UN", documentQuantity: 1, stockQuantity: 1, ...overrides,
  });
  const derive = (usages: SpedEntryUnitUsage[], manual: SpedUnitConversion[] = []) =>
    deriveUnitConversions({ usages, manual, competenceStart: "2026-09-01" });

  it("PC do fornecedor que entrou 1 para 1 como UN vira 0220 com fator 1 e fecha o C170", () => {
    const { conversions, diagnostics } = derive([usage(), usage({ code: "1975", documentUnit: "LT", documentQuantity: 24, stockQuantity: 24 })]);
    assert.equal(diagnostics.length, 0);
    assert.deepEqual(conversions.map((item) => [item.codigoItem, item.unidadeOrigem, item.fatorConversao]), [["1806", "PC", 1], ["1975", "LT", 1]]);

    const catalog = projectSpedCatalog({
      baseCatalogRecords: [
        { code: "0190", values: { UNID: "UN", DESCR: "UN" } },
        { code: "0200", values: { COD_ITEM: "1806", DESCR_ITEM: "FILTRO", UNID_INV: "UN", TIPO_ITEM: "00" } },
      ],
      unitConversions: conversions,
      competenceStart: "2026-09-01",
      competenceEnd: "2026-09-30",
    });
    const c170: EfdRecord = { code: "C170", values: { COD_ITEM: "1806", UNID: "PC" } };
    assert.deepEqual(validateEfdCrossReferences([...catalog.catalogRecords, c170]).filter((item) => item.code === "UNIDADE_CONVERSAO_AUSENTE"), []);
    assert.equal(catalog.catalogRecords.some((record) => record.code === "0190" && record.values.UNID === "PC"), true);
  });

  it("caixa que entrou como 10 unidades dá fator 10", () => {
    assert.equal(derive([usage({ documentUnit: "CX", documentQuantity: 2, stockQuantity: 20 })]).conversions[0].fatorConversao, 10);
  });

  it("fração arredondada na entrada (6,15 M → 6) é a mesma unidade", () => {
    assert.equal(derive([usage({ documentUnit: "M", documentQuantity: 6.15, stockQuantity: 6 })]).conversions[0].fatorConversao, 1);
  });

  it("fator cadastrado à mão prevalece, por item ou geral da unidade", () => {
    assert.equal(derive([usage()], [{ id: 1, codigoItem: "1806", unidadeOrigem: "PC", unidadeDestino: "UN", fatorConversao: 1, vigenciaInicio: "2026-01-01" }]).conversions.length, 0);
    assert.equal(derive([usage()], [{ id: 2, codigoItem: null, unidadeOrigem: "PC", unidadeDestino: "UN", fatorConversao: 1, vigenciaInicio: "2026-01-01" }]).conversions.length, 0);
  });

  it("mesmo item com fatores diferentes no mês fica pendente; sem quantidade de estoque, não adivinha", () => {
    const divergent = derive([usage({ documentUnit: "CX", documentQuantity: 1, stockQuantity: 10 }), usage({ documentUnit: "CX", documentQuantity: 1, stockQuantity: 12 })]);
    assert.equal(divergent.conversions.length, 0);
    assert.equal(divergent.diagnostics[0].code, "UNIDADE_CONVERSAO_DIVERGENTE");
    assert.equal(derive([usage({ stockQuantity: null })]).conversions.length, 0);
    assert.equal(derive([usage({ documentUnit: "UN" })]).conversions.length, 0);
  });
});

describe("mesmo item em várias notas do mês (0200)", () => {
  // UC12 do Demir em 09/2026: cadastro sem CEST, cada fornecedor preenche de um jeito.
  const limpaContato = (date: string, values: Record<string, unknown>) => ({
    date,
    record: {
      code: "0200",
      values: { COD_ITEM: "UC12", DESCR_ITEM: "LIMPA CONTATO ELETRICO SNAP-ON CAR CONTATO 12", COD_BARRA: "7897068800122", UNID_INV: "UN", TIPO_ITEM: "07", COD_NCM: "29012900", ...values },
    } as EfdRecord,
  });

  it("nota que não informa o CEST não apaga o das outras", () => {
    const result = mergeItemVersions([
      limpaContato("2026-09-08", { CEST: "0199900" }),
      limpaContato("2026-09-23", { CEST: null }),
      limpaContato("2026-09-10", { CEST: "0199900" }),
    ]);
    assert.equal(result.diagnostics.length, 0);
    assert.equal(result.record.values.CEST, "0199900");
  });

  it("código de barras diferente fica com a nota mais recente, sem bloquear", () => {
    const result = mergeItemVersions([
      limpaContato("2026-09-23", { COD_BARRA: "7894170099642" }),
      limpaContato("2026-09-08", { COD_BARRA: "7897068800122" }),
    ]);
    assert.equal(result.diagnostics.length, 0);
    assert.equal(result.record.values.COD_BARRA, "7894170099642");
  });

  it("NCM ou CEST realmente diferentes bloqueiam e dizem quais são", () => {
    const result = mergeItemVersions([
      limpaContato("2026-09-08", { CEST: "0199900", COD_NCM: "29012900" }),
      limpaContato("2026-09-23", { CEST: "0100100", COD_NCM: "34031900" }),
    ]);
    assert.equal(result.diagnostics[0]?.code, "CADASTRO_FISCAL_DIVERGENTE");
    assert.match(result.diagnostics[0].message, /NCM \(29012900 e 34031900\)/);
    assert.match(result.diagnostics[0].message, /CEST \(0199900 e 0100100\)/);
  });
});
