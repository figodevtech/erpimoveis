// Leitura dos itens da NF-e recebida, que é o que permite a devolução espelhar
// a operação de entrada em vez de classificar pelo cadastro do produto.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { extrairItemFiscalNfe, extrairItensFiscaisNfe } from "./dfeXmlParser";

/**
 * Compra de duas peças: a primeira com ICMS retido por substituição tributária
 * (é o caso que decide entre devolver com CFOP 5202 ou 5411), a segunda com
 * tributação normal do Simples.
 */
const xmlEntrada = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe>
    <infNFe Id="NFe25260808263965000189550010000001231000001234" versao="4.00">
      <ide><cUF>25</cUF><natOp>VENDA</natOp><mod>55</mod><nNF>123</nNF></ide>
      <det nItem="1">
        <prod>
          <cProd>SWP335</cProd><xProd>BOMBA DAGUA NEWDISCOVERY</xProd>
          <NCM>84133090</NCM><CEST>0100100</CEST><CFOP>5405</CFOP>
          <uCom>UN</uCom><qCom>1.0000</qCom><vUnCom>3850.0000000000</vUnCom>
        </prod>
        <imposto>
          <ICMS><ICMSSN500>
            <orig>0</orig><CSOSN>500</CSOSN>
            <vBCSTRet>4200.00</vBCSTRet><pST>18.00</pST><vICMSSTRet>756.00</vICMSSTRet>
          </ICMSSN500></ICMS>
          <PIS><PISNT><CST>07</CST></PISNT></PIS>
          <COFINS><COFINSNT><CST>07</CST></COFINSNT></COFINS>
        </imposto>
      </det>
      <det nItem="2">
        <prod>
          <cProd>6PK2210</cProd><xProd>CORREIA POLY-V</xProd>
          <NCM>40103100</NCM><CFOP>5102</CFOP>
          <uCom>UN</uCom><qCom>2.0000</qCom><vUnCom>95.0000000000</vUnCom>
        </prod>
        <imposto>
          <ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS>
          <PIS><PISAliq><CST>01</CST><vBC>190.00</vBC><pPIS>1.65</pPIS><vPIS>3.14</vPIS></PISAliq></PIS>
          <COFINS><COFINSAliq><CST>01</CST><vBC>190.00</vBC><pCOFINS>7.60</pCOFINS><vCOFINS>14.44</vCOFINS></COFINSAliq></COFINS>
        </imposto>
      </det>
    </infNFe>
  </NFe>
</nfeProc>`;

describe("itens fiscais da NF-e de origem", () => {
  it("lê o item de ST com o CSOSN e as retenções que a devolução precisa repetir", () => {
    const item = extrairItemFiscalNfe(xmlEntrada, 1);

    assert.ok(item);
    assert.equal(item.descricao, "BOMBA DAGUA NEWDISCOVERY");
    assert.equal(item.ncm, "84133090");
    assert.equal(item.valorUnitario, 3850);
    assert.equal(item.valoresFiscais.cfop, "5405");
    assert.equal(item.valoresFiscais.csosn, "500");
    assert.equal(item.valoresFiscais.origem_mercadoria, "0");
    assert.equal(item.valoresFiscais.cst_pis, "07");
    assert.equal(item.valoresFiscais.aliquota_pis, null);
    assert.deepEqual(item.substituicaoTributaria, {
      vBCSTRet: 4200,
      pST: 18,
      vICMSSTRet: 756,
      vICMSSubstituto: null,
      vBCFCPSTRet: null,
      pFCPSTRet: null,
      vFCPSTRet: null,
    });
  });

  it("lê alíquotas de PIS/COFINS quando o item é tributado", () => {
    const item = extrairItemFiscalNfe(xmlEntrada, 2);

    assert.ok(item);
    assert.equal(item.valoresFiscais.csosn, "102");
    assert.equal(item.valoresFiscais.cst_pis, "01");
    assert.equal(item.valoresFiscais.aliquota_pis, 1.65);
    assert.equal(item.valoresFiscais.cst_cofins, "01");
    assert.equal(item.valoresFiscais.aliquota_cofins, 7.6);
    assert.equal(item.substituicaoTributaria.vICMSSTRet, null);
  });

  it("devolve os dois itens na ordem do documento", () => {
    assert.deepEqual(extrairItensFiscaisNfe(xmlEntrada).map((item) => item.nItem), [1, 2]);
  });

  it("devolve nulo para item que não existe no documento", () => {
    assert.equal(extrairItemFiscalNfe(xmlEntrada, 9), null);
    assert.equal(extrairItemFiscalNfe(xmlEntrada, 0), null);
  });

  it("não quebra com XML que não é NF-e completa", () => {
    assert.deepEqual(extrairItensFiscaisNfe("<resNFe><chNFe>123</chNFe></resNFe>"), []);
    assert.deepEqual(extrairItensFiscaisNfe("não é xml"), []);
  });
});
