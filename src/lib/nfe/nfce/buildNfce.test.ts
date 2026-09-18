// Garante que o modelo 65 sai correto do MESMO motor que monta a NF-e 55.
//
// O valor destes testes é de regressão dupla: confirmam o que a NFC-e precisa
// ter de diferente e, ao lado de `buildNFe.test.ts`, que a NF-e não mudou.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildNFePreviewXml } from "../buildNFe";
import { MODELO_NFCE, MODELO_NFE } from "../modeloDocumento";
import { NFCE_HOMOLOGACAO_PRIMEIRO_ITEM_DESCRICAO } from "../constants";
import type { EmpresaRow, NFeDestinatario, NFeItem } from "../types";

const empresa: EmpresaRow = {
  id: 1,
  cnpj: "12345678000199",
  razaosocial: "EMPRESA TESTE",
  nomefantasia: null,
  inscricaoestadual: "123456789",
  inscricaomunicipal: null,
  endereco: "RUA TESTE",
  codigomunicipio: "2507507",
  regimetributario: 1,
  certificadocaminho: null,
  cschomologacao: null,
  cscproducao: null,
  ambiente: "PRODUCAO",
  createdat: null,
  updatedat: null,
  bairro: "CENTRO",
  numero: "1",
  complemento: null,
  cep: "58000000",
  uf: "PB",
  codigopais: "1058",
  nomepais: "BRASIL",
  telefone: null,
  cnae: null,
  inscricaoestadualst: null,
  certificadosenha: null,
};

const itens: NFeItem[] = [
  {
    numeroItem: 1,
    codigoProduto: "1",
    descricao: "PRODUTO TESTE",
    ncm: "87089990",
    cfop: "5102",
    unidade: "UN",
    quantidade: 2,
    valorUnitario: 25,
    valorTotal: 50,
    orig: "0",
    csosn: "102",
    pis: { cst: "07", modo: "NAO_TRIBUTADO" },
    cofins: { cst: "07", modo: "NAO_TRIBUTADO" },
  },
];

const consumidor: NFeDestinatario = {
  cpf: "11144477735",
  razaoSocial: "CONSUMIDOR",
  indIEDest: "9",
  endereco: {
    logradouro: "RUA CLIENTE",
    numero: "2",
    bairro: "CENTRO",
    codigoMunicipio: "2507507",
    nomeMunicipio: "JOAO PESSOA",
    uf: "PB",
    cep: "58000000",
    codigoPais: "1058",
    nomePais: "BRASIL",
  },
};

const base = {
  nomeMunicipioEmitente: "JOAO PESSOA",
  pagamentos: [{ tPag: "01", valor: 50 }],
};

function nfce(destinatario?: NFeDestinatario, extra: Record<string, unknown> = {}) {
  return buildNFePreviewXml(empresa, 1, 1, itens, destinatario, {
    ...base,
    modelo: MODELO_NFCE,
    ...extra,
  });
}

describe("NFC-e: bloco ide", () => {
  it("usa mod 65 e leva o modelo para a chave de acesso", () => {
    const { xml, chave } = nfce(consumidor);

    assert.ok(xml.includes("<mod>65</mod>"));
    // Posições 20-22 da chave são o modelo.
    assert.equal(chave.slice(20, 22), "65");
    assert.equal(chave.length, 44);
  });

  it("fixa idDest 1, indFinal 1 e tpImp 4", () => {
    const { xml } = nfce(consumidor);

    assert.ok(xml.includes("<idDest>1</idDest>"));
    assert.ok(xml.includes("<indFinal>1</indFinal>"));
    assert.ok(xml.includes("<tpImp>4</tpImp>"));
  });

  it("não deixa a UF do consumidor virar operação interestadual", () => {
    const forasteiro: NFeDestinatario = {
      ...consumidor,
      endereco: { ...consumidor.endereco, uf: "PE", codigoMunicipio: "2611606" },
    };
    const { xml } = nfce(forasteiro);

    assert.ok(xml.includes("<idDest>1</idDest>"));
    assert.ok(!xml.includes("<ICMSUFDest"));
  });

  it("aceita tpEmis 9 para contingência offline", () => {
    const { xml, chave } = nfce(consumidor, { tpEmis: 9 });

    assert.ok(xml.includes("<tpEmis>9</tpEmis>"));
    // tpEmis também compõe a chave, na posição 34.
    assert.equal(chave.slice(34, 35), "9");
  });
});

describe("NFC-e: consumidor", () => {
  it("omite o grupo dest quando o consumidor não se identifica", () => {
    const { xml } = nfce(undefined);

    assert.ok(!xml.includes("<dest>"));
    // E principalmente: não inventa CPF nenhum.
    assert.ok(!xml.includes("12345678909"));
  });

  it("monta o grupo dest quando há CPF", () => {
    const { xml } = nfce(consumidor);

    assert.ok(xml.includes("<dest>"));
    assert.ok(xml.includes("<CPF>11144477735</CPF>"));
  });
});

describe("NFC-e: transporte e homologação", () => {
  it("sai sempre sem ocorrência de transporte", () => {
    const { xml } = nfce(consumidor, {
      transporte: { modFrete: "0", transportadora: { nome: "TRANSPORTADORA X" } },
    });

    assert.ok(xml.includes("<transp><modFrete>9</modFrete></transp>"));
    assert.ok(!xml.includes("TRANSPORTADORA X"));
  });

  it("marca homologação na descrição do primeiro item, não no destinatário", () => {
    const homologacao = { ...empresa, ambiente: "HOMOLOGACAO" as const };
    const { xml } = buildNFePreviewXml(homologacao, 1, 1, itens, consumidor, {
      ...base,
      modelo: MODELO_NFCE,
    });

    assert.ok(xml.includes(`<xProd>${NFCE_HOMOLOGACAO_PRIMEIRO_ITEM_DESCRICAO}</xProd>`));
    assert.ok(!xml.includes("<xNome>NF-E EMITIDA EM AMBIENTE"));
  });
});

describe("ambiente fiscal é único: a empresa manda", () => {
  // O serviço de emissão passa sempre `empresa.ambiente` — a NFC-e não tem
  // ambiente próprio. Trocar o cadastro da empresa muda os dois modelos juntos.
  // O parâmetro existe para o chamador declarar o ambiente resolvido, não para
  // a NFC-e divergir da NF-e.
  it("sem o parâmetro, cai no ambiente da empresa", () => {
    // `empresa` acima está em PRODUCAO.
    const { xml } = nfce(consumidor);
    assert.ok(xml.includes("<tpAmb>1</tpAmb>"));
    assert.ok(!xml.includes(NFCE_HOMOLOGACAO_PRIMEIRO_ITEM_DESCRICAO));
  });

  it("homologação leva tpAmb 2 e a marcação de teste no primeiro item", () => {
    const { xml } = nfce(consumidor, { ambiente: "HOMOLOGACAO" });

    assert.ok(xml.includes("<tpAmb>2</tpAmb>"));
    assert.ok(xml.includes(`<xProd>${NFCE_HOMOLOGACAO_PRIMEIRO_ITEM_DESCRICAO}</xProd>`));
  });

  it("produção leva tpAmb 1 e nenhuma marcação de teste", () => {
    const { xml } = nfce(consumidor, { ambiente: "PRODUCAO" });

    assert.ok(xml.includes("<tpAmb>1</tpAmb>"));
    assert.ok(!xml.includes(NFCE_HOMOLOGACAO_PRIMEIRO_ITEM_DESCRICAO));
  });

  it("tpAmb e a marcação de homologação nunca divergem", () => {
    for (const ambiente of ["HOMOLOGACAO", "PRODUCAO"] as const) {
      const { xml } = nfce(consumidor, { ambiente });
      const ehHomologacao = xml.includes("<tpAmb>2</tpAmb>");
      const temMarcacao = xml.includes(NFCE_HOMOLOGACAO_PRIMEIRO_ITEM_DESCRICAO);
      assert.equal(ehHomologacao, temMarcacao);
    }
  });
});

describe("NF-e modelo 55 não regride", () => {
  it("continua com mod 55 e destinatário obrigatório quando o modelo é omitido", () => {
    const { xml, chave } = buildNFePreviewXml(empresa, 1, 1, itens, consumidor, { ...base, indFinal: 1 });

    assert.ok(xml.includes("<mod>55</mod>"));
    assert.equal(chave.slice(20, 22), "55");
    assert.ok(xml.includes("<dest>"));
    assert.ok(xml.includes("<tpImp>1</tpImp>"));
  });

  it("modelo 55 explícito é igual ao modelo omitido", () => {
    const explicito = buildNFePreviewXml(empresa, 1, 1, itens, consumidor, {
      ...base,
      indFinal: 1,
      modelo: MODELO_NFE,
    });
    const omitido = buildNFePreviewXml(empresa, 1, 1, itens, consumidor, { ...base, indFinal: 1 });

    // cNF é sorteado a cada emissão, e entra na chave (logo, no Id e no cDV):
    // comparamos o documento com esses três normalizados.
    const normalizar = (xml: string) =>
      xml
        .replace(/<cNF>\d+<\/cNF>/, "<cNF>*</cNF>")
        .replace(/<cDV>\d<\/cDV>/, "<cDV>*</cDV>")
        .replace(/Id="NFe\d{44}"/, 'Id="NFe*"');
    assert.equal(normalizar(explicito.xml), normalizar(omitido.xml));
  });
});
