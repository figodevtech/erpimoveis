import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { gerarChaveAcesso } from "./chaveAcesso";
import { renumerarNFeXml } from "./renumerarNFeXml";

const BASE = {
  cUF: "25",
  ano: 2026,
  mes: 7,
  cnpj: "12345678000123",
  mod: "55",
  serie: 3,
  tpEmis: 1,
  cNF: "00000001",
};

function xmlComNumero(numero: number) {
  const { chave, dv } = gerarChaveAcesso({ ...BASE, nNF: numero });
  return {
    chave,
    xml:
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<NFe xmlns="http://www.portalfiscal.inf.br/nfe">' +
      `<infNFe Id="NFe${chave}" versao="4.00">` +
      `<ide><cUF>25</cUF><cNF>${BASE.cNF}</cNF><natOp>VENDA</natOp><mod>55</mod>` +
      `<serie>${BASE.serie}</serie><nNF>${numero}</nNF><cDV>${dv}</cDV><tpAmb>2</tpAmb>` +
      "<NFref><refNF><nNF>999</nNF></refNF></NFref></ide>" +
      "<det nItem=\"1\"><prod><vProd>10.00</vProd></prod></det>" +
      "</infNFe></NFe>",
  };
}

describe("renumerarNFeXml", () => {
  it("gera a mesma chave que montar o XML já com o número definitivo", () => {
    const provisorio = xmlComNumero(41);
    const definitivo = xmlComNumero(57);

    const resultado = renumerarNFeXml(provisorio.xml, 57);

    assert.equal(resultado.chave, definitivo.chave);
    assert.equal(resultado.id, `NFe${definitivo.chave}`);
    assert.match(resultado.xml, /<infNFe Id="NFe\d{44}"/);
    assert.ok(resultado.xml.includes(`Id="NFe${definitivo.chave}"`));
  });

  it("troca nNF e cDV do <ide> sem tocar no nNF de nota referenciada", () => {
    const { xml } = xmlComNumero(41);
    const resultado = renumerarNFeXml(xml, 57);

    assert.match(resultado.xml, /<serie>3<\/serie><nNF>57<\/nNF>/);
    assert.match(resultado.xml, /<refNF><nNF>999<\/nNF><\/refNF>/);
    // O DV acompanha a chave nova.
    const dvNaChave = resultado.chave.slice(-1);
    assert.match(resultado.xml, new RegExp(`<cDV>${dvNaChave}</cDV>`));
  });

  it("preserva cNF, série e emitente ao renumerar", () => {
    const { xml } = xmlComNumero(41);
    const resultado = renumerarNFeXml(xml, 1);

    assert.equal(resultado.chave.slice(0, 25), xml.match(/Id="NFe(\d{44})"/)![1].slice(0, 25));
    assert.equal(resultado.chave.slice(25, 34), "000000001");
    assert.equal(resultado.chave.slice(34, 43), `1${BASE.cNF}`);
  });

  it("recusa XML sem chave de acesso", () => {
    assert.throws(() => renumerarNFeXml("<NFe><infNFe versao=\"4.00\"></infNFe></NFe>", 10), /chave de acesso/i);
  });
});
