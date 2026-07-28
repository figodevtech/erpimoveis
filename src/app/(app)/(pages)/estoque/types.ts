import { VendaComItens } from "../(vendas)/historicovendas/types";
import { OrdemServico } from "@/types/ordemservico";

export enum Estoque_status {
  CRITICO = "CRITICO",
  OK = "OK",
  BAIXO = "BAIXO",
  SEM_ESTOQUE = "SEM_ESTOQUE",
  TODOS = "TODOS",
}

export interface Grupo_produto {
  id: number;
  nome: string;
  descricao: string | null;
  ativo: boolean;
}

export enum Conservacao_produto {
  NOVO = "NOVO",
  USADO = "USADO",
  RECONDICIONADO = "RECONDICIONADO",
}

export enum Unidade_medida {
  UN = "UN",
  JGO = "JGO",
  KIT = "KIT",
  PAR = "PAR",
  CX = "CX",
  PCT = "PCT",
}

export enum Entrada_tipo {
  COMPRA_FORNECEDOR = "COMPRA FORNECEDOR",
  COMPRA_PF = "COMPRA PF",
  DEVOLUCAO = "DEVOLUÇÃO",
}

export enum Entrada_status {
  CONFIRMADA = "CONFIRMADA",
  CANCELADA = "CANCELADA",
}

export interface EntradaInfo {
  id: number;
  tipo: Entrada_tipo;
  status: Entrada_status;
  fiscal: boolean;
  origem: "AJUSTE_RAPIDO" | "MANUAL" | "NFE_TERCEIRO";
  fornecedorid: number;
  fornecedor: Fornecedor;
  notachave?: string;
}

export interface entrada {
  id: number;
  quantidade: number;
  precovenda: number;
  entradainfo: EntradaInfo;
  created_at: Date;
}

export interface SaidaEstoqueItem {
  id: number;
  quantidade: number;
  saldo_anterior: number;
  saldo_resultante: number;
  created_at: Date;
  saida: {
    id: number;
    motivo: string;
    observacao?: string | null;
    status: "CONFIRMADA" | "CANCELADA";
    created_at: Date;
  };
}

export interface Vendaproduto {
  id: number;
  created_at: Date;
  updated_at: Date;
  venda_id: number;
  produtoid: number;
  sub_total: number;
  valor_total: number;
  valor_desconto: number;
  tipo_desconto: number;
  quantidade: number;
  venda: VendaComItens;
}

export interface OSProduto {
  id: number;
  ordemservicoid: number;
  quantidade: number;
  precounitario: number;
  subtotal: number;
  ordem: OrdemServico;
}

export interface Fornecedor {
  id: number;
  cpfcnpj?: string;
  nomerazaosocial: string;
  nomefantasia?: string;
  endereco?: string;
  cidade?: string;
  estado?: string;
  cep?: string;
  contato?: string;
  createdat?: Date;
  updatedat?: Date;
  endereconumero?: string;
  enderecocomplemento?: string;
  bairro?: string;
}

export interface Produto {
  id?: number;
  precovenda?: number;
  precocompra?: number;
  ultimovalordecompra?: number | null;
  descricao?: string;
  estoque?: number; // default 0 no banco, mas pode ser null
  estoqueminimo?: number; // default 0 no banco, mas pode ser null
  unidade?: Unidade_medida;
  ncm?: string;
  cfop?: string;
  origem_mercadoria?: string;
  cst?: string;
  cest?: string;
  csosn?: string;
  aliquotaicms?: number;
  cst_pis?: string;
  aliquota_pis?: number;
  modo_pis?: "PERCENTUAL" | "QUANTIDADE" | "NAO_TRIBUTADO";
  aliquota_por_unidade_pis?: number;
  cst_cofins?: string;
  aliquota_cofins?: number;
  modo_cofins?: "PERCENTUAL" | "QUANTIDADE" | "NAO_TRIBUTADO";
  aliquota_por_unidade_cofins?: number;
  rtc_habilitado?: boolean;
  cst_ibscbs?: string;
  cclass_trib?: string;
  aliquota_ibs_uf?: number;
  aliquota_ibs_municipio?: number;
  aliquota_cbs?: number;
  codigobarras?: string;
  etiqueta?: string;
  local?: string;
  createdat?: Date; // timestamp no banco, pode ser null
  updatedat?: Date | string; // APIs retornam timestamp serializado
  referencia?: string;
  titulo?: string;
  fornecedor?: string;
  fabricante?: string;
  grupo?: Grupo_produto; // grupo_produto no banco, default 'OUTROS'
  grupo_produto_id?: number;
  status_estoque?: Estoque_status;
  imgUrl?: string | null;
  exibirPdv?: boolean;
  tituloMarketplace?: string;
  descricaoMarketplace?: string;
  entradas?: entrada[];
  saidas?: SaidaEstoqueItem[];
  vendasdoproduto?: Vendaproduto[];
  ordensdoproduto?: OSProduto[];
  fornecedorid?: number;
  codigofornecedor?: string;
  conservacao?: Conservacao_produto;
}

export interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  pageCount?: number;
}

export interface ProductListFilters {
  grupoId: string;
  conservacao: string;
  unidade: string;
  fabricante: string;
  local: string;
  exibirPdv: string;
  estoqueMin: string;
  estoqueMax: string;
  precoMin: string;
  precoMax: string;
}
