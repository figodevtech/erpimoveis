import { Customer } from "../../clientes/types";
import { Produto } from "../../estoque/types";
import { Transaction } from "../../(financeiro)/fluxodecaixa/types";

export interface StatusMetrics {
  totalValor: number;
  totalSubTotal: number;
  totalDesconto: number;
  totalPedidos: number;
  ticketMedio: number;
}

export interface VendaStatusMetricsData {
  period: {
    month: string;
    start: string;
    end: string;
  };
  totals: StatusMetrics;
  byStatus: {
    abertas?: StatusMetrics;
    finalizadas?: StatusMetrics;
    canceladas?: StatusMetrics;
    pagamento?: StatusMetrics;
    [key: string]: StatusMetrics | undefined; // fallback pra outros status
  };
}

export interface VendaProdutoItem {
  id: number;
  produto: Produto;
  produtoid: number;
  sub_total: number;
  quantidade: number;
  valor_total: number;
  tipo_desconto: string | null;
  valor_desconto: number;
}

export enum vendaStatus {
  ORCAMENTO = "ORCAMENTO",
  ABERTA = "ABERTA",
  PAGAMENTO = "PAGAMENTO",
  PENDENTE = "PENDENTE",
  AUTORIZADO = "AUTORIZADO",
  PAGO = "PAGO",
  FINALIZADA = "FINALIZADA",
  // Mantemos os dois por compatibilidade com o enum do banco (existem projetos com os 2 valores)
  CANCELADA = "CANCELADA",
  CANCELADO = "CANCELADO",
}

export type VendaCanal = "PDV" | "ONLINE" | "MERCADO_LIVRE" | "SHOPEE";

export type VendaStatusEntrega = "SEPARACAO" | "ENVIO" | "ENTREGUE";

export interface VendaComItens {
  id: number;
  notaNumero?: number | null;
  clienteid: number;
  valortotal: number;
  cliente: Customer
  status: vendaStatus;
  categoriavendaid?: number | null;
  categoria_venda?: {
    id: number;
    nome: string;
    descricao?: string | null;
    ativo?: boolean | null;
  } | null;
  canal: VendaCanal;
  status_entrega?: VendaStatusEntrega | null;
  codigo_rastreio?: string | null;
  transportadora_rastreio?: string | null;
  ultimo_evento_rastreio?: string | null;
  ultimo_evento_rastreio_em?: string | null;
  status_rastreio?: string | null;
  eventos_rastreio?: any | null;
  rastreio_atualizado_em?: string | null;
  nfe_chave_acesso?: string | null;
  danfe_url?: string | null;
  datavenda: string;
  createdat: string | null;
  updatedat: string | null;
  created_by: string | null; // uuid
  criador?: { id: string; nome?: string | null } | null;
  comissao_venda_percent_aplicada?: number | null;
  desconto_tipo: string | null;
  desconto_valor: number;
  forma_pagamento?: string | null;
  sub_total: number;
  observacoes?: string | null;
  observacoes_fiscais?: string | null;
  itens: VendaProdutoItem[];
  transacoes?: Transaction[] | null;
}

export interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  pageCount?: number;
}
