import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDanfeNFeXml } from "./danfeParser";

const KEY = "25260712345678000123550030000000051000000010";

function xmlWith(body: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
  <nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
    <NFe><infNFe Id="NFe${KEY}" versao="4.00">${body}</infNFe></NFe>
    <protNFe><infProt><tpAmb>1</tpAmb><chNFe>${KEY}</chNFe><dhRecbto>2026-07-19T16:49:03-03:00</dhRecbto><nProt>325260000000001</nProt><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>
  </nfeProc>`;
}

const common = `
  <ide><natOp>VENDA DE MERCADORIA</natOp><serie>3</serie><nNF>5</nNF><dhEmi>2026-07-19T16:48:00-03:00</dhEmi><tpNF>1</tpNF><idDest>1</idDest><tpEmis>1</tpEmis><tpAmb>1</tpAmb></ide>
  <emit><CNPJ>12345678000123</CNPJ><xNome>OFICINA TESTE</xNome><enderEmit><xLgr>RUA A</xLgr><nro>10</nro><xMun>JOAO PESSOA</xMun><UF>PB</UF></enderEmit><IE>160000000</IE></emit>
  <dest><CPF>12345678901</CPF><xNome>CLIENTE TESTE</xNome><enderDest><xLgr>RUA B</xLgr><nro>20</nro><xMun>CABEDELO</xMun><UF>PB</UF></enderDest></dest>`;

describe("parseDanfeNFeXml", () => {
  it("preserva alíquotas efetivas zero, IS, monofasia e os dois totais sem recalcular XML", () => {
    const parsed = parseDanfeNFeXml(xmlWith(`${common.replace("</emit>", "<CRT>3</CRT></emit>")}
      <det nItem="1"><prod><cProd>1</cProd><xProd>ITEM RTC</xProd></prod><imposto>
      <IBSCBS><CST>200</CST><cClassTrib>200001</cClassTrib><gIBSCBS><vBC>100</vBC>
        <gIBSUF><pIBSUF>0.10</pIBSUF><gRed><pRedAliq>100</pRedAliq><pAliqEfet>0.00</pAliqEfet></gRed><vIBSUF>0</vIBSUF></gIBSUF>
        <gIBSMun><pIBSMun>0.10</pIBSMun><gRed><pAliqEfet>0.04</pAliqEfet></gRed><vIBSMun>0.04</vIBSMun></gIBSMun>
        <gCBS><pCBS>0.90</pCBS><gRed><pAliqEfet>0.36</pAliqEfet></gRed><vCBS>0.36</vCBS></gCBS></gIBSCBS></IBSCBS>
      <IS><CSTIS>000</CSTIS><vBCIS>100</vBCIS><pIS>2.00</pIS><vIS>2.00</vIS></IS></imposto></det>
      <total><ICMSTot><vNF>100</vNF></ICMSTot><IBSCBSTot><gMono><vIBSMono>0</vIBSMono><vCBSMono>3</vCBSMono><vIBSMonoReten>2</vIBSMonoReten><vCBSMonoReten>4</vCBSMonoReten></gMono></IBSCBSTot><vNFTot>110</vNFTot></total>`));
    assert.equal(parsed.emitente.crt, "3");
    assert.equal(parsed.itens[0].aliquota_ibs_uf, 0.1);
    assert.equal(parsed.itens[0].aliquota_ibs_uf_efetiva, 0);
    assert.equal(parsed.itens[0].aliquota_ibs_municipio_efetiva, 0.04);
    assert.equal(parsed.itens[0].aliquota_cbs_efetiva, 0.36);
    assert.equal(parsed.itens[0].base_is, 100);
    assert.equal(parsed.itens[0].aliquota_is, 2);
    assert.equal(parsed.totais.vIBSMono, 0);
    assert.equal(parsed.totais.vCBSMono, 3);
    assert.equal(parsed.totais.vIBSMonoReten, 2);
    assert.equal(parsed.totais.vCBSMonoReten, 4);
    assert.equal(parsed.totais.vNF, 100);
    assert.equal(parsed.totais.vNFTot, 110);
  });

  it("não inventa campos opcionais ausentes em documentos históricos", () => {
    const parsed = parseDanfeNFeXml(xmlWith(common));
    assert.equal(parsed.totais.vNFTot, undefined);
    assert.equal(parsed.totais.vIBSMono, undefined);
    assert.equal(parsed.totais.possuiGrupoRtc, false);
  });
  it("lê a NF-e referenciada do ide, preservando a chave do caso real", () => {
    const chave = "29260815851413000157550010004179631007316491";
    const xml = xmlWith(common.replace("</ide>", `<NFref><refNFe>${chave}</refNFe></NFref></ide>`) +
      `<infAdic><NFref><refNFe>${KEY}</refNFe></NFref></infAdic>`);
    assert.deepEqual(parseDanfeNFeXml(xml).documentosReferenciados, [{ tipo: "NFE", chave }]);
  });

  it("retorna várias referências na ordem do ide e preserva outros tipos", () => {
    const primeira = "29260815851413000157550010004179631007316491";
    const segunda = "25260912260723000109550030000001461336645454";
    const ideComReferencias = common.replace("</ide>",
      `<NFref><refNFe>${primeira}</refNFe></NFref>` +
      `<NFref><refNF><cUF>25</cUF><AAMM>2609</AAMM><CNPJ>12260723000109</CNPJ><mod>01</mod><serie>3</serie><nNF>146</nNF></refNF></NFref>` +
      `<NFref><refNFe>${segunda}</refNFe></NFref></ide>`);
    assert.deepEqual(parseDanfeNFeXml(xmlWith(ideComReferencias)).documentosReferenciados, [
      { tipo: "NFE", chave: primeira },
      { tipo: "NF_MODELO_1", campos: { cUF: "25", AAMM: "2609", CNPJ: "12260723000109", mod: "01", serie: "3", nNF: "146" } },
      { tipo: "NFE", chave: segunda },
    ]);
  });

  it("retorna array vazio quando o ide não tem NFref", () => {
    assert.deepEqual(parseDanfeNFeXml(xmlWith(common)).documentosReferenciados, []);
  });

  it("preserva base de ICMS zero no CSOSN 102 e lê o protocolo autorizado", () => {
    const parsed = parseDanfeNFeXml(xmlWith(`${common}
      <det nItem="1"><prod><cProd>1</cProd><xProd>ARRUELA</xProd><NCM>73182200</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>1.0000</qCom><vUnCom>0.10</vUnCom><vProd>0.10</vProd></prod><imposto><ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS><PIS><PISOutr><CST>49</CST><vBC>0.10</vBC><pPIS>0.00</pPIS><vPIS>0.00</vPIS></PISOutr><COFINS><COFINSOutr><CST>49</CST><vBC>0.10</vBC><pCOFINS>0.00</pCOFINS><vCOFINS>0.00</vCOFINS></COFINSOutr></COFINS></imposto></det>
      <total><ICMSTot><vBC>0.00</vBC><vICMS>0.00</vICMS><vProd>0.10</vProd><vNF>0.10</vNF></ICMSTot></total><transp><modFrete>9</modFrete></transp>`));
    assert.equal(parsed.itens[0].valor_bc_icms, 0);
    assert.equal(parsed.itens[0].valor_total, 0.1);
    assert.equal(parsed.itens[0].origem, "0");
    assert.equal(parsed.itens[0].csosn, "102");
    assert.equal(parsed.protocolo.cStat, "100");
    assert.equal(parsed.protocolo.numero, "325260000000001");
    assert.equal(parsed.chave, KEY);
  });

  it("lê totais, transportador, volumes, cobrança e pagamento", () => {
    const parsed = parseDanfeNFeXml(xmlWith(`${common}
      <det nItem="1"><prod><cProd>P1</cProd><xProd>PECA</xProd><NCM>87089990</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>2</qCom><vUnCom>50</vUnCom><vProd>100</vProd></prod><imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>100</vBC><pICMS>18</pICMS><vICMS>18</vICMS></ICMS00></ICMS><IPI><cEnq>999</cEnq><IPITrib><CST>50</CST><vBC>100</vBC><pIPI>5</pIPI><vIPI>5</vIPI></IPITrib></IPI></imposto></det>
      <total><ICMSTot><vBC>100</vBC><vICMS>18</vICMS><vBCST>20</vBCST><vST>3.60</vST><vProd>100</vProd><vFrete>10</vFrete><vSeg>2</vSeg><vDesc>1</vDesc><vII>0</vII><vIPI>5</vIPI><vPIS>1.65</vPIS><vCOFINS>7.60</vCOFINS><vOutro>3</vOutro><vNF>119</vNF></ICMSTot></total>
      <transp><modFrete>0</modFrete><transporta><CNPJ>98765432000199</CNPJ><xNome>TRANSPORTADORA</xNome><IE>123</IE><xEnder>RUA C</xEnder><xMun>RECIFE</xMun><UF>PE</UF></transporta><veicTransp><placa>ABC1D23</placa><UF>PE</UF><RNTC>77</RNTC></veicTransp><vol><qVol>2</qVol><esp>CAIXA</esp><pesoL>4.5</pesoL><pesoB>5</pesoB></vol></transp>
      <cobr><fat><nFat>5</nFat><vOrig>119</vOrig><vDesc>0</vDesc><vLiq>119</vLiq></fat><dup><nDup>1</nDup><dVenc>2026-08-19</dVenc><vDup>119</vDup></dup></cobr>
      <pag><detPag><tPag>17</tPag><vPag>119</vPag></detPag></pag>`));
    assert.equal(parsed.totais.vBCST, 20);
    assert.equal(parsed.totais.vFrete, 10);
    assert.equal(parsed.itens[0].valor_ipi, 5);
    assert.equal(parsed.transporte.nome, "TRANSPORTADORA");
    assert.equal(parsed.transporte.volumes[0].pesoLiquido, 4.5);
    assert.equal(parsed.duplicatas[0].valor, 119);
    assert.equal(parsed.pagamentos[0].tipo, "17");
  });

  it("lê os grupos e totais da reforma tributária", () => {
    const parsed = parseDanfeNFeXml(xmlWith(`${common}
      <det nItem="1"><prod><cProd>1</cProd><xProd>ITEM RTC</xProd><NCM>87089990</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>1</qCom><vUnCom>100</vUnCom><vProd>100</vProd></prod><imposto><ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS><IBSCBS><CST>000</CST><cClassTrib>000001</cClassTrib><gIBSCBS><vBC>100</vBC><gIBSUF><pIBSUF>0.10</pIBSUF><vIBSUF>0.10</vIBSUF></gIBSUF><gIBSMun><pIBSMun>0.00</pIBSMun><vIBSMun>0.00</vIBSMun></gIBSMun><vIBS>0.10</vIBS><gCBS><pCBS>0.90</pCBS><vCBS>0.90</vCBS></gCBS></gIBSCBS></IBSCBS><IS><CSTIS>000</CSTIS><vIS>2.00</vIS></IS></imposto></det>
      <total><ICMSTot><vBC>0</vBC><vICMS>0</vICMS><vProd>100</vProd><vNF>103</vNF></ICMSTot><ISTot><vIS>2</vIS></ISTot><IBSCBSTot><vBCIBSCBS>100</vBCIBSCBS><gIBS><gIBSUF><vIBSUF>0.10</vIBSUF></gIBSUF><gIBSMun><vIBSMun>0</vIBSMun></gIBSMun><vIBS>0.10</vIBS></gIBS><gCBS><vCBS>0.90</vCBS></gCBS></IBSCBSTot></total><transp><modFrete>9</modFrete></transp>`));
    assert.equal(parsed.itens[0].classificacao_tributaria, "000001");
    assert.equal(parsed.itens[0].valor_ibs, 0.1);
    assert.equal(parsed.totais.vBCIBSCBS, 100);
    assert.equal(parsed.totais.vCBS, 0.9);
    assert.equal(parsed.totais.vIS, 2);
  });
});
