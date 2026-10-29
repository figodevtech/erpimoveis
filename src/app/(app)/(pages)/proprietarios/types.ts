export enum StatusProprietario {
  TODOS = "TODOS",
  ATIVO = "ATIVO",
  INATIVO = "INATIVO",
}

export interface Proprietario {
  id: number;
  nomerazaosocial: string;
  tipopessoa: "FISICA" | "JURIDICA";
  cpfcnpj?: string | null;
  email?: string | null;
  telefone?: string | null;
  endereco?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  estado?: string | null;
  cep?: string | null;
  percentual_admin?: number;
  ativo?: boolean;
  observacoes?: string | null;
  created_at?: string;
}

export interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ProprietariosCardsProps {
  statusCounts: Record<string, number>;
  loadingStatusCounter: boolean;
  totalProprietarios: number;
}

