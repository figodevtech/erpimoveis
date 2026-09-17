import test from "node:test";
import assert from "node:assert/strict";

import type { EfdRecord } from "@/lib/sped/efd-icms-ipi";
import { projectSpedCatalog } from "./catalogProjection";

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
