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


/** Contato adicional do cliente. O principal segue em `Customer.telefone`. */
export interface TelefoneCliente {
  id: number
  telefone: string
  contato: string | null
  observacao: string | null
}

export interface Customer {
  id: number
  tipopessoa: TipoPessoa
  cpfcnpj: string
  nomerazaosocial: string
  email: string | null
  telefone: string | null
  /** Telefones secundários; só o cadastro do cliente os carrega. */
  telefones?: TelefoneCliente[]
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
  /** Cadastro do sistema (`consumidor_final`): sem documento e intocável. */
  codigo_sistema?: string | null
  veiculos: Veiculo[]
  ordens: Ordem[]
  rank?: Cliente_rank | null
  /**
   * Dívida em aberto, quando a origem dos dados a calcula — hoje só a listagem
   * (`GET /api/customers`). Opcional porque `Customer` também serve o
   * `customerSelect` e os diálogos, que não pedem esse resumo.
   */
  divida?: DividaCliente | null
  /**
   * Crédito disponível na carteira do cliente. É o oposto da dívida: saldo a
   * favor dele, que pode quitar uma cobrança pelo método Crédito Cliente.
   * Só muda por movimento — ver `SaldoMovimentoCliente`.
   */
  saldo_credito?: number | null
}

/**
 * Uma linha do razão do crédito do cliente. Só o ajuste MANUAL pode ser editado
 * ou excluído (e o banco recalcula as fotografias); a linha de TRANSACAO é
 * imutável — desfazê-la é estornar a baixa.
 */
export interface SaldoMovimentoCliente {
  id: number
  /** CREDITO entra na carteira; DEBITO sai dela. */
  sentido: "CREDITO" | "DEBITO"
  /** MANUAL é o ajuste feito aqui; TRANSACAO veio da baixa de um título. */
  origem: "MANUAL" | "TRANSACAO"
  acao: "REGISTRO" | "ESTORNO"
  valor: number
  saldo_anterior: number | null
  saldo_resultante: number | null
  transacao_id: number | null
  motivo: string | null
  created_by: string | null
  created_at: string
  updated_by: string | null
  updated_at: string | null
  /** Nome de quem lançou (no manual) ou de quem fez a baixa (na transação). */
  created_by_nome: string | null
  updated_by_nome: string | null
  /** Documento por trás da baixa, quando a linha veio de transação. */
  ordemservico_id: number | null
  venda_id: number | null
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
