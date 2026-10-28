import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isValidCnpj } from "@/lib/fiscal-identifiers";
import { buildNFePreviewXml } from "./buildNFe";
import { comAssinaturaXsdTeste, validarNFeContraXsd } from "./icms/__xsdOficial";
import {
  CNPJ_INTERMEDIADOR_MERCADO_LIVRE,
  exigeIndicadorIntermediador,
  normalizarIntermediador,
  validarIntermediador,
} from "./intermediador";
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

const destinatario: NFeDestinatario = {
  cpf: "12345678909",
  razaoSocial: "CLIENTE TESTE",
  indIEDest: "9",
  endereco: {
    logradouro: "RUA CLIENTE",
    numero: "2",
    bairro: "CENTRO",
    codigoMunicipio: "3550308",
    nomeMunicipio: "SAO PAULO",
    uf: "SP",
    cep: "01001000",
    codigoPais: "1058",
    nomePais: "BRASIL",
  },
};

const mercadoLivre = { cnpj: CNPJ_INTERMEDIADOR_MERCADO_LIVRE, idCadIntTran: "BRPECASPB" };

function nota(indPres: 1 | 2 | 9, intermediador: typeof mercadoLivre | null) {
  return buildNFePreviewXml(empresa, 1, 3, [item], destinatario, {
    nomeMunicipioEmitente: "SAO PAULO",
    indFinal: 1,
    indPres,
    intermediador,
    pagamentos: [{ tPag: "17", valor: 10 }],
  }).xml;
}

describe("intermediador da transação (NT 2020.006)", () => {
  it("venda do Mercado Livre declara a plataforma no <ide> e no <infIntermed>, na ordem do XSD", async () => {
    const xml = nota(2, mercadoLivre);
    assert.match(xml, /<indPres>2<\/indPres><indIntermed>1<\/indIntermed><procEmi>/);
    assert.match(
      xml,
      /<\/pag><infIntermed><CNPJ>03007331000141<\/CNPJ><idCadIntTran>BRPECASPB<\/idCadIntTran><\/infIntermed><infAdic>/,
    );
    const xsd = await validarNFeContraXsd(comAssinaturaXsdTeste(xml));
    assert.equal(xsd.valido, true, xsd.erros.join("\n"));
  });

  it("venda não presencial sem plataforma informa indIntermed 0 — sem ele a SEFAZ devolve a 434", async () => {
    for (const indPres of [2, 9] as const) {
      const xml = nota(indPres, null);
      assert.match(xml, new RegExp(`<indPres>${indPres}</indPres><indIntermed>0</indIntermed><procEmi>`));
      assert.doesNotMatch(xml, /<infIntermed>/);
      const xsd = await validarNFeContraXsd(comAssinaturaXsdTeste(xml));
      assert.equal(xsd.valido, true, xsd.erros.join("\n"));
    }
  });

  it("venda trocada para presencial na tela sai sem indicador nem grupo", () => {
    const xml = nota(1, mercadoLivre);
    assert.match(xml, /<indPres>1<\/indPres><procEmi>/);
    assert.doesNotMatch(xml, /indIntermed|infIntermed/);
  });

  it("recusa intermediador incompleto antes de montar a nota", () => {
    assert.throws(() => nota(2, { cnpj: "123", idCadIntTran: "BRPECASPB" }), /NFE_INTERMEDIADOR_INVALIDO/);
    assert.throws(() => nota(2, { cnpj: CNPJ_INTERMEDIADOR_MERCADO_LIVRE, idCadIntTran: "X" }), /NFE_INTERMEDIADOR_INVALIDO/);
  });

  it("o CNPJ do Mercado Livre é válido e o rascunho vazio vira 'sem intermediador'", () => {
    assert.equal(isValidCnpj(CNPJ_INTERMEDIADOR_MERCADO_LIVRE), true);
    assert.equal(normalizarIntermediador({ cnpj: "", idCadIntTran: "  " }), null);
    assert.equal(normalizarIntermediador(null), null);
    assert.deepEqual(
      normalizarIntermediador({ cnpj: "03.007.331/0001-41", idCadIntTran: " BRPECASPB " }),
      mercadoLivre,
    );
    assert.equal(validarIntermediador(mercadoLivre), null);
    assert.deepEqual(["0", "1", "2", "3", "4", "5", "9"].map(exigeIndicadorIntermediador), [
      false, false, true, true, true, false, true,
    ]);
  });
});
