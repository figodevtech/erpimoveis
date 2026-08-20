export type DashboardClientesProps = {
  className?: string;
  endpointInsights?: string;
  endpointStatus?: string;
  autoRefreshMs?: number;
};

export type StatusCliente = "ATIVO" | "INATIVO" | "PENDENTE" | "NULL";

export type InsightsClientes = {
  totalClients: number;
  countsByStatus: Record<string, number>;
  countsByTipo: { FISICA: number; JURIDICA: number };
  byEstado: Record<string, number>;
  topCidades: { cidade: string; count: number }[];
  monthlyNew: { month: string; count: number }[];
  dailyNew?: { date: string; count: number }[];
  recent30d: number;
  prev30d: number;
  clientesAtendidos30: number;
  clientesRecorrentes90: number;
  taxaRecorrencia90: number;
};

export type RespostaContadorStatusClientes = {
  countsByStatus: Record<string, number>;
  totalClients: number;
};

export type CartaoStatusClientesProps = {
  className?: string;
  endpoint?: string;
  autoRefreshMs?: number;
};
