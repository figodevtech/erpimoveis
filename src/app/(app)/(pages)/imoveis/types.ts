export enum SituacaoImovel {
  TODOS = "TODOS",
  DISPONIVEL = "DISPONIVEL",
  RESERVADO = "RESERVADO",
  ALUGADO = "ALUGADO",
  VENDIDO = "VENDIDO",
  INATIVO = "INATIVO",
  MANUTENCAO = "MANUTENCAO",
}

export interface Imovel {
  id: number;
  codigo?: string | null;
  titulo: string;
  slug?: string;
  tipo?: string;
  situacao_operacional?: string;
  status?: string;
  publicado?: boolean;
  ativo?: boolean;
  diaria?: number;
  valor_locacao?: number;
  valor_venda?: number;
  modalidades?: string[];
  proprietario_id?: number;
  proprietario?: {
    id?: number;
    nomerazaosocial?: string;
  };
  proprietario_nome?: string;
  endereco_publico?: {
    cidade?: string;
    bairro?: string;
    uf?: string;
  };
  endereco?: {
    cidade?: string;
    bairro?: string;
    logradouro?: string;
    numero?: string;
  };
  quartos?: number;
  banheiros?: number;
  vagas?: number;
  capacidade?: number;
  created_at?: string;
}

export interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ImoveisCardsProps {
  statusCounts: Record<string, number>;
  loadingStatusCounter: boolean;
  totalImoveis: number;
  disponiveis: number;
  ocupados: number;
}

