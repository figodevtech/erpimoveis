import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  planSpedCreditResolution,
  planSpedItemResolution,
  type SpedAutoProduct,
  type SpedExistingItemConfig,
  type SpedProductUsage,
} from "./autoResolution";

const START = "2026-08-01";
const END = "2026-08-31";

function product(id: number, overrides: Partial<SpedAutoProduct> = {}): SpedAutoProduct {
  return { id, description: `Produto ${id}`, unit: "UN", ncm: "87089990", cest: null, barcode: null, internalIcmsRate: 20, deleted: false, ...overrides };
}

function sale(productId: number, cfop = "5102"): SpedProductUsage {
  return { productId, operation: "SAIDA", ownIssued: true, cfop, documentKey: `NFE-${productId}`, itemNumber: 1 };
}

function purchase(productId: number, cfop = "5102"): SpedProductUsage {
  return { productId, operation: "ENTRADA", ownIssued: false, cfop, documentKey: `ENT-${productId}`, itemNumber: 1 };
}

function plan(products: SpedAutoProduct[], usages: SpedProductUsage[], configs: SpedExistingItemConfig[] = []) {
  return planSpedItemResolution({
    competenceStart: START,
    competenceEnd: END,
    products: new Map(products.map((item) => [item.id, item])),
    usages,
    configs,
  });
}

describe("resolução automática do 0200", () => {
  it("produto vendido como revenda ganha código estável (id) e tipo 00", () => {
    const result = plan([product(10)], [sale(10), sale(10, "6102")]);
    assert.equal(result.diagnostics.length, 0);
    assert.deepEqual(result.create, [{ productId: 10, code: "10", itemType: "00", start: START, end: null, evidence: result.create[0].evidence }]);
    assert.match(result.create[0].evidence, /NF-e própria NFE-10/);
  });

  it("produto que entrou no estoque de venda é revenda, com ou sem preço e qualquer CFOP", () => {
    for (const cfop of ["6405", "5655", "6915"]) {
      const result = plan([product(11)], [purchase(11, cfop)]);
      assert.equal(result.diagnostics.length, 0);
      assert.equal(result.create[0]?.itemType, "00");
      assert.match(result.create[0].evidence, /estoque de venda.*entrada da NF-e ENT-11/);
    }
  });

  it("saída de produção própria exige classificação humana", () => {
    const result = plan([product(13)], [sale(13, "5101")]);
    assert.equal(result.create.length, 0);
    assert.match(result.diagnostics[0].message, /produção própria/);
  });

  it("uma pendência por produto, não por nota", () => {
    const result = plan([product(14)], [sale(14, "5101"), sale(14, "5101"), purchase(14)]);
    assert.equal(result.diagnostics.length, 1);
  });

  it("produto já configurado na competência não é tocado", () => {
    const result = plan([product(15)], [sale(15)], [{ id: 1, productId: 15, code: "ABC", itemType: "00", start: "2026-01-01", end: null }]);
    assert.equal(result.create.length, 0);
    assert.equal(result.diagnostics.length, 0);
  });

  it("classificação de meses seguintes vale para trás com o mesmo código", () => {
    const result = plan([product(16)], [sale(16)], [{ id: 2, productId: 16, code: "XYZ", itemType: "00", start: "2026-10-01", end: null }]);
    assert.deepEqual(result.create.map(({ code, itemType, start, end }) => ({ code, itemType, start, end })), [
      { code: "XYZ", itemType: "00", start: START, end: "2026-09-30" },
    ]);
  });

  it("configuração encerrada antes da competência não é reaberta sozinha", () => {
    const result = plan([product(17)], [sale(17)], [{ id: 3, productId: 17, code: "OLD", itemType: "00", start: "2025-01-01", end: "2026-06-30" }]);
    assert.equal(result.diagnostics[0].code, "CONFIG_ITEM_ENCERRADA");
  });

  it("código ocupado por outro produto usa o alternativo; ambos ocupados vira pendência", () => {
    const taken: SpedExistingItemConfig[] = [{ id: 4, productId: 99, code: "18", itemType: "00", start: "2026-01-01", end: null }];
    assert.equal(plan([product(18)], [sale(18)], taken).create[0].code, "PROD18");
    const both = [...taken, { id: 5, productId: 98, code: "PROD18", itemType: "00", start: "2026-01-01", end: null }];
    assert.equal(plan([product(18)], [sale(18)], both).diagnostics.some((item) => item.code === "CODIGO_ITEM_INDISPONIVEL"), true);
  });

  it("dois produtos com o mesmo código vigente são acusados", () => {
    const configs: SpedExistingItemConfig[] = [
      { id: 6, productId: 20, code: "DUP", itemType: "00", start: "2026-01-01", end: null },
      { id: 7, productId: 21, code: "DUP", itemType: "00", start: "2026-01-01", end: null },
    ];
    const result = plan([product(20), product(21)], [sale(20), sale(21)], configs);
    assert.equal(result.diagnostics.filter((item) => item.code === "CODIGO_ITEM_COMPARTILHADO").length, 1);
  });

  it("produto excluído do cadastro não é recriado", () => {
    const result = plan([product(22, { deleted: true })], [sale(22)]);
    assert.equal(result.diagnostics[0].code, "PRODUTO_DOCUMENTO_INEXISTENTE");
  });

  it("dois planos seguidos não criam código duplicado no mesmo lote", () => {
    const result = plan([product(30), product(31)], [sale(30), sale(31)]);
    assert.deepEqual(result.create.map((item) => item.code), ["30", "31"]);
  });
});

describe("resolução automática do crédito", () => {
  const base = { dfeId: 1, itemNumber: 1, documentKey: "K", itemType: "00", xmlIcms: 18, xmlSimplesCredit: 0, cst: "000" };

  it("sem ICMS destacado não há o que creditar", () => {
    const result = planSpedCreditResolution({ candidates: [{ ...base, xmlIcms: 0 }], policy: { resaleCreditConfirmed: false } });
    assert.equal(result.create[0].treatment, "SEM_CREDITO");
  });

  it("crédito do Simples (vCredICMSSN) não é tratado como sem crédito", () => {
    const result = planSpedCreditResolution({ candidates: [{ ...base, xmlIcms: 0, xmlSimplesCredit: 1.25, itemType: "99" }], policy: { resaleCreditConfirmed: true } });
    assert.equal(result.create.length, 0);
    assert.equal(result.diagnostics[0].code, "TRATAMENTO_CREDITO_PENDENTE");
  });

  it("revenda comprada de optante do Simples credita o vCredICMSSN (LC 123, art. 23)", () => {
    const simples = { ...base, xmlIcms: 0, xmlSimplesCredit: 58.95, cst: "0101" };
    const result = planSpedCreditResolution({ candidates: [simples], policy: { resaleCreditConfirmed: true, resaleCredit: true } });
    assert.equal(result.create[0]?.treatment, "CREDITAVEL");
    assert.match(result.create[0].evidence, /Simples Nacional de R\$ 58\.95/);
    // Regime que não credita (Simples) e política ainda não decidida não creditam.
    assert.equal(planSpedCreditResolution({ candidates: [simples], policy: { resaleCreditConfirmed: false, resaleCredit: false } }).create[0].treatment, "SEM_CREDITO");
    assert.equal(planSpedCreditResolution({ candidates: [simples], policy: { resaleCreditConfirmed: false } }).diagnostics[0].code, "POLITICA_CREDITO_REVENDA_PENDENTE");
  });

  it("revenda com ICMS destacado credita só com a política confirmada", () => {
    const without = planSpedCreditResolution({ candidates: [base, { ...base, itemNumber: 2 }], policy: { resaleCreditConfirmed: false } });
    assert.equal(without.create.length, 0);
    assert.equal(without.diagnostics.length, 1);
    assert.equal(without.diagnostics[0].code, "POLITICA_CREDITO_REVENDA_PENDENTE");
    const withPolicy = planSpedCreditResolution({ candidates: [base], policy: { resaleCreditConfirmed: true } });
    assert.equal(withPolicy.create[0].treatment, "CREDITAVEL");
  });

  it("ICMS-ST (CST 60) com ICMS próprio destacado fica para decisão fiscal", () => {
    const st = planSpedCreditResolution({ candidates: [{ ...base, cst: "060" }], policy: { resaleCreditConfirmed: true } });
    assert.equal(st.create.length, 0);
  });

  it("ativo imobilizado segue a classificação do item (crédito pelo CIAP, fora do C170)", () => {
    const asset = planSpedCreditResolution({ candidates: [{ ...base, itemType: "08" }], policy: { resaleCreditConfirmed: true } });
    assert.equal(asset.create[0].treatment, "ATIVO_IMOBILIZADO");
  });

  it("regime sem crédito (Simples Nacional) não credita nada, sem pendência", () => {
    const result = planSpedCreditResolution({
      candidates: [base, { ...base, itemNumber: 2, cst: "060" }, { ...base, itemNumber: 3, itemType: "99" }],
      policy: { resaleCreditConfirmed: false, resaleCredit: false },
    });
    assert.deepEqual(result.create.map((item) => item.treatment), ["SEM_CREDITO", "SEM_CREDITO", "SEM_CREDITO"]);
    assert.equal(result.diagnostics.length, 0);
  });

  it("material de uso e consumo não gera crédito", () => {
    const result = planSpedCreditResolution({ candidates: [{ ...base, itemType: "07" }], policy: { resaleCreditConfirmed: true } });
    assert.equal(result.create[0].treatment, "USO_CONSUMO");
  });
});
