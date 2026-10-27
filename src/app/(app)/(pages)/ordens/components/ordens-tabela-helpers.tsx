// ./src/app/(app)/(pages)/ordens/components/ordens-tabela-helpers.ts
import type { ReactNode } from "react";
import type { Ordem } from "../types";
import type { StatusOS } from "./ordens-tabs";
import { ChevronsUpDown, ChevronUp, ChevronDown } from "lucide-react";
import { toMs, safeStatus } from "./ordens-utils";

// ---- Tipos locais (datas amigas p/ tabela)
export type OrdemComDatas = Ordem & {
  dataEntrada?: string | null;
  dataSaida?: string | null;
  finalizadoEm?: string | null;
  prioridade?: "ALTA" | "NORMAL" | "BAIXA" | null;
};

// ---- Ordenação (apenas colunas desejadas)
export type SortKey = "setor" | "entrada" | "saida" | "status" | "prioridade" | "tempo" | "concluido" | null;
export type SortDir = "asc" | "desc";

export type PrioFiltro = "TODAS" | "ALTA" | "NORMAL" | "BAIXA";

export const MAX_CLIENTE_CHARS = 28;
export const MAX_DESC_CHARS = 40;

// mapeia prioridade para número (para ordenar)
export const prioRank = (p?: OrdemComDatas["prioridade"]) => {
  const key = String(p || "").toUpperCase();
  if (key === "ALTA") return 3;
  if (key === "NORMAL") return 2;
  if (key === "BAIXA") return 1;
  return 0;
};

// Normaliza qualquer Date/string para "somente dia" (00:00:00)
export function normalizeDateDay(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? new Date(value) : new Date(value as string);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

// Tempo em ms, usando a mesma regra da coluna "Tempo"
export function getTempoMs(r: OrdemComDatas, now: number) {
  const startMs =
    toMs(r.dataEntrada) ?? toMs((r as any).createdat) ?? toMs((r as any).createdAt) ?? null;

  if (!startMs) return 0;

  const st = safeStatus(r.status);
  const endMs =
    st === "CONCLUIDO" || st === "SEM_COBRANCA" || st === "CANCELADO"
      ? toMs(r.finalizadoEm) ??
        toMs((r as any).finalizado_em) ??
        toMs(r.dataSaida) ??
        toMs((r as any).updatedat) ??
        toMs((r as any).updatedAt) ??
        now
      : now;

  return (endMs ?? now) - startMs;
}

// Política de botões por status
export function buildPolicy(st: StatusOS) {
  return {
    // ORCAMENTO_APROVADO entra para o usuário conseguir vincular os avulsos
    // aprovados — sem isso a OS não inicia e não há outro caminho para resolver.
    canEditBudget: st === "ORCAMENTO" || st === "ORCAMENTO_RECUSADO" || st === "ORCAMENTO_APROVADO" || st === "EM_ANDAMENTO",
    showEditOS: st === "ORCAMENTO",
    showLinkAprov: st === "ORCAMENTO" || st === "APROVACAO_ORCAMENTO",
    showCancelBudget: st === "APROVACAO_ORCAMENTO" || st === "ORCAMENTO_RECUSADO",
    showApproveBudget: st === "APROVACAO_ORCAMENTO",
    showRejectBudget: st === "APROVACAO_ORCAMENTO",
    showSendToApproval: st === "ORCAMENTO" || st === "ORCAMENTO_RECUSADO",
    showStart: st === "ORCAMENTO_APROVADO",
    showSendToPayment: st === "EM_ANDAMENTO",
    showReceivePayment: ["PAGAMENTO", "FATURAMENTO"].includes(st),
  };
}

// Cabeçalho genérico com ordenação
export type SortableHeaderProps = {
  label: ReactNode;
  columnKey: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onChange: (key: SortKey, dir: SortDir) => void;
};

export function SortableHeader({
  label,
  columnKey,
  sortKey,
  sortDir,
  onChange,
}: SortableHeaderProps) {
  const isActive = sortKey === columnKey;

  const icon = !isActive ? (
    <ChevronsUpDown className="ml-1 h-3.5 w-3.5 opacity-60" />
  ) : sortDir === "asc" ? (
    <ChevronUp className="ml-1 h-3.5 w-3.5" />
  ) : (
    <ChevronDown className="ml-1 h-3.5 w-3.5" />
  );

  const handleClick = () => {
    // ciclo: none -> desc -> asc -> none
    if (!isActive) {
      onChange(columnKey, "desc");
    } else if (isActive && sortDir === "desc") {
      onChange(columnKey, "asc");
    } else {
      onChange(null, "desc");
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center select-none cursor-pointer"
    >
      {label}
      {icon}
    </button>
  );
}
