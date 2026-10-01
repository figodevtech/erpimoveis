"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Customer } from "../../../types";
import { formatCpfCnpj } from "../utils";
import { moeda } from "./types";

type CreditBalanceCardProps = {
  customer: Customer;
  saldo: number;
  podeAjustar: boolean;
  onAdicionar: () => void;
  onRemover: () => void;
};

/** Cabeçalho do extrato: de quem é a carteira, quanto tem e o que dá para fazer. */
export function CreditBalanceCard({
  customer,
  saldo,
  podeAjustar,
  onAdicionar,
  onRemover,
}: CreditBalanceCardProps) {
  return (
    <section aria-label="Saldo de crédito do cliente" className="px-4 pb-5 pt-4 sm:px-6">
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-3 text-xs text-muted-foreground">
        <span className="truncate font-medium text-foreground" title={customer.nomerazaosocial}>
          {customer.nomerazaosocial}
        </span>
        <span className="tabular-nums">{formatCpfCnpj(customer.cpfcnpj, customer.tipopessoa)}</span>
      </p>

      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-[13px] text-muted-foreground">Saldo em carteira</p>
          <p
            className={cn(
              "mt-0.5 text-3xl font-semibold leading-none tracking-tight tabular-nums",
              saldo > 0 ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {moeda.format(saldo)}
          </p>
          <p className="mt-2 max-w-[60ch] text-[13px] text-muted-foreground">
            Abate cobranças de OS e vendas deste cliente sem passar pelo banco.
          </p>
        </div>

        {podeAjustar && (
          <div className="flex shrink-0 flex-col-reverse gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              disabled={saldo <= 0}
              className="min-h-10"
              onClick={onRemover}
              title={saldo <= 0 ? "Cliente não possui saldo para ser removido" : undefined}
            >
              Remover crédito
            </Button>
            <Button type="button" className="min-h-10 gap-1.5" onClick={onAdicionar}>
              <Plus className="size-4" aria-hidden="true" />
              Adicionar crédito
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
