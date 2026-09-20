import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildNFePreviewXml } from "./buildNFe";
import type { EmpresaRow, NFeDestinatario, NFeItem } from "./types";
import { normalizarNiveisDeReferencia, normalizarOrdemNfRefIde } from "./xmlIde";

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

/**
 * Grupo IBS/CBS do ano-teste de 2026, no formato que o motor exige do regime
 * regular a partir de 03/08/2026. `versaoClassificacao` e `validadoEm` marcam
 * que o cClassTrib já passou pela tabela oficial — sem eles o motor recusa.
 */
function rtcTeste(base: number): NonNullable<NFeItem["rtc"]> {
  const ibsUf = Number((base * 0.0005).toFixed(2));
  const ibsMunicipio = Number((base * 0.0005).toFixed(2));
  return {
    cstIbsCbs: "000",
    cClassTrib: "000001",
    baseCalculo: base,
    ibsUf: { aliquota: 0.05, valor: ibsUf },
    ibsMunicipio: { aliquota: 0.05, valor: ibsMunicipio },
    valorIbs: Number((ibsUf + ibsMunicipio).toFixed(2)),
    cbs: { aliquota: 0.9, valor: Number((base * 0.009).toFixed(2)) },
    versaoClassificacao: "1.00",
    validadoEm: new Date().toISOString(),
  };
}

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
      nomeMunicipioEmitente: "SAO PAULO", indFinal: 1,
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
      { nomeMunicipioEmitente: "SAO PAULO", indFinal: 1 },
    );
    assert.match(result.xml, /<idDest>2<\/idDest>/);
  });
});

describe("limite de xNome", () => {
  it("corta emitente, destinatário e transportadora em 60 caracteres sem alterar a origem", () => {
    const nomeEmitente = "E".repeat(61);
    const nomeDestinatario = "D".repeat(61);
    const nomeTransportadora = "T".repeat(61);
    const empresaLonga = { ...empresa, ambiente: "PRODUCAO" as const, razaosocial: nomeEmitente };
    const destinatarioLongo = { ...destinatario("SP"), razaoSocial: nomeDestinatario };

    const { xml } = buildNFePreviewXml(
      empresaLonga,
      10,
      1,
      [item],
      destinatarioLongo,
      {
        nomeMunicipioEmitente: "SAO PAULO", indFinal: 1,
        ambiente: "PRODUCAO",
        transporte: {
          modFrete: "0",
          transportadora: {
            documento: "12345678000199",
            nome: nomeTransportadora,
            uf: "SP",
          },
        },
      },
    );

    const nomesNoXml = Array.from(xml.matchAll(/<xNome>(.*?)<\/xNome>/g), (match) => match[1]);
    assert.deepEqual(nomesNoXml.map((nome) => nome.length), [60, 60, 60]);
    assert.deepEqual(nomesNoXml, ["E".repeat(60), "D".repeat(60), "T".repeat(60)]);
    assert.equal(empresaLonga.razaosocial, nomeEmitente);
    assert.equal(destinatarioLongo.razaoSocial, nomeDestinatario);
  });
});

describe("documentos referenciados e devolução", () => {
  const chaveOriginal = "35260812345678000199550010000001231000001234";

  it("gera a referência granular depois de vItem e o IPI devolvido nos totais", () => {
    const { xml } = buildNFePreviewXml(
      empresa,
      91,
      1,
      [{
        ...item,
        cfop: "5202",
        percentualDevolucao: 100,
        valorIpiDevolvido: 2.5,
        informacoesAdicionaisProduto: "Devolução do item recebido.",
        dfeReferenciado: { chaveAcesso: chaveOriginal, nItem: 3 },
      }],
      destinatario("SP"),
      {
        nomeMunicipioEmitente: "SAO PAULO", indFinal: 1,
        natOp: "DEVOLUCAO DE COMPRA",
        finNFe: 4,
      },
    );

    assert.match(
      xml,
      /<\/imposto><impostoDevol><pDevol>100\.00<\/pDevol><IPI><vIPIDevol>2\.50<\/vIPIDevol><\/IPI><\/impostoDevol><infAdProd>Devolucao do item recebido\.<\/infAdProd><vItem>10\.00<\/vItem><DFeReferenciado>/,
    );
    assert.match(xml, new RegExp(`<chaveAcesso>${chaveOriginal}</chaveAcesso><nItem>3</nItem>`));
    assert.match(xml, /<vIPIDevol>2\.50<\/vIPIDevol><vPIS>/);
    assert.match(xml, /<vNF>12\.50<\/vNF>/);
    assert.doesNotMatch(xml, /<NFref>/);
  });

  it("preserva a NF-e de venda sem grupos de devolução ou referência", () => {
    const { xml } = buildNFePreviewXml(empresa, 92, 1, [item], destinatario("SP"), {
      nomeMunicipioEmitente: "SAO PAULO", indFinal: 1,
    });
    assert.doesNotMatch(xml, /<impostoDevol>|<DFeReferenciado>|<NFref>/);
    assert.match(xml, /<vIPIDevol>0\.00<\/vIPIDevol>/);
    assert.match(xml, /<vNF>10\.00<\/vNF>/);
  });

  it("gera NFref no bloco ide quando o chamador usa uma referência de cabeçalho", () => {
    const { xml } = buildNFePreviewXml(empresa, 93, 1, [item], destinatario("SP"), {
      nomeMunicipioEmitente: "SAO PAULO", indFinal: 1,
      documentosReferenciados: [{ chaveAcesso: chaveOriginal }],
    });
    // No XSD 4.00, NFref é o último grupo de ide, depois de verProc. O código
    // B12a do MOC é um identificador de campo, não a ordem física do XML.
    assert.match(xml, new RegExp(`<verProc>[^<]+</verProc><NFref><refNFe>${chaveOriginal}</refNFe></NFref></ide>`));
    assert.doesNotMatch(xml, /<cMunFG>[^<]+<\/cMunFG><NFref>/);
  });

  it("descarta o NFref quando os itens já referenciam a origem", () => {
    // Rejeição 1010: os dois níveis de referenciamento são excludentes. Com
    // DFeReferenciado no item, o grupo de cabeçalho não pode sair — mesmo que o
    // chamador o informe, porque é ele que a SEFAZ recusa junto.
    const { xml } = buildNFePreviewXml(
      empresa,
      94,
      1,
      [{
        ...item,
        cfop: "5202",
        percentualDevolucao: 100,
        valorIpiDevolvido: 0,
        dfeReferenciado: { chaveAcesso: chaveOriginal, nItem: 1 },
      }],
      destinatario("SP"),
      {
        nomeMunicipioEmitente: "SAO PAULO", indFinal: 1,
        natOp: "DEVOLUCAO DE COMPRA PARA COMERCIALIZACAO",
        finNFe: 4,
        documentosReferenciados: [{ chaveAcesso: chaveOriginal }],
      },
    );

    assert.doesNotMatch(xml, /<NFref>/);
    assert.match(xml, new RegExp(`<DFeReferenciado><chaveAcesso>${chaveOriginal}</chaveAcesso><nItem>1</nItem>`));
    // IPI zerado é o caso normal do Simples e não pode suprimir o pDevol.
    assert.match(xml, /<impostoDevol><pDevol>100\.00<\/pDevol><IPI><vIPIDevol>0\.00<\/vIPIDevol>/);
  });

  it("corrige a ordem de NFref em rascunho legado antes de uma nova autorização", () => {
    const legado = `<NFe><infNFe><ide><cMunFG>2503209</cMunFG><NFref><refNFe>${chaveOriginal}</refNFe></NFref><tpImp>1</tpImp><verProc>ERP</verProc></ide></infNFe><Signature>antiga</Signature></NFe>`;
    const normalizado = normalizarOrdemNfRefIde(legado);

    assert.match(normalizado, new RegExp(`<verProc>ERP</verProc><NFref><refNFe>${chaveOriginal}</refNFe></NFref></ide>`));
    assert.doesNotMatch(normalizado, /<cMunFG>[^<]+<\/cMunFG><NFref>/);
    assert.equal(normalizarOrdemNfRefIde(normalizado), normalizado);
    assert.match(normalizado, /<Signature>antiga<\/Signature>/);
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
    // Desde 03/08/2026 o regime regular não emite sem IBS/CBS: uma nota de CRT 3
    // sem o grupo é rejeitada. Alíquotas-teste de 2026: 0,1% IBS e 0,9% CBS.
    rtc: rtcTeste(2000),
  };

  it("gera o grupo na venda interestadual a consumidor final não contribuinte", () => {
    const { xml } = buildNFePreviewXml(empresaRegimeNormal, 3, 1, [itemDifal], destinatario("MG"), {
      nomeMunicipioEmitente: "SAO PAULO", indFinal: 1,
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
      { nomeMunicipioEmitente: "SAO PAULO", indFinal: 1 },
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
      nomeMunicipioEmitente: "SAO PAULO", indFinal: 1,
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
      { nomeMunicipioEmitente: "SAO PAULO", indFinal: 1 },
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
      nomeMunicipioEmitente: "SAO PAULO", indFinal: 1,
    });

    assert.match(xml, /<vProd>2000\.00<\/vProd>/);
    assert.match(xml, /<vNF>2000\.00<\/vNF>/);
  });

  it("não gera o grupo em operação interna", () => {
    const { xml } = buildNFePreviewXml(empresaRegimeNormal, 7, 1, [{ ...itemDifal, cfop: "5102" }], destinatario("SP"), {
      nomeMunicipioEmitente: "SAO PAULO", indFinal: 1,
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
      nomeMunicipioEmitente: "SAO PAULO", indFinal: 1,
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
        nomeMunicipioEmitente: "SAO PAULO", indFinal: 1,
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
      nomeMunicipioEmitente: "SAO PAULO", indFinal: 1,
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
        nomeMunicipioEmitente: "SAO PAULO", indFinal: 1,
        pagamento: { tPag: "17" },
        // Frete cobrado na nota exige transporte: com modFrete 9 é incoerente.
        transporte: { modFrete: "0" },
      },
    );

    assert.match(result.xml, /<prod>.*<vFrete>12\.50<\/vFrete>.*<\/prod>/);
    assert.match(result.xml, /<ICMSTot>.*<vFrete>12\.50<\/vFrete>.*<vNF>22\.50<\/vNF>/);
    assert.match(result.xml, /<tPag>17<\/tPag><vPag>22\.50<\/vPag>/);
  });

  it("respeita a ordem do leiaute em vFrete e vDesc dentro de <prod>", () => {
    const result = buildNFePreviewXml(
      empresa,
      6,
      1,
      [{ ...item, valorFrete: 12.5, valorDesconto: 2.5 }],
      destinatario("SP"),
      { nomeMunicipioEmitente: "SAO PAULO", indFinal: 1, transporte: { modFrete: "0" } },
    );

    // I14a vUnTrib < I15 vFrete < I17 vDesc < I17b indTot.
    assert.match(
      result.xml,
      /<vUnTrib>[\d.]+<\/vUnTrib><vFrete>12\.50<\/vFrete><vDesc>2\.50<\/vDesc><indTot>1<\/indTot>/,
    );
  });
});

describe("desconto na NF-e", () => {
  it("destaca o desconto no item e abate do vNF sem mexer no vProd", () => {
    const result = buildNFePreviewXml(
      empresa,
      7,
      1,
      [{ ...item, quantidade: 2, valorTotal: 20, valorDesconto: 5 }],
      destinatario("SP"),
      {
        nomeMunicipioEmitente: "SAO PAULO", indFinal: 1,
        pagamento: { tPag: "17" },
      },
    );

    // vProd segue o preço de tabela; o abatimento aparece só em vDesc.
    assert.match(result.xml, /<vProd>20\.00<\/vProd>/);
    assert.match(result.xml, /<prod>.*<vDesc>5\.00<\/vDesc>.*<\/prod>/);
    assert.match(result.xml, /<ICMSTot>.*<vProd>20\.00<\/vProd>/);
    assert.match(result.xml, /<ICMSTot>.*<vDesc>5\.00<\/vDesc>.*<vNF>15\.00<\/vNF>/);
    assert.match(result.xml, /<tPag>17<\/tPag><vPag>15\.00<\/vPag>/);
  });

  it("calcula os tributos sobre o item já líquido do desconto", () => {
    const result = buildNFePreviewXml(
      empresa,
      8,
      1,
      [
        {
          ...item,
          quantidade: 2,
          valorTotal: 20,
          valorDesconto: 5,
          pis: { cst: "01", modo: "PERCENTUAL", aliquota: 10 },
          cofins: { cst: "01", modo: "PERCENTUAL", aliquota: 10 },
        },
      ],
      destinatario("SP"),
      { nomeMunicipioEmitente: "SAO PAULO", indFinal: 1 },
    );

    assert.match(result.xml, /<PISAliq><CST>01<\/CST><vBC>15\.00<\/vBC><pPIS>10\.0000<\/pPIS><vPIS>1\.50<\/vPIS>/);
    assert.match(result.xml, /<ICMSTot>.*<vPIS>1\.50<\/vPIS><vCOFINS>1\.50<\/vCOFINS>/);
  });

  it("mantém vDesc zerado quando não há desconto", () => {
    const result = buildNFePreviewXml(empresa, 9, 1, [item], destinatario("SP"), {
      nomeMunicipioEmitente: "SAO PAULO", indFinal: 1,
    });

    assert.doesNotMatch(result.xml, /<prod>.*<vDesc>.*<\/prod>/);
    assert.match(result.xml, /<ICMSTot>.*<vDesc>0\.00<\/vDesc>.*<vNF>10\.00<\/vNF>/);
  });
});

describe("normalização de rascunho legado", () => {
  const chaveOriginal = "35260812345678000199550010000001231000001234";

  it("tira o NFref do ide quando o item já referencia a origem", () => {
    // Rejeição 1010 em rascunho gravado pela versão que emitia os dois níveis.
    // A autorização reenvia o XML guardado, então a correção precisa acontecer
    // aqui — senão a nota só sairia depois de ser reaberta e salva de novo.
    const legado =
      `<NFe><infNFe><ide><cMunFG>2503209</cMunFG><verProc>ERP</verProc>` +
      `<NFref><refNFe>${chaveOriginal}</refNFe></NFref></ide>` +
      `<det nItem="1"><vItem>10.00</vItem>` +
      `<DFeReferenciado><chaveAcesso>${chaveOriginal}</chaveAcesso><nItem>1</nItem></DFeReferenciado>` +
      `</det></infNFe></NFe>`;

    const normalizado = normalizarNiveisDeReferencia(legado);

    assert.doesNotMatch(normalizado, /<NFref>/);
    assert.match(normalizado, new RegExp(`<DFeReferenciado><chaveAcesso>${chaveOriginal}</chaveAcesso>`));
    assert.equal(normalizarNiveisDeReferencia(normalizado), normalizado);
  });

  it("preserva o NFref quando nenhum item referencia a origem", () => {
    const soCabecalho =
      `<NFe><infNFe><ide><verProc>ERP</verProc>` +
      `<NFref><refNFe>${chaveOriginal}</refNFe></NFref></ide>` +
      `<det nItem="1"><vItem>10.00</vItem></det></infNFe></NFe>`;

    assert.equal(normalizarNiveisDeReferencia(soCabecalho), soCabecalho);
  });
});

describe("grupo <entrega> (local de entrega/retirada)", () => {
  it("não gera <entrega> quando a opção não foi informada", () => {
    const { xml } = buildNFePreviewXml(empresa, 20, 1, [item], destinatario("SP"), {
      nomeMunicipioEmitente: "SAO PAULO", indFinal: 1,
    });

    assert.doesNotMatch(xml, /<entrega>/);
  });

  it("gera <entrega> com a pessoa indicada, sem alterar o <dest>", () => {
    const { xml } = buildNFePreviewXml(empresa, 21, 1, [item], destinatario("MT"), {
      nomeMunicipioEmitente: "SAO PAULO", indFinal: 1,
      entrega: {
        documento: "49354549896",
        nome: "Gustavo Guarnieri Guarnieri",
        endereco: {
          logradouro: "AVENIDA RIO DE JANEIRO",
          numero: "SN",
          complemento: "RETIRADA EM AEROPORTO",
          bairro: "PARQUE JOAO BRAZ - CIDADE INDUSTRIAL",
          codigoMunicipio: "5208707",
          nomeMunicipio: "GOIANIA",
          uf: "GO",
          cep: "74483500",
        },
      },
    });

    assert.match(xml, /<entrega><CPF>49354549896<\/CPF><xNome>Gustavo Guarnieri Guarnieri<\/xNome>/);
    assert.match(xml, /<xCpl>RETIRADA EM AEROPORTO<\/xCpl>/);
    assert.match(xml, /<cMun>5208707<\/cMun><xMun>GOIANIA<\/xMun><UF>GO<\/UF><CEP>74483500<\/CEP><\/entrega>/);
    // O destinatário fiscal continua sendo o da operação, não a pessoa indicada.
    assert.match(xml, /<dest><CPF>12345678909<\/CPF>/);
  });

  it("não gera <entrega> pela metade quando falta documento ou endereço", () => {
    const { xml } = buildNFePreviewXml(empresa, 22, 1, [item], destinatario("SP"), {
      nomeMunicipioEmitente: "SAO PAULO", indFinal: 1,
      entrega: {
        documento: "49354549896",
        nome: "Gustavo Guarnieri Guarnieri",
        // Endereço incompleto: sem cMun/UF a SEFAZ rejeita, então o grupo some.
        endereco: { logradouro: "AVENIDA RIO DE JANEIRO" },
      },
    });

    assert.doesNotMatch(xml, /<entrega>/);
  });
});

describe("grupo <transp> (modalidade de frete)", () => {
  it("gera <transp> só com modFrete quando nenhuma transportadora foi informada", () => {
    // Caso real: nota de garantia autorizada pela SEFAZ com modFrete=0 e
    // nenhum dado de transportadora — <transporta> é opcional no layout da
    // NF-e independente do modFrete escolhido.
    const { xml } = buildNFePreviewXml(empresa, 23, 1, [item], destinatario("SP"), {
      nomeMunicipioEmitente: "SAO PAULO", indFinal: 1,
      transporte: { modFrete: "0" },
    });

    assert.match(xml, /<transp><modFrete>0<\/modFrete><\/transp>/);
    assert.doesNotMatch(xml, /<transporta>/);
  });
});

describe("frete sem transporte", () => {
  it("recusa frete cobrado com modFrete 9 (sem ocorrência de transporte)", () => {
    assert.throws(
      () => buildNFePreviewXml(empresa, 7, 1, [{ ...item, valorFrete: 12.5 }], destinatario("SP"), {
        nomeMunicipioEmitente: "SAO PAULO", indFinal: 1, transporte: { modFrete: "9" },
      }),
      /NFE_FRETE_SEM_TRANSPORTE/,
    );
  });

  it("aceita modFrete 9 sem frete", () => {
    const { xml } = buildNFePreviewXml(empresa, 8, 1, [item], destinatario("SP"), {
      nomeMunicipioEmitente: "SAO PAULO", indFinal: 1, transporte: { modFrete: "9" },
    });
    assert.match(xml, /<modFrete>9<\/modFrete>/);
  });
});
