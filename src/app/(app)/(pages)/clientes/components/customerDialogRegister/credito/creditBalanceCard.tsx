"use client";

import { ArrowDownLeft, Plus, WalletCards } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { moeda } from "./types";

type CreditBalanceCardProps = {
  saldo: number;
  podeAjustar: boolean;
  onAdicionar: () => void;
  onRemover: () => void;
};

export function CreditBalanceCard({
  saldo,
  podeAjustar,
  onAdicionar,
  onRemover,
}: CreditBalanceCardProps) {
  const temSaldo = saldo > 0;

  return (
    <section
      aria-label="Saldo de crédito do cliente"
      className={cn(
        "relative overflow-hidden rounded-2xl border bg-card p-5 sm:p-6 shadow-xs transition-colors",
        temSaldo
          ? "border-emerald-500/25 bg-gradient-to-br from-card via-card to-emerald-500/[0.04]"
          : "border-border/80",
      )}
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        {/* Bloco de Saldo e Informação */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors",
                temSaldo
                  ? "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400"
                  : "bg-muted text-muted-foreground",
              )}
              aria-hidden="true"
            >
              <WalletCards className="size-4" />
            </span>
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Crédito disponível
            </span>
            <Badge
              variant="outline"
              className={cn(
                "ml-1 text-[11px] font-medium",
                temSaldo
                  ? "border-emerald-300 bg-emerald-50/70 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
                  : "border-border text-muted-foreground",
              )}
            >
              {temSaldo ? "Saldo ativo" : "Sem saldo"}
            </Badge>
          </div>

          <div className="mt-3">
            <p
              className={cn(
                "text-3xl font-bold tracking-tight tabular-nums sm:text-4xl",
                temSaldo
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-foreground",
              )}
            >
              {moeda.format(saldo)}
            </p>
            <p className="mt-2 max-w-xl text-xs leading-relaxed text-muted-foreground sm:text-sm">
              Disponível na carteira para abater ou quitar cobranças de ordens de serviço
              e vendas deste cliente, sem necessidade de movimentação bancária.
            </p>
          </div>
        </div>

        {/* Ações Financeiras */}
        {podeAjustar && (
          <div className="flex shrink-0 flex-col gap-2 pt-1 sm:flex-row sm:items-center">
            <Button
              type="button"
              className="min-h-11 w-full gap-2 px-4 font-medium shadow-xs sm:min-h-10 sm:w-auto"
              onClick={onAdicionar}
            >
              <Plus className="size-4" aria-hidden="true" />
              Adicionar crédito
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={saldo <= 0}
              className="min-h-11 w-full gap-2 px-4 font-medium sm:min-h-10 sm:w-auto"
              onClick={onRemover}
              title={saldo <= 0 ? "Cliente não possui saldo para ser removido" : undefined}
            >
              <ArrowDownLeft className="size-4" aria-hidden="true" />
              Remover crédito
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
