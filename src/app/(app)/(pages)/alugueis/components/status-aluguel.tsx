"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  ROTULO_STATUS_ALUGUEL,
  diasRestantes,
  rotuloDias,
  statusExibicao,
  type DatasDoAluguel,
  type StatusExibicaoAluguel,
} from "@/lib/alugueis/status";

/** Mesma paleta dos status da OS (ordens-utils.ts). */
export const CLASSES_STATUS_ALUGUEL: Record<StatusExibicaoAluguel, string> = {
  AGENDADO:
    "border-sky-500/35 bg-sky-100 text-sky-900 dark:border-sky-500/30 dark:bg-sky-600/15 dark:text-sky-300",
  EM_ANDAMENTO:
    "border-emerald-500/35 bg-emerald-100 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-600/15 dark:text-emerald-300",
  VENCE_HOJE:
    "border-amber-500/35 bg-amber-100 text-amber-900 dark:border-amber-500/30 dark:bg-amber-600/15 dark:text-amber-300",
  ATRASADO:
    "border-red-500/35 bg-red-100 text-red-900 dark:border-red-500/30 dark:bg-red-600/15 dark:text-red-300",
  PAUSADO:
    "border-slate-400/40 bg-slate-100 text-slate-800 dark:border-slate-500/30 dark:bg-slate-600/15 dark:text-slate-300",
  ENCERRADO:
    "border-indigo-500/35 bg-indigo-100 text-indigo-900 dark:border-indigo-500/30 dark:bg-indigo-600/15 dark:text-indigo-300",
};

const CLASSES_DIAS: Record<StatusExibicaoAluguel, string> = {
  AGENDADO: "text-sky-700 dark:text-sky-300",
  EM_ANDAMENTO: "text-foreground",
  VENCE_HOJE: "text-amber-700 dark:text-amber-300 font-semibold",
  ATRASADO: "text-red-700 dark:text-red-300 font-semibold",
  PAUSADO: "text-muted-foreground",
  ENCERRADO: "text-muted-foreground",
};

export function StatusAluguelBadge({ aluguel, className }: { aluguel: DatasDoAluguel; className?: string }) {
  const status = statusExibicao(aluguel);
  return (
    <Badge className={cn(CLASSES_STATUS_ALUGUEL[status], "text-[11px] px-2 py-0.5", className)}>
      {ROTULO_STATUS_ALUGUEL[status]}
    </Badge>
  );
}

export function DiasAluguel({ aluguel, className }: { aluguel: DatasDoAluguel; className?: string }) {
  const status = statusExibicao(aluguel);
  const dias = diasRestantes(aluguel);
  const texto = status === "AGENDADO" ? rotuloDias(dias, "EM_ANDAMENTO") : rotuloDias(dias, status);
  return (
    <span className={cn("tabular-nums", CLASSES_DIAS[status], className)}>
      {status === "PAUSADO" ? `${texto} (pausado)` : texto}
    </span>
  );
}

export function fmtData(data?: string | null) {
  if (!data) return "—";
  const [ano, mes, dia] = data.slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}

export function fmtDataHora(valor?: string | null) {
  if (!valor) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Fortaleza",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(valor));
}

export function fmtMoeda(valor?: number | null) {
  return Number(valor ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
