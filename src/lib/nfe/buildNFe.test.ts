import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildNFePreviewXml } from "./buildNFe";
import type { EmpresaRow, NFeDestinatario, NFeItem } from "./types";

const empresa: EmpresaRow = {
  id: 1,
  cnpj: "12345678000199",
  razaosocial: "EMPRESA TESTE",
  nomefantasia: null,
  inscricaoestadual: "123456789",
  inscricaomunicipal: null,
  endereco: "RUA TESTE",
  codigomunicipio: "3550308",
  regimetributario: 1,
  certificadocaminho: null,
  cschomologacao: null,
  cscproducao: null,
  ambiente: "HOMOLOGACAO",
  createdat: null,
  updatedat: null,
  bairro: "CENTRO",
  numero: "1",
  complemento: null,
  cep: "01001000",
  uf: "SP",
  codigopais: "1058",
  nomepais: "BRASIL",
  telefone: null,
  cnae: null,
  inscricaoestadualst: null,
  certificadosenha: null,
};

const item: NFeItem = {
  numeroItem: 1,
  codigoProduto: "1",
  descricao: "PRODUTO TESTE",
  ncm: "87089990",
  cfop: "5102",
  unidade: "UN",
  quantidade: 1,
  valorUnitario: 10,
  valorTotal: 10,
  orig: "0",
  csosn: "102",
  pis: { cst: "07", modo: "NAO_TRIBUTADO" },
  cofins: { cst: "07", modo: "NAO_TRIBUTADO" },
};

function destinatario(uf: string): NFeDestinatario {
  return {
    cpf: "12345678909",
    razaoSocial: "CLIENTE TESTE",
    indIEDest: "9",
    endereco: {
      logradouro: "RUA CLIENTE",
      numero: "2",
      bairro: "CENTRO",
      codigoMunicipio: uf === "SP" ? "3550308" : "3106200",
      nomeMunicipio: uf === "SP" ? "SAO PAULO" : "BELO HORIZONTE",
      uf,
      cep: "01001000",
      codigoPais: "1058",
      nomePais: "BRASIL",
    },
  };
}

describe("destino da operação na NF-e", () => {
  it("marca operação interna quando emitente e destinatário estão na mesma UF", () => {
    const result = buildNFePreviewXml(empresa, 1, 1, [item], destinatario("SP"), {
      nomeMunicipioEmitente: "SAO PAULO",
    });
    assert.match(result.xml, /<idDest>1<\/idDest>/);
  });

  it("marca operação interestadual quando a UF do destinatário é diferente", () => {
    const result = buildNFePreviewXml(
      empresa,
      2,
      1,
      [{ ...item, cfop: "6102" }],
      destinatario("MG"),
      { nomeMunicipioEmitente: "SAO PAULO" },
    );
    assert.match(result.xml, /<idDest>2<\/idDest>/);
  });
});

describe("DIFAL (ICMSUFDest)", () => {
  // Reproduz a NF 30: regime normal, SP -> MG, consumidor final nao
  // contribuinte, CST 60, R$ 2.000.
  const empresaRegimeNormal: EmpresaRow = { ...empresa, regimetributario: 3 };
  const itemDifal: NFeItem = {
    ...item,
    cfop: "6102",
    cst: "60",
    cstIcms: "60",
    csosn: null,
    valorUnitario: 2000,
    valorTotal: 2000,
  };

  it("gera o grupo na venda interestadual a consumidor final não contribuinte", () => {
    const { xml } = buildNFePreviewXml(empresaRegimeNormal, 3, 1, [itemDifal], destinatario("MG"), {
      nomeMunicipioEmitente: "SAO PAULO",
    });

    assert.match(xml, /<ICMSUFDest>/);
    // SP -> MG e Sul/Sudeste para Sudeste: 12%. Interna de MG: 18%.
    assert.match(xml, /<pICMSInter>12\.00<\/pICMSInter>/);
    assert.match(xml, /<pICMSUFDest>18\.00<\/pICMSUFDest>/);
    assert.match(xml, /<vICMSUFDest>120\.00<\/vICMSUFDest>/);
    assert.match(xml, /<pICMSInterPart>100\.00<\/pICMSInterPart>/);
  });

  it("posiciona o grupo entre COFINS e os grupos da reforma tributária", () => {
    const { xml } = buildNFePreviewXml(
      empresaRegimeNormal,
      4,
      1,
      [{
        ...itemDifal,
        rtc: {
          cstIbsCbs: "000",
          cClassTrib: "000001",
          baseCalculo: 2000,
          ibsUf: { aliquota: 0.1, valor: 2 },
          ibsMunicipio: { aliquota: 0, valor: 0 },
          valorIbs: 2,
          cbs: { aliquota: 0.9, valor: 18 },
          versaoClassificacao: "1.00",
          validadoEm: new Date().toISOString(),
        },
      }],
      destinatario("MG"),
      { nomeMunicipioEmitente: "SAO PAULO" },
    );

    // Sequência do PL_010: ... COFINS, COFINSST, ICMSUFDest, IS, IBSCBS.
    // Emitir ICMSUFDest depois de IBSCBS gera rejeição 225 (falha no schema).
    assert.match(xml, /<\/COFINS>[\s\S]*<ICMSUFDest>/);
    assert.match(xml, /<\/ICMSUFDest>[\s\S]*<IBSCBS>/);
    assert.doesNotMatch(xml, /<\/IBSCBS>[\s\S]*<ICMSUFDest>/);
    // Nunca aninhado dentro do grupo ICMS.
    assert.doesNotMatch(xml, /<ICMS>(?:(?!<\/ICMS>)[\s\S])*<ICMSUFDest>/);
  });

  it("soma os totais no ICMSTot entre vICMSDeson e vFCP", () => {
    const { xml } = buildNFePreviewXml(empresaRegimeNormal, 5, 1, [itemDifal, itemDifal], destinatario("MG"), {
      nomeMunicipioEmitente: "SAO PAULO",
    });

    assert.match(
      xml,
      /<vICMSDeson>0\.00<\/vICMSDeson><vFCPUFDest>0\.00<\/vFCPUFDest><vICMSUFDest>240\.00<\/vICMSUFDest><vICMSUFRemet>0\.00<\/vICMSUFRemet><vFCP>/,
    );
  });

  it("emite IBSCBSTot com todos os filhos exigidos por TIBSCBSMonoTot", () => {
    const { xml } = buildNFePreviewXml(
      empresaRegimeNormal,
      9,
      1,
      [{
        ...itemDifal,
        rtc: {
          cstIbsCbs: "000",
          cClassTrib: "000001",
          baseCalculo: 2000,
          ibsUf: { aliquota: 0.1, valor: 2 },
          ibsMunicipio: { aliquota: 0, valor: 0 },
          valorIbs: 2,
          cbs: { aliquota: 0.9, valor: 18 },
          versaoClassificacao: "1.00",
          validadoEm: new Date().toISOString(),
        },
      }],
      destinatario("MG"),
      { nomeMunicipioEmitente: "SAO PAULO" },
    );

    // gIBS = gIBSUF, gIBSMun, vIBS, vCredPres, vCredPresCondSus.
    // Faltar vCredPres/vCredPresCondSus gera rejeição 225 em IBSCBSTot/gIBS.
    assert.match(
      xml,
      /<gIBS><gIBSUF>[\s\S]*<\/gIBSUF><gIBSMun>[\s\S]*<\/gIBSMun><vIBS>[\d.]+<\/vIBS><vCredPres>0\.00<\/vCredPres><vCredPresCondSus>0\.00<\/vCredPresCondSus><\/gIBS>/,
    );
    // gCBS = vDif, vDevTrib, vCBS, vCredPres, vCredPresCondSus.
    assert.match(
      xml,
      /<gCBS><vDif>0\.00<\/vDif><vDevTrib>0\.00<\/vDevTrib><vCBS>[\d.]+<\/vCBS><vCredPres>0\.00<\/vCredPres><vCredPresCondSus>0\.00<\/vCredPresCondSus><\/gCBS>/,
    );
  });

  it("não soma o DIFAL ao vNF", () => {
    const { xml } = buildNFePreviewXml(empresaRegimeNormal, 6, 1, [itemDifal], destinatario("MG"), {
      nomeMunicipioEmitente: "SAO PAULO",
    });

    assert.match(xml, /<vProd>2000\.00<\/vProd>/);
    assert.match(xml, /<vNF>2000\.00<\/vNF>/);
  });

  it("não gera o grupo em operação interna", () => {
    const { xml } = buildNFePreviewXml(empresaRegimeNormal, 7, 1, [{ ...itemDifal, cfop: "5102" }], destinatario("SP"), {
      nomeMunicipioEmitente: "SAO PAULO",
    });

    assert.doesNotMatch(xml, /<ICMSUFDest>/);
    assert.doesNotMatch(xml, /<vICMSUFDest>/);
  });

  it("não gera o grupo quando o destinatário é contribuinte", () => {
    const contribuinte: NFeDestinatario = {
      ...destinatario("MG"),
      indIEDest: "1",
      inscricaoEstadual: "1234567890",
    };
    const { xml } = buildNFePreviewXml(empresaRegimeNormal, 8, 1, [itemDifal], contribuinte, {
      nomeMunicipioEmitente: "SAO PAULO",
    });

    assert.doesNotMatch(xml, /<ICMSUFDest>/);
  });
});

describe("pagamentos na NF-e", () => {
  it("gera um detPag para cada método informado", () => {
    const result = buildNFePreviewXml(
      empresa,
      3,
      1,
      [{ ...item, valorUnitario: 100, valorTotal: 100 }],
      destinatario("SP"),
      {
        nomeMunicipioEmitente: "SAO PAULO",
        pagamentos: [
          { tPag: "17", valor: 40 },
          { tPag: "03", valor: 60, tpIntegra: "2" },
        ],
      },
    );

    assert.equal(result.xml.match(/<detPag>/g)?.length, 2);
    assert.match(result.xml, /<tPag>17<\/tPag><vPag>40\.00<\/vPag>/);
    assert.match(result.xml, /<tPag>03<\/tPag><vPag>60\.00<\/vPag><card><tpIntegra>2<\/tpIntegra><\/card>/);
  });

  it("atribui o total da nota ao método único quando o valor não é informado", () => {
    const result = buildNFePreviewXml(empresa, 4, 1, [item], destinatario("SP"), {
      nomeMunicipioEmitente: "SAO PAULO",
      pagamento: { tPag: "17" },
    });

    assert.match(result.xml, /<tPag>17<\/tPag><vPag>10\.00<\/vPag>/);
  });

  it("inclui o frete no item, nos totais e no pagamento da nota", () => {
    const result = buildNFePreviewXml(
      empresa,
      5,
      1,
      [{ ...item, valorFrete: 12.5 }],
      destinatario("SP"),
      {
        nomeMunicipioEmitente: "SAO PAULO",
        pagamento: { tPag: "17" },
      },
    );

    assert.match(result.xml, /<prod>.*<vFrete>12\.50<\/vFrete>.*<\/prod>/);
    assert.match(result.xml, /<ICMSTot>.*<vFrete>12\.50<\/vFrete>.*<vNF>22\.50<\/vNF>/);
    assert.match(result.xml, /<tPag>17<\/tPag><vPag>22\.50<\/vPag>/);
  });
});
