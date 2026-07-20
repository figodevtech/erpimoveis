import type { Produto } from "../estoque/types";

export enum LoteTipo {
  CARROS = "CARROS",
  MOTOS = "MOTOS",
  CAMINHOES = "CAMINHOES",
}

export interface LotePeca {
  id: number;
  lote_id: number;
  produto_id: number;
  createdat?: string;
  produto?: Produto | null;
  quantidade_vendida?: number;
  valor_apurado?: number;
  vendas_realizadas?: number;
}

export interface LotePecasKpis {
  totalPecas: number;
  pecasVendidas: number;
  quantidadeVendida: number;
  valorCompra: number;
  valorPecas: number;
  valorApurado: number;
  valorDisponivel: number;
  resultadoApurado: number;
  resultadoPotencial: number;
}

export interface Lote {
  id?: number;
  placa?: string | null;
  modelo?: string | null;
  marca?: string | null;
  ano?: number | null;
  cor?: string | null;
  kmatual?: number | null;
  tipo?: LoteTipo | string | null;
  chassi?: string | null;
  ano_modelo?: number | null;
  versao?: string | null;
  fipe?: number | null;
  valor_compra?: number | null;
  combustivel?: string | null;
  transmissao?: string | null;
  observacoes?: string | null;
  imgUrl?: string | null;
  createdat?: string | null;
  updatedat?: string | null;
  pecas?: LotePeca[];
  pecasKpis?: LotePecasKpis;
}

export interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  pageCount?: number;
}
