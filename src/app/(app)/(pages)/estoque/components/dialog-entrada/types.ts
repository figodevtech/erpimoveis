import { Fornecedor, Produto } from "../../types";

export interface NF {
  documentoFiscalRecebidoId?: number;
  chaveAcesso: string;
  numeroNota: number;
  serie: number;
  dataEmissao: string; // ISO 8601
  tipoOperacao: number;

  emitente: Emitente;
  destinatario: Destinatario;
  totais: Totais;
  itens: ItemNF[];
  fornecedorReferenteId?: number;
  fornecedorReferente?: Fornecedor;
}

export interface Emitente {
  cnpj: number;
  nome: string;
  nomeFantasia: string;
  ie: number;
  endereco: Endereco;
}

export interface Destinatario {
  cnpj: number | null;
  cpf: number;
  nome: string;
  ie: number | null;
  endereco: Endereco;
}

export interface Endereco {
  logradouro: string;
  numero: number;
  codigoMunicipio: number;
  bairro: string;
  municipio: string;
  uf: string;
  cep: number;
}

export interface Totais {
  valorProdutos: number;
  valorNota: number;
  valorFrete: number | null;
  valorDesconto: number | null;
  valorICMS: number | null;
  valorIPI: number | null;
}

export interface ItemNF {
  numeroItem: string;
  codigo: string;
  ean: number;
  descricao: string;
  ncm: number;
  cfop: number;
  unidade: string;
  quantidade: number;
  valorUnitario: number;
  valorTotal: number;
  valorDesconto?: number;
  valorFrete?: number;
  valorSeguro?: number;
  outrasDespesas?: number;
  valorIpi?: number;
  icms: Icms;
  produtoReferenciaId?: number;
  produtoReferencia?: Produto;
}

export interface Icms {
  ICMSSN102: {
    orig: number;
    CSOSN: number;
  };
}
