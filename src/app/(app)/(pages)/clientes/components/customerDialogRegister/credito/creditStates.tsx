"use client";

import { Loader2, Plus, RefreshCw } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { COLUNAS_EXTRATO } from "./creditMovementItem";
import { descrever, moeda, type SaldoMovimentoCliente } from "./types";

export function CreditLoadingState() {
  return (
    <div
      className="overflow-hidden rounded-xl border bg-card"
      role="status"
      aria-live="polite"
      aria-label="Carregando crédito do cliente"
    >
      <div className="space-y-4 px-4 pb-5 pt-4 sm:px-6">
        <Skeleton className="h-3.5 w-64 max-w-full" />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-8 w-44" />
            <Skeleton className="h-3.5 w-80 max-w-full" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-10 w-36" />
            <Skeleton className="h-10 w-40" />
          </div>
        </div>
      </div>
      <div className="border-t">
        {[1, 2, 3, 4].map((item) => (
          <div
            key={item}
            className={cn("grid grid-cols-[3rem_minmax(0,1fr)_2rem] gap-x-3 px-4 py-3.5 sm:px-6", COLUNAS_EXTRATO)}
          >
            <Skeleton className="h-3.5 w-9" />
            <div className="space-y-2">
              <Skeleton className="h-3.5 w-4/5" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="hidden h-3.5 w-16 justify-self-end sm:block" />
            <Skeleton className="hidden h-3.5 w-16 justify-self-end sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function CreditErrorState({ retry }: { retry: () => void }) {
  return (
    <div
      className="flex flex-col items-start gap-3 rounded-xl border border-destructive/30 bg-card px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6"
      role="alert"
    >
      <p className="text-sm text-foreground">Não foi possível carregar o extrato de crédito.</p>
      <Button type="button" variant="outline" className="min-h-10 gap-2" onClick={retry}>
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
    <div className="px-4 py-10 sm:px-6">
      <p className="text-sm font-medium text-foreground">Nenhum lançamento ainda.</p>
      <p className="mt-1 max-w-[60ch] text-sm text-muted-foreground">
        Créditos adicionados aqui e baixas pagas com crédito aparecem neste extrato.
      </p>
      {podeAjustar && onAdicionar && (
        <Button type="button" variant="outline" className="mt-4 min-h-10 gap-1.5" onClick={onAdicionar}>
          <Plus className="size-4" aria-hidden="true" />
          Adicionar crédito
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
  const entrada = movimento?.sentido === "CREDITO";

  return (
    <AlertDialog
      open={movimento !== null}
      onOpenChange={(next) => {
        if (!next && !excluindo) onFechar();
      }}
    >
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir lançamento?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm">
              {movimento && (
                <div className="flex items-baseline justify-between gap-4 rounded-lg border bg-muted/40 px-3 py-2.5 text-foreground">
                  <span className="line-clamp-2 min-w-0">{descrever(movimento)}</span>
                  <span
                    className={cn(
                      "shrink-0 font-medium tabular-nums",
                      entrada ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400",
                    )}
                  >
                    {entrada ? "+" : "−"}
                    {moeda.format(movimento.valor)}
                  </span>
                </div>
              )}
              <span className="block text-muted-foreground">
                O lançamento sai do extrato e o saldo das linhas seguintes é recalculado.
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
