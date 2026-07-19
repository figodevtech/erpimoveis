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
