import assert from "node:assert/strict";
import test from "node:test";

import { projectFiscalDocument, type SpedItemAssignment } from "./documentProjection";

const KEY = "1".repeat(44);

function xml(options: { recipientCnpj?: string; emission?: string; stWithFcp?: boolean } = {}) {
  const recipientCnpj = options.recipientCnpj ?? "00000000E08G12";
  const emission = options.emission ?? "2026-08-01T00:15:00-03:00";
  const icms = options.stWithFcp
    ? "<ICMS10><orig>0</orig><CST>10</CST><vBC>100.00</vBC><pICMS>18.00</pICMS><vICMS>18.00</vICMS><vBCST>100.00</vBCST><pICMSST>10.00</pICMSST><vICMSST>10.00</vICMSST><vBCFCPST>100.00</vBCFCPST><pFCPST>2.00</pFCPST><vFCPST>2.00</vFCPST></ICMS10>"
    : "<ICMS00><orig>0</orig><CST>00</CST><vBC>100.00</vBC><pICMS>18.00</pICMS><vICMS>18.00</vICMS></ICMS00>";
  const stTotals = options.stWithFcp
    ? "<vBCST>100.00</vBCST><vST>10.00</vST><vFCPST>2.00</vFCPST>"
    : "<vBCST>0</vBCST><vST>0</vST>";
  const invoiceTotal = options.stWithFcp ? "112.00" : "100.00";
  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc>
  <NFe><infNFe Id="NFe${KEY}">
    <ide><natOp>VENDA</natOp><mod>55</mod><serie>1</serie><nNF>10</nNF><dhEmi>${emission}</dhEmi><dhSaiEnt>${emission}</dhSaiEnt><tpNF>1</tpNF><tpAmb>1</tpAmb><indPag>0</indPag></ide>
    <emit><CNPJ>04252011000110</CNPJ><xNome>Emitente</xNome><IE>123</IE><enderEmit><xLgr>Rua A</xLgr><nro>1</nro><xBairro>Centro</xBairro><cMun>2507507</cMun><xMun>João Pessoa</xMun><UF>PB</UF><cPais>1058</cPais></enderEmit></emit>
    <dest><CNPJ>${recipientCnpj}</CNPJ><xNome>Destinatário Alfa</xNome><IE>ISENTO</IE><enderDest><xLgr>Rua B</xLgr><nro>2</nro><xBairro>Centro</xBairro><cMun>2507507</cMun><xMun>João Pessoa</xMun><UF>PB</UF><cPais>1058</cPais></enderDest></dest>
    <det nItem="1"><prod><cProd>XML-1</cProd><cEAN>SEM GTIN</cEAN><xProd>Produto</xProd><NCM>87089990</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>2.000</qCom><vUnCom>50.00</vUnCom><vProd>100.00</vProd></prod><imposto><ICMS>${icms}</ICMS><PIS><PISAliq><CST>01</CST><vBC>100.00</vBC><pPIS>1.65</pPIS><vPIS>1.65</vPIS></PISAliq></PIS><COFINS><COFINSAliq><CST>01</CST><vBC>100.00</vBC><pCOFINS>7.60</pCOFINS><vCOFINS>7.60</vCOFINS></COFINSAliq></COFINS></imposto></det>
    <total><ICMSTot><vBC>100.00</vBC><vICMS>18.00</vICMS>${stTotals}<vProd>100.00</vProd><vFrete>0</vFrete><vSeg>0</vSeg><vDesc>0</vDesc><vIPI>0</vIPI><vPIS>1.65</vPIS><vCOFINS>7.60</vCOFINS><vOutro>0</vOutro><vNF>${invoiceTotal}</vNF></ICMSTot></total>
    <transp><modFrete>9</modFrete></transp>
  </infNFe></NFe>
  <protNFe><infProt><chNFe>${KEY}</chNFe><cStat>100</cStat></infProt></protNFe>
</nfeProc>`;
}

const assignment: SpedItemAssignment = {
  code: "ITEM-1",
  productId: 10,
  itemConfigId: 20,
  itemType: "00",
};

test("projeta CNPJ alfanumérico e preserva data civil e offset do XML", () => {
  const result = projectFiscalDocument({
    sourceType: "NFE_EMITIDA",
    sourceTable: "nfe",
    sourceId: 1,
    operation: "SAIDA",
    status: "AUTORIZADA",
    xml: xml(),
    xmlSha256: "a".repeat(64),
    itemAssignments: new Map([[1, assignment]]),
  });

  assert.equal(result.participantDocumentCanonical, "00000000E08G12");
  assert.equal(result.emissionDate.civilDate, "2026-08-01");
  assert.equal(result.emissionDate.originalOffset, "-03:00");
  assert.equal(result.blockCRecords[0].code, "C100");
  assert.equal(result.blockCRecords.some((record) => record.code === "C170"), false);
  assert.equal(result.blockCRecords.some((record) => record.code === "C190"), true);
  assert.equal(result.diagnostics.length, 0);
});

test("documento cancelado gera somente C100 mínimo e nenhum item", () => {
  const result = projectFiscalDocument({
    sourceType: "NFE_EMITIDA",
    sourceTable: "nfe",
    sourceId: 2,
    operation: "SAIDA",
    status: "CANCELADA",
    xml: xml(),
    xmlSha256: "b".repeat(64),
    itemAssignments: new Map([[1, assignment]]),
  });

  assert.deepEqual(result.blockCRecords.map((record) => record.code), ["C100"]);
  assert.equal(result.items.length, 0);
  assert.equal(result.blockCRecords[0].values.VL_DOC, undefined);
});

test("entrada sem configuração canônica nem decisão de crédito fica bloqueada", () => {
  const result = projectFiscalDocument({
    sourceType: "NFE_RECEBIDA",
    sourceTable: "entrada",
    sourceId: 3,
    operation: "ENTRADA",
    status: "AUTORIZADA",
    xml: xml(),
    xmlSha256: "c".repeat(64),
    bookkeepingDate: "2026-08-02",
  });

  assert.equal(result.blockCRecords.some((record) => record.code === "C170"), true);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "CODIGO_ITEM_CANONICO_AUSENTE"));
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "TRATAMENTO_CREDITO_PENDENTE"));
});

test("rejeita participante com CNPJ inválido antes de persistir o snapshot", () => {
  assert.throws(() => projectFiscalDocument({
    sourceType: "NFE_EMITIDA",
    sourceTable: "nfe",
    sourceId: 4,
    operation: "SAIDA",
    status: "AUTORIZADA",
    xml: xml({ recipientCnpj: "00000000E08G99" }),
    xmlSha256: "d".repeat(64),
    itemAssignments: new Map([[1, assignment]]),
  }), /CNPJ inválido/);
});

test("C190 inclui FCP-ST no valor da operação e no ICMS-ST e detalha C191", () => {
  const result = projectFiscalDocument({
    sourceType: "NFE_EMITIDA",
    sourceTable: "nfe",
    sourceId: 5,
    operation: "SAIDA",
    status: "AUTORIZADA",
    xml: xml({ stWithFcp: true }),
    xmlSha256: "e".repeat(64),
    itemAssignments: new Map([[1, assignment]]),
  });

  const c190 = result.blockCRecords.find((record) => record.code === "C190");
  const c191 = result.blockCRecords.find((record) => record.code === "C191");
  assert.equal(c190?.values.CST_ICMS, "010");
  assert.equal(c190?.values.VL_OPR, 112);
  assert.equal(c190?.values.VL_ICMS_ST, 12);
  assert.equal(c191?.values.VL_FCP_ST, 2);
  assert.equal(result.diagnostics.some((diagnostic) => diagnostic.code === "C190_COMPONENTE_SEM_ALOCACAO"), false);
});

test("bloqueia C190 quando o total traz FCP-ST sem alocação por item", () => {
  const xmlWithoutItemFcp = xml({ stWithFcp: true }).replace("<vFCPST>2.00</vFCPST>", "");
  const result = projectFiscalDocument({
    sourceType: "NFE_EMITIDA",
    sourceTable: "nfe",
    sourceId: 6,
    operation: "SAIDA",
    status: "AUTORIZADA",
    xml: xmlWithoutItemFcp,
    xmlSha256: "f".repeat(64),
    itemAssignments: new Map([[1, assignment]]),
  });

  assert.ok(result.diagnostics.some((diagnostic) => (
    diagnostic.code === "C190_COMPONENTE_SEM_ALOCACAO"
    && diagnostic.context?.field === "vFCPST"
  )));
});
