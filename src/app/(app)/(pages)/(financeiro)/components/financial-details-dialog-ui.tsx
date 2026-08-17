import type { ReactNode } from "react";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  ReceiptText,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import formatarEmReal from "@/utils/formatarEmReal";
import { cn } from "@/lib/utils";
import { Metodo_pagamento } from "../fluxodecaixa/types";
import { formatPaymentMethodLabel } from "@/lib/payment-methods";
import { usePaymentMethodOptions } from "@/hooks/use-payment-method-options";

export const financialDialogContentClass =
  "h-dvh w-[100svw] max-w-[100svw] gap-0 overflow-hidden rounded-none border-foreground/20 p-0 shadow-2xl sm:h-[calc(100dvh-2rem)] sm:max-h-none sm:w-[95vw] sm:max-w-[1100px] sm:rounded-lg";

export const financialTabListClass =
  "flex h-auto w-full justify-start overflow-x-auto rounded-none border border-border bg-background p-0";

export const financialTabTriggerClass =
  "group relative h-11 min-w-fit flex-1 shrink-0 rounded-none border-r border-border px-4 text-xs font-bold uppercase tracking-[0.06em] text-muted-foreground shadow-none transition-colors last:border-r-0 hover:bg-muted/50 hover:text-foreground data-[state=active]:border-b-2 data-[state=active]:border-b-primary data-[state=active]:bg-primary/10 data-[state=active]:text-primary";

export function FinancialDialogHeader({
  entity,
  entityId,
  description,
}: {
  entity: string;
  entityId: number;
  description: ReactNode;
}) {
  return (
    <DialogHeader className="relative shrink-0 overflow-hidden border-b border-border bg-card px-5 py-4 pr-12 text-left before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-primary sm:px-6 sm:pr-14">
      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
        Central financeira
      </p>
      <DialogTitle className="text-base font-bold uppercase tracking-[0.06em] text-foreground sm:text-lg">
        {entity} <span className="text-primary">#{entityId}</span>
        <span className="ml-1 text-xs font-normal tracking-normal text-muted-foreground sm:text-sm">
          | Pagamentos
        </span>
      </DialogTitle>
      <DialogDescription className="text-xs leading-relaxed sm:text-sm">
        {description}
      </DialogDescription>
    </DialogHeader>
  );
}

export function FinancialDialogLoadingState({ label }: { label: string }) {
  return (
    <>
      <DialogHeader className="sr-only">
        <DialogTitle>{label}</DialogTitle>
        <DialogDescription>Carregando informações financeiras.</DialogDescription>
      </DialogHeader>
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 bg-muted/25">
        <div className="flex size-11 items-center justify-center border border-border bg-background text-primary shadow-sm">
          <Loader2 className="size-5 animate-spin" aria-hidden="true" />
        </div>
        <div className="text-center">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-foreground">
            Carregando
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{label}</p>
        </div>
      </div>
    </>
  );
}

function FinancialMetric({
  label,
  value,
  prefix,
  tone = "default",
  prominent = false,
  className,
}: {
  label: string;
  value: number;
  prefix?: string;
  tone?: "default" | "primary" | "paid" | "debt";
  prominent?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "min-w-0 border-border px-3 py-2.5",
        prominent && "bg-muted/20 py-3",
        className,
      )}
    >
      <p className="truncate text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground sm:text-[10px]">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 truncate text-xs font-semibold tabular-nums text-foreground sm:text-sm",
          prominent && "text-sm sm:text-base",
          tone === "primary" && "text-primary",
          tone === "paid" && "text-blue-600 dark:text-blue-400",
          tone === "debt" && "text-destructive",
        )}
        title={`${prefix ?? ""}${formatarEmReal(value)}`}
      >
        {prefix}
        {formatarEmReal(value)}
      </p>
    </div>
  );
}

export function FinancialSummaryFooter({
  subtotal,
  discount,
  freight,
  surcharge,
  total,
  paid,
  debt,
  paidLabel = "Total pago",
}: {
  subtotal: number;
  discount: number;
  freight: number;
  surcharge: number;
  total: number;
  paid: number;
  debt: number;
  paidLabel?: string;
}) {
  return (
    <DialogFooter className="block shrink-0 border-t border-border bg-card p-0">
      <section aria-label="Resumo financeiro" className="w-full">
        <h2 className="sr-only">Resumo financeiro</h2>
        <div className="grid grid-cols-3 divide-x divide-border border-b border-border">
          <FinancialMetric label="Total a pagar" value={total} tone="primary" prominent />
          <FinancialMetric label={paidLabel} value={paid} tone="paid" prominent />
          <FinancialMetric label="Saldo devedor" value={debt} tone="debt" prominent />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4">
          <FinancialMetric label="Subtotal" value={subtotal} className="border-r border-b sm:border-b-0" />
          <FinancialMetric label="Desconto" value={discount} prefix="- " className="border-b sm:border-r sm:border-b-0" />
          <FinancialMetric label="Frete" value={freight} prefix="+ " className="border-r" />
          <FinancialMetric label="Acréscimo financeiro" value={surcharge} prefix="+ " />
        </div>
      </section>
    </DialogFooter>
  );
}

export function FinancialTransactionsPanel({
  count,
  loading,
  onReload,
  action,
  status,
  toolbar,
  footer,
  children,
}: {
  count: number;
  loading: boolean;
  onReload: () => void;
  action: ReactNode;
  status?: ReactNode;
  toolbar?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden border border-border bg-card shadow-sm">
      <header className="flex flex-col gap-3 border-b border-border bg-muted/25 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center border border-border bg-background text-primary">
            <ReceiptText className="size-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold uppercase tracking-[0.08em] text-foreground">
                Transações
              </h2>
              <span className="border border-border bg-background px-2 py-0.5 text-[10px] font-bold tabular-nums text-muted-foreground">
                {count}
              </span>
              {status}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Histórico de recebimentos vinculados a este documento.
            </p>
          </div>
        </div>

        <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 flex-1 rounded-none sm:flex-none"
            disabled={loading}
            onClick={onReload}
          >
            <RefreshCw
              className={cn("size-3.5", loading && "animate-spin")}
              aria-hidden="true"
            />
            Recarregar
          </Button>
          <div className="flex-1 sm:flex-none">{action}</div>
        </div>
      </header>
      {toolbar ? (
        <div className="border-b border-border bg-background px-3 py-3 sm:px-4">
          {toolbar}
        </div>
      ) : null}
      <div className="min-w-0 overflow-x-auto">{children}</div>
      {footer ? (
        <div className="border-t border-border bg-muted/20 px-3 py-2.5 sm:px-4">
          {footer}
        </div>
      ) : null}
    </section>
  );
}

export type FinancialTransactionFilters = {
  search: string;
  method: string;
  dateFrom: string;
  dateTo: string;
};

export const EMPTY_FINANCIAL_TRANSACTION_FILTERS: FinancialTransactionFilters = {
  search: "",
  method: "",
  dateFrom: "",
  dateTo: "",
};

export function FinancialStatusBadge({
  paid,
  debt,
}: {
  paid: number;
  debt: number;
}) {
  const status =
    debt <= 0 && paid > 0
      ? { label: "Quitado", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" }
      : paid > 0
        ? { label: "Parcial", className: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300" }
        : { label: "Em aberto", className: "border-border bg-background text-muted-foreground" };

  return (
    <span
      className={cn(
        "border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em]",
        status.className,
      )}
    >
      {status.label}
    </span>
  );
}

export function FinancialTransactionFiltersBar({
  value,
  onChange,
  onApply,
  onClear,
  loading,
}: {
  value: FinancialTransactionFilters;
  onChange: (value: FinancialTransactionFilters) => void;
  onApply: () => void;
  onClear: () => void;
  loading: boolean;
}) {
  const { options: metodosPagamento } = usePaymentMethodOptions();

  const hasFilters = Boolean(
    value.search.trim() || value.method || value.dateFrom || value.dateTo,
  );

  return (
    <div className="grid gap-2 md:grid-cols-[minmax(220px,1fr)_180px_150px_150px_auto]">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={value.search}
          onChange={(event) => onChange({ ...value, search: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter") onApply();
          }}
          className="h-9 rounded-none pl-9"
          placeholder="Buscar descrição, documento ou pagador"
          aria-label="Buscar transações"
        />
      </div>

      <Select
        value={value.method || "ALL"}
        onValueChange={(method) =>
          onChange({ ...value, method: method === "ALL" ? "" : method })
        }
      >
        <SelectTrigger className="h-9 rounded-none" aria-label="Filtrar por método">
          <SelectValue placeholder="Todos os métodos" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">Todos os métodos</SelectItem>
          {metodosPagamento.map((method) => (
            <SelectItem key={method.value} value={method.value}>
              {method.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Input
        type="date"
        value={value.dateFrom}
        onChange={(event) => onChange({ ...value, dateFrom: event.target.value })}
        className="h-9 rounded-none"
        aria-label="Data inicial"
      />
      <Input
        type="date"
        value={value.dateTo}
        onChange={(event) => onChange({ ...value, dateTo: event.target.value })}
        className="h-9 rounded-none"
        aria-label="Data final"
      />

      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          className="h-9 flex-1 rounded-none md:flex-none"
          onClick={onApply}
          disabled={loading}
        >
          Filtrar
        </Button>
        {hasFilters ? (
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="size-9 shrink-0 rounded-none"
            onClick={onClear}
            disabled={loading}
            aria-label="Limpar filtros"
            title="Limpar filtros"
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function FinancialTransactionPagination({
  page,
  totalPages,
  total,
  pageCount,
  limit,
  loading,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageCount: number;
  limit: number;
  loading: boolean;
  onPageChange: (page: number) => void;
}) {
  const safeTotalPages = Math.max(1, totalPages || 1);
  const start = total === 0 ? 0 : (page - 1) * limit + 1;
  const end = total === 0 ? 0 : start + pageCount - 1;

  return (
    <div className="flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <p className="tabular-nums">
        Exibindo <strong className="text-foreground">{start}–{end}</strong> de{" "}
        <strong className="text-foreground">{total}</strong> lançamentos
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="size-8 rounded-none"
          onClick={() => onPageChange(page - 1)}
          disabled={loading || page <= 1}
          aria-label="Página anterior"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
        </Button>
        <span className="min-w-24 text-center font-medium tabular-nums text-foreground">
          Página {page} de {safeTotalPages}
        </span>
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="size-8 rounded-none"
          onClick={() => onPageChange(page + 1)}
          disabled={loading || page >= safeTotalPages || total === 0}
          aria-label="Próxima página"
        >
          <ChevronRight className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
