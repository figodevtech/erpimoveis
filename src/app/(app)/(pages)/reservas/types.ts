export enum StatusReserva {
  TODOS = "TODOS",
  CONFIRMADA = "CONFIRMADA",
  EM_ANDAMENTO = "EM_ANDAMENTO",
  CONCLUIDA = "CONCLUIDA",
  CANCELADA = "CANCELADA",
}

export interface Reserva {
  id: number;
  codigo?: string | null;
  inicio: string;
  fim: string;
  hospedes: number;
  status: string;
  financeiro_status?: string | null;
  valor_total?: number;
  diaria?: number;
  imovel_id?: number;
  imovel?: {
    id?: number;
    titulo?: string;
    codigo?: string;
  };
  imovel_titulo?: string;
  cliente_id?: number;
  cliente?: {
    id?: number;
    nomerazaosocial?: string;
    email?: string;
    telefone?: string;
  };
  cliente_nome?: string;
  observacoes?: string | null;
  created_at?: string;
}

export interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ReservasCardsProps {
  statusCounts: Record<string, number>;
  loadingStatusCounter: boolean;
  totalReservas: number;
  ativas: number;
  finalizadas: number;
}

