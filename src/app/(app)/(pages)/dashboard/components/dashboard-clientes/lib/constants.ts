import type { InsightsClientes, RespostaContadorStatusClientes } from "./types";

export const INSIGHTS_INICIAIS: InsightsClientes = {
  totalClients: 0,
  countsByStatus: { ATIVO: 0, INATIVO: 0, PENDENTE: 0 },
  countsByTipo: { FISICA: 0, JURIDICA: 0 },
  byEstado: {},
  topCidades: [],
  monthlyNew: [],
  dailyNew: [],
  recent30d: 0,
  prev30d: 0,
  clientesAtendidos30: 0,
  clientesRecorrentes90: 0,
  taxaRecorrencia90: 0,
};

export const BARRAS_UF_PADRAO = [
  { uf: "SP", count: 0 },
  { uf: "RJ", count: 0 },
  { uf: "MG", count: 0 },
  { uf: "BA", count: 0 },
  { uf: "RS", count: 0 },
];

export const CONTADOR_STATUS_INICIAL: RespostaContadorStatusClientes = {
  countsByStatus: { ATIVO: 0, INATIVO: 0, PENDENTE: 0 },
  totalClients: 0,
};
