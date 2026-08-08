"use client";

import type { ReactNode } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Shell visual compartilhado pelos dialogs de detalhe de movimentacao (entrada e saida).
 *
 * Direcao do movimento define o acento: entrada = emerald, saida = red. O header e um
 * "hero" com faixa de acento solida a esquerda, numero do movimento em tipografia larga
 * e slots para status/metricas — sem blur nem gradiente, so contraste e geometria.
 */

export type MovementTone = "entrada" | "saida";

const TONE = {
  entrada: {
    rail: "bg-emerald-500",
    chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/25",
    hero: "bg-emerald-500/[0.06]",
  },
  saida: {
    rail: "bg-red-500",
    chip: "bg-red-500/10 text-red-700 dark:text-red-300 ring-red-500/25",
    hero: "bg-red-500/[0.06]",
  },
} as const;

export function toneClasses(tone: MovementTone) {
  return TONE[tone];
}

/** Bloco rotulo/valor usado em todas as grades de detalhe. */
export function Field({
  label,
  children,
  mono = false,
  className = "",
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</dt>
      <dd className={`mt-1 break-words text-sm font-medium ${mono ? "font-mono text-xs" : ""}`}>{children}</dd>
    </div>
  );
}

/** Secao com titulo em caixa alta e regua fina, agrupando um conjunto de campos. */
export function Section({
  title,
  icon: Icon,
  action,
  children,
}: {
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 min-w-0">
      <div className="flex flex-wrap items-center gap-2 sm:gap-3 min-w-0">
        <div className="flex items-center gap-2 shrink-0">
          {Icon ? <Icon className="size-3.5 shrink-0 text-muted-foreground" /> : null}
          <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{title}</h3>
        </div>
        <div className="h-px min-w-[16px] flex-1 bg-border" />
        {action ? <div className="flex flex-wrap items-center gap-1.5 shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Card de metrica destacada (quantidade, total, saldo...). */
export function Metric({
  label,
  value,
  hint,
  emphasis = false,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  emphasis?: boolean;
  tone?: MovementTone;
}) {
  const accent = emphasis && tone ? (tone === "entrada" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400") : "";
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums leading-none ${accent}`}>{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/**
 * Trilha visual saldo anterior -> resultante, comunicando o efeito da movimentacao
 * no estoque sem depender de texto corrido.
 */
export function BalanceTrail({
  before,
  after,
  tone,
}: {
  before: number | null | undefined;
  after: number | null | undefined;
  tone: MovementTone;
}) {
  if (before === null || before === undefined || after === null || after === undefined) return null;
  const delta = Number(after) - Number(before);
  const sign = delta > 0 ? "+" : "";
  return (
    <div className="flex items-center gap-2 text-xs tabular-nums">
      <span className="rounded border bg-muted/50 px-2 py-1 font-medium text-muted-foreground">
        {Number(before).toLocaleString("pt-BR")}
      </span>
      <span className={`font-bold ${tone === "entrada" ? "text-emerald-600" : "text-red-600"}`}>
        {sign}
        {delta.toLocaleString("pt-BR")}
      </span>
      <span className="text-muted-foreground">&rarr;</span>
      <span className="rounded border bg-background px-2 py-1 font-bold">
        {Number(after).toLocaleString("pt-BR")}
      </span>
    </div>
  );
}

export function MovementDialogShell({
  open,
  onOpenChange,
  tone,
  kicker,
  movementId,
  statusSlot,
  metaSlot,
  loading,
  loadingLabel,
  error,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tone: MovementTone;
  kicker: string;
  movementId: number | null;
  statusSlot?: ReactNode;
  metaSlot?: ReactNode;
  loading: boolean;
  loadingLabel: string;
  error: string | null;
  children: ReactNode;
}) {
  const t = TONE[tone];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col w-screen h-[100dvh] max-w-full inset-0 top-0 left-0 translate-x-0 translate-y-0 sm:top-[50%] sm:left-[50%] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-full sm:max-w-4xl sm:h-[85vh] sm:max-h-[850px] p-0 gap-0 rounded-none sm:rounded-2xl border-0 sm:border bg-card shadow-2xl overflow-hidden min-w-0">
        {/* Hero: faixa de acento + identificacao do movimento (Fixo) */}
        <DialogHeader className="shrink-0 space-y-0 text-left">
          <div className={`flex items-stretch ${t.hero} border-b`}>
            <div className={`w-1.5 shrink-0 ${t.rail}`} aria-hidden="true" />
            {/* pr-12 reserva espaco para o botao de fechar do DialogContent */}
            <div className="flex min-w-0 flex-1 flex-wrap items-end justify-between gap-4 py-4 pl-5 pr-12">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{kicker}</p>
                <DialogTitle className="mt-1 flex items-baseline gap-2 text-2xl sm:text-3xl font-black leading-none tracking-tight">
                  <span className="text-muted-foreground/40">#</span>
                  <span className="tabular-nums">{movementId ?? "—"}</span>
                </DialogTitle>
                <DialogDescription className="sr-only">
                  Informações completas da movimentação {movementId ?? ""}.
                </DialogDescription>
                {metaSlot ? <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">{metaSlot}</div> : null}
              </div>
              {statusSlot ? <div className="flex shrink-0 items-center gap-2">{statusSlot}</div> : null}
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 space-y-6 min-h-0 min-w-0 w-full">
          {loading ? (
            <div className="flex min-h-56 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-5 animate-spin" /> {loadingLabel}
            </div>
          ) : null}

          {error ? (
            <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center text-sm text-destructive">
              <AlertCircle className="size-6" />
              {error}
            </div>
          ) : null}

          {!loading && !error ? <div className="space-y-6">{children}</div> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
