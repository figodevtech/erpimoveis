import { Timestamp } from "next/dist/server/lib/cache-handlers/types"
import { Ordem } from "../ordens/types"
import { Veiculo } from "../veiculos/types"


enum TipoPessoa {
  FISICA = "FISICA",
  JURIDICA = "JURIDICA",
}

export enum ClientStatus {
  ATIVO = "ATIVO",
  INATIVO = "INATIVO",
  PENDENTE = "PENDENTE",
}

export enum Cliente_rank{
  EXELENTE = "EXCELENTE",
  ALTO = "ALTO",
  NORMAL = "NORMAL",
  BAIXO = "BAIXO",
}


export interface Customer {
  id: number
  tipopessoa: TipoPessoa
  cpfcnpj: string
  nomerazaosocial: string
  email: string | null
  telefone: string | null
  endereco: string | null
  endereconumero: string | null
  enderecocomplemento: string | null
  cidade: string | null
  estado: string | null
  bairro: string | null
  foto_url?: string | null
  cep: string | null
  inscricaoestadual: string | null
  /** indIEDest da NF-e: 1 contribuinte, 2 isento, 9 não contribuinte. */
  ind_ie_dest?: number | null
  inscricaomunicipal: string | null
  codigomunicipio: string | null
  createdat: string
  updatedat: Timestamp
  status: ClientStatus
  veiculos: Veiculo[]
  ordens: Ordem[]
  rank?: Cliente_rank | null
  /**
   * Dívida em aberto, quando a origem dos dados a calcula — hoje só a listagem
   * (`GET /api/customers`). Opcional porque `Customer` também serve o
   * `customerSelect` e os diálogos, que não pedem esse resumo.
   */
  divida?: DividaCliente | null
}

export interface DividaCliente {
  totalEmAberto: number
  totalVencido: number
  quantidadeEmAberto: number
  quantidadeVencida: number
  /** Parte da dívida veio de carga de outro sistema, não foi gerada aqui. */
  temMigrado: boolean
}

export interface Pagination {
  total: number
  page: number
  limit: number
  totalPages: number
  pageCount?: number
}

export enum Status {
  TODOS = "TODOS",
  ATIVO = "ATIVO",
  INATIVO = "INATIVO",
  PENDENTE = "PENDENTE",
}

export interface CardsProps {
    loadingStatusCounter: boolean
    totalCustomers: number
    statusCounts: Record<string, number>
}
