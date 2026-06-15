"use client";

import { useEffect, useState } from "react";
import type { StatusOS } from "./ordens-tabs";

// Cores dos status (mantive seu padrão e ajustei APROVADO p/ consistência)
export const statusClasses: Record<string, string> = {
  AGUARDANDO_CHECKLIST:
    "border-slate-400/40 bg-slate-100 text-slate-800 dark:border-slate-500/30 dark:bg-slate-600/15 dark:text-slate-300",
  ORCAMENTO:
    "border-fuchsia-500/35 bg-fuchsia-100 text-fuchsia-900 dark:border-fuchsia-500/30 dark:bg-fuchsia-600/15 dark:text-fuchsia-300",
  APROVACAO_ORCAMENTO:
    "border-sky-500/35 bg-sky-100 text-sky-900 dark:border-sky-500/30 dark:bg-sky-600/15 dark:text-sky-300",
  ORCAMENTO_APROVADO:
    "border-emerald-500/35 bg-emerald-100 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-600/15 dark:text-emerald-300",
  EM_ANDAMENTO:
    "border-amber-500/35 bg-amber-100 text-amber-900 dark:border-amber-500/30 dark:bg-amber-600/15 dark:text-amber-300",
  PAGAMENTO:
    "border-indigo-500/35 bg-indigo-100 text-indigo-900 dark:border-indigo-500/30 dark:bg-indigo-600/15 dark:text-indigo-300",
  SEM_COBRANCA:
    "border-cyan-500/35 bg-cyan-100 text-cyan-900 dark:border-cyan-500/30 dark:bg-cyan-600/15 dark:text-cyan-300",
  CONCLUIDO:
    "border-green-500/35 bg-green-100 text-green-900 dark:border-green-500/30 dark:bg-green-600/15 dark:text-green-300",
  CANCELADO:
    "border-red-500/35 bg-red-100 text-red-900 dark:border-red-500/30 dark:bg-red-600/15 dark:text-red-300",
};

// Cores de prioridade
export const prioClasses: Record<string, string> = {
  ALTA:
    "border-red-500/35 bg-red-100 text-red-900 dark:border-red-500/30 dark:bg-red-600/15 dark:text-red-300",
  NORMAL:
    "border-amber-500/35 bg-amber-100 text-amber-900 dark:border-amber-500/30 dark:bg-amber-600/15 dark:text-amber-300",
  BAIXA:
    "border-emerald-500/35 bg-emerald-100 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-600/15 dark:text-emerald-300",
};

export function fmtDate(s?: string | null) {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    });
}

export function toMs(s?: string | null): number | null {
  if (!s) return null;
  let v = String(s).trim();

  // Supabase/PostgREST pode devolver timestamp sem timezone (ex.: 2026-02-06T12:34:56.789).
  // Como o Postgres normalmente roda em UTC, interpretamos esses valores como UTC para evitar duracao negativa
  // (ex.: mostrar 0m por horas em clientes com fuso -03:00).
  if (/^\d{4}-\d{2}-\d{2}\s/.test(v)) v = v.replace(" ", "T");
  const hasTz = /([zZ]|[+-]\d{2}:?\d{2})$/.test(v);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) && !hasTz) v = `${v}Z`;

  const t = new Date(v).getTime();
  return isNaN(t) ? null : t;
}

export function fmtDuration(ms: number) {
  if (ms < 0) ms = 0;
  const m = Math.floor(ms / 60000);
  if (m <= 0) return "0m";
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const min = m % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  // Sempre mostra minutagem, exceto quando for zero e ja houver dia/hora (ex.: "1h 0m").
  if (!(min === 0 && (d > 0 || h > 0))) parts.push(`${min}m`);
  return parts.join(" ");
}

export function useNowTick(periodMs = 60000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), periodMs);
    return () => clearInterval(id);
  }, [periodMs]);
  return now;
}

export function safeStatus(s?: string | null) {
  return (s ?? "ORCAMENTO") as Exclude<StatusOS, "TODAS">;
}
