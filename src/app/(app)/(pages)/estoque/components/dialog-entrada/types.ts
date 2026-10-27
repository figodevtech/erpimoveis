import type { DuplicataDaNota, FaturaDaNota } from "@/lib/nfe/duplicatas";
import type { TotaisDaNota } from "@/lib/nfe/totais-nfe";
import type { ComponenteFiscal } from "@/lib/nfe/valor-fiscal-entrada";

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
  /** Cobrança do XML. Ausente em nota à vista e em resposta antiga em cache. */
  fatura?: FaturaDaNota | null;
  duplicatas?: DuplicataDaNota[];
  fornecedorReferenteId?: number;
  fornecedorReferente?: Fornecedor;
  /** Componentes do `vNF` que nenhum item informou. Rateados, não descartados. */
  componentesNaoAlocados?: ComponenteFiscal[];
}

export interface Emitente {
  cnpj: string | number | null;
  cpf: string | number | null;
  /** CPF ou CNPJ, sem pontuação. */
  documento: string | null;
  tipoDocumento: "CNPJ" | "CPF" | null;
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
  /**
   * A leitura fiscal completa, com a reconciliação contra o `vNF`. Opcional
   * porque resposta antiga em cache não a tem.
   */
  composicao?: TotaisDaNota;
}

export interface ItemNF {
  numeroItem: string | number | null;
  codigo: string;
  ean: string | number | null;
  descricao: string;
  /** `det/infAdProd`, quando o emitente informa. */
  informacaoAdicional?: string | null;
  ncm: string | number | null;
  cest?: string | number | null;
  cfop: string | number | null;
  unidade: string;
  quantidade: number;
  valorUnitario: number;
  valorTotal: number;
  /** `indTot`: item com 0 não entra no total da nota. */
  compoeTotal?: boolean;
  valorDesconto?: number;
  valorFrete?: number;
  valorSeguro?: number;
  outrasDespesas?: number;
  valorIpi?: number;
  /*
   * Tributos do item, lidos de `det/imposto` e `det/impostoDevol` — não de
   * `det/prod`. Servem para reconciliar com `ICMSTot` e para saber a qual item
   * cada valor pertence. Se integram ou não o custo é decisão da regra fiscal da
   * compra, não da estrutura do XML.
   */
  valorIpiDevolvido?: number;
  valorIcmsST?: number;
  valorFcpST?: number;
  valorIcmsMonoReten?: number;
  valorII?: number;
  valorIcmsDesonerado?: number;
  /** `indDeduzDeson`; `null` quando o XML não informou. */
  deduzIcmsDesonerado?: boolean | null;
  pisST?: { valor: number; compoeTotal: boolean };
  cofinsST?: { valor: number; compoeTotal: boolean };
  valorTotalTributos?: number;
  /**
   * Os componentes fiscais do item, já classificados pelo parser: o que compõe o
   * `vNF`, de qual `<det>` veio e como a política de custo o trata. Ausente em
   * resposta antiga em cache.
   */
  componentesFiscais?: ComponenteFiscal[];
  icms: Icms;
  produtoReferenciaId?: number;
  produtoReferencia?: Produto;
  destinoApropriado?: "PRODUTO" | "USOCONSUMO";
}

export interface Icms {
  ICMSSN102: {
    orig: number;
    CSOSN: number;
  };
}
