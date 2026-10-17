import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { detectC176C179Evidence } from "./conditionalEvidence";
import { CUSTOMER_CPF, fixtureKey, nfeXml, OWN_CNPJ, SUPPLIER_CNPJ } from "./fixtures.test-helpers";

const doc = (xml: string, extra: { ownIssued?: boolean; status?: string } = {}) => ({
  key: /Id="NFe(\d{44})"/.exec(xml)?.[1] ?? "",
  xml,
  ownIssued: extra.ownIssued ?? true,
  status: extra.status ?? "AUTORIZADA",
});

describe("indício de C176/C179", () => {
  it("venda interestadual tributada normalmente não é indício", () => {
    const xml = nfeXml({ key: fixtureKey(1), recipient: { cnpj: SUPPLIER_CNPJ, uf: "PE" }, items: [{ cfop: "6102" }] });
    assert.equal(detectC176C179Evidence([doc(xml)]).hasC176C179Evidence, false);
  });

  it("venda interna de mercadoria com ST retida não é indício", () => {
    const xml = nfeXml({ key: fixtureKey(2), recipient: { cpf: CUSTOMER_CPF, uf: "PB" }, items: [{ cfop: "5405", cst: "60", vICMSSTRet: 5 }] });
    assert.equal(detectC176C179Evidence([doc(xml)]).hasC176C179Evidence, false);
  });

  it("saída interestadual de mercadoria com ST retida é indício", () => {
    const xml = nfeXml({ key: fixtureKey(3), recipient: { cnpj: SUPPLIER_CNPJ, uf: "PE" }, items: [{ cfop: "6404", cst: "60", vICMSSTRet: 5 }] });
    const evidence = detectC176C179Evidence([doc(xml)]);
    assert.equal(evidence.hasC176C179Evidence, true);
    assert.deepEqual(evidence.c176C179DocumentKeys, [fixtureKey(3)]);
  });

  it("devolução ao fornecedor de mercadoria com ST é indício", () => {
    const xml = nfeXml({ key: fixtureKey(4), finNFe: "4", items: [{ cfop: "5411", cst: "60" }] });
    assert.equal(detectC176C179Evidence([doc(xml)]).hasC176C179Evidence, true);
  });

  it("compra com ST destacada pelo fornecedor não é indício", () => {
    const xml = nfeXml({ key: fixtureKey(5), emitter: { cnpj: SUPPLIER_CNPJ, uf: "PE" }, recipient: { cnpj: OWN_CNPJ, uf: "PB" }, items: [{ cfop: "6403", cst: "60", vICMSSTRet: 5 }] });
    assert.equal(detectC176C179Evidence([doc(xml, { ownIssued: false })]).hasC176C179Evidence, false);
  });

  it("documento cancelado não gera indício", () => {
    const xml = nfeXml({ key: fixtureKey(6), recipient: { cnpj: SUPPLIER_CNPJ, uf: "PE" }, items: [{ cfop: "6404", cst: "60" }] });
    assert.equal(detectC176C179Evidence([doc(xml, { status: "CANCELADA" })]).hasC176C179Evidence, false);
  });
});
