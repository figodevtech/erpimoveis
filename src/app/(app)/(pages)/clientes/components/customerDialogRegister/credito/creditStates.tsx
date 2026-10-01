"use client";

import { AlertCircle, Loader2, Plus, RefreshCw, Trash2, WalletCards } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { descrever, moeda, type SaldoMovimentoCliente } from "./types";

export function CreditLoadingState() {
  return (
    <div
      className="space-y-4"
      role="status"
      aria-live="polite"
      aria-label="Carregando crédito do cliente"
    >
      {/* Customer Context Skeleton */}
      <Skeleton className="h-14 w-full rounded-xl" />

      {/* Hero Balance Card Skeleton */}
      <div className="rounded-2xl border bg-card p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-36 rounded-md" />
          <Skeleton className="h-5 w-20 rounded-md" />
        </div>
        <Skeleton className="h-10 w-48 rounded-md" />
        <Skeleton className="h-4 w-full max-w-md rounded-md" />
        <div className="pt-2 flex gap-2">
          <Skeleton className="h-10 w-36 rounded-lg" />
          <Skeleton className="h-10 w-36 rounded-lg" />
        </div>
      </div>

      {/* Movements Header Skeleton */}
      <div className="flex items-center justify-between pt-2">
        <div className="space-y-1.5">
          <Skeleton className="h-5 w-32 rounded-md" />
          <Skeleton className="h-4 w-48 rounded-md" />
        </div>
        <Skeleton className="h-6 w-24 rounded-full" />
      </div>

      {/* Ledger Items Skeleton */}
      <div className="rounded-xl border bg-card divide-y divide-border/60 overflow-hidden">
        {[1, 2, 3].map((item) => (
          <div key={item} className="flex items-center justify-between p-4 gap-3">
            <div className="flex items-center gap-3 flex-1">
              <Skeleton className="size-10 rounded-xl shrink-0" />
              <div className="space-y-2 flex-1">
                <Skeleton className="h-4 w-1/3 rounded-md" />
                <Skeleton className="h-3 w-1/4 rounded-md" />
              </div>
            </div>
            <div className="space-y-2 text-right">
              <Skeleton className="h-5 w-24 rounded-md ml-auto" />
              <Skeleton className="h-3 w-16 rounded-md ml-auto" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CreditErrorState({ retry }: { retry: () => void }) {
  return (
    <div
      className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-destructive/20 bg-destructive/5 p-6 text-center"
      role="alert"
    >
      <div className="flex size-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive mb-3">
        <AlertCircle className="size-6" aria-hidden="true" />
      </div>
      <p className="font-semibold text-foreground text-base">
        Não foi possível carregar a carteira de crédito
      </p>
      <p className="mt-1 text-xs sm:text-sm text-muted-foreground max-w-md">
        Houve uma falha ao consultar as movimentações do cliente no servidor. Tente novamente em alguns instantes.
      </p>
      <Button
        type="button"
        variant="outline"
        className="mt-4 min-h-10 gap-2 border-destructive/30 hover:bg-destructive/10"
        onClick={retry}
      >
        <RefreshCw className="size-4" aria-hidden="true" />
        Tentar novamente
      </Button>
    </div>
  );
}

export function CreditEmptyState({
  podeAjustar,
  onAdicionar,
}: {
  podeAjustar: boolean;
  onAdicionar?: () => void;
}) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 bg-card/50 p-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground mb-3">
        <WalletCards className="size-6" aria-hidden="true" />
      </div>
      <p className="font-semibold text-foreground text-base">
        Nenhuma movimentação na carteira
      </p>
      <p className="mt-1 text-xs sm:text-sm text-muted-foreground max-w-md">
        Este cliente ainda não possui créditos lançados nem histórico de abatimentos ou estornos de títulos.
      </p>
      {podeAjustar && onAdicionar && (
        <Button
          type="button"
          variant="outline"
          className="mt-4 gap-2 text-xs font-medium"
          onClick={onAdicionar}
        >
          <Plus className="size-3.5" aria-hidden="true" />
          Adicionar primeiro crédito
        </Button>
      )}
    </div>
  );
}

export function CreditDeleteDialog({
  movimento,
  excluindo,
  onFechar,
  onConfirmar,
}: {
  movimento: SaldoMovimentoCliente | null;
  excluindo: boolean;
  onFechar: () => void;
  onConfirmar: () => void;
}) {
  return (
    <AlertDialog
      open={movimento !== null}
      onOpenChange={(next) => {
        if (!next && !excluindo) onFechar();
      }}
    >
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
              <Trash2 className="size-4" />
            </span>
            <AlertDialogTitle className="text-lg font-semibold">Excluir lançamento?</AlertDialogTitle>
          </div>
          <AlertDialogDescription asChild>
            <div className="space-y-2 pt-2 text-xs sm:text-sm">
              {movimento && (
                <div className="rounded-lg border bg-muted/40 p-3 text-foreground font-medium flex items-center justify-between">
                  <span className="truncate pr-2">{descrever(movimento)}</span>
                  <span className="tabular-nums font-bold shrink-0 text-destructive">
                    {movimento.sentido === "CREDITO" ? "+" : "−"} {moeda.format(movimento.valor)}
                  </span>
                </div>
              )}
              <span className="block text-muted-foreground">
                O lançamento será removido permanentemente do extrato e o saldo do cliente será recalculado automaticamente pelo sistema.
              </span>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:gap-0">
          <AlertDialogCancel disabled={excluindo}>Cancelar</AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            disabled={excluindo}
            onClick={onConfirmar}
            className="gap-2"
          >
            {excluindo && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            Excluir lançamento
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
