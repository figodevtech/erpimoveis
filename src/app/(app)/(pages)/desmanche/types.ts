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
  combustivel?: string | null;
  transmissao?: string | null;
  observacoes?: string | null;
  createdat?: string | null;
  updatedat?: string | null;
  pecas?: LotePeca[];
}

export interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  pageCount?: number;
}
