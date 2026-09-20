import type { EmpresaRow, NFeDestinatario, NFeItem } from "../../types";
export const empresa: EmpresaRow = {
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

export const item: NFeItem = {
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
export function rtcTeste(base: number): NonNullable<NFeItem["rtc"]> {
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

export function destinatario(uf: string): NFeDestinatario {
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

