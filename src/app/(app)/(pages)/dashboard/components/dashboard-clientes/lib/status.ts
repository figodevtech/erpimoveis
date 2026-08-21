import type { StatusCliente } from "./types";

export const ORDEM_STATUS: StatusCliente[] = ["ATIVO", "PENDENTE", "INATIVO"];

export const ROTULO_STATUS: Record<StatusCliente, string> = {
  ATIVO: "Ativos",
  PENDENTE: "Pendentes",
  INATIVO: "Inativos",
  NULL: "Sem status",
};

export const COR_STATUS: Record<StatusCliente, string> = {
  ATIVO: "var(--chart-1)",
  PENDENTE: "var(--chart-2)",
  INATIVO: "var(--chart-3)",
  NULL: "var(--muted-foreground)",
};

export function statusConhecido(chave: StatusCliente) {
  return chave === "ATIVO" || chave === "INATIVO" || chave === "PENDENTE";
}
