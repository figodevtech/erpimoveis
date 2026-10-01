"use client";

import { forwardRef, type ComponentProps, type ReactNode } from "react";
import { CalendarDays, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";

type ReportTriggerProps = Omit<ComponentProps<typeof Button>, "title"> & {
  icon: ReactNode;
  title: string;
  description: string;
  tone?: string;
};

export const ReportTrigger = forwardRef<HTMLButtonElement, ReportTriggerProps>(
  function ReportTrigger(
    {
      icon,
      title,
      description,
      tone = "bg-primary/10 text-primary",
      className = "",
      ...buttonProps
    },
    ref,
  ) {
    return (
    <Button
      ref={ref}
      variant="outline"
      className={`group h-auto min-h-24 flex-col items-start justify-start gap-2 bg-transparent p-4 text-left hover:cursor-pointer ${className}`}
      {...buttonProps}
    >
      <div className="flex w-full items-center gap-2">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone}`}>{icon}</div>
        <span className="min-w-0 flex-1 font-medium">{title}</span>
      </div>
      <p className="line-clamp-2 whitespace-normal text-xs leading-relaxed text-muted-foreground">{description}</p>
    </Button>
    );
  },
);

export function ReportPeriod({
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  previousMonth = false,
}: {
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  /** Mostra o atalho "Mês anterior", para fechamentos feitos no início do mês. */
  previousMonth?: boolean;
}) {
  const invalid = Boolean(dateFrom && dateTo && dateFrom > dateTo);
  // `offset` 0 é o mês corrente, -1 o anterior; o Date resolve a virada de ano.
  const setMonth = (offset: number) => {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const year = first.getFullYear();
    const month = String(first.getMonth() + 1).padStart(2, "0");
    const lastDay = new Date(year, first.getMonth() + 1, 0).getDate();
    onDateFromChange(`${year}-${month}-01`);
    onDateToChange(`${year}-${month}-${String(lastDay).padStart(2, "0")}`);
  };
  const clear = () => {
    onDateFromChange("");
    onDateToChange("");
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Label>Período</Label>
          <p className="text-xs text-muted-foreground">Deixe em branco para considerar todo o histórico.</p>
        </div>
        <div className="flex gap-1">
          {previousMonth && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setMonth(-1)}>
              <CalendarDays className="mr-1.5 h-3.5 w-3.5" />Mês anterior
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" onClick={() => setMonth(0)}>
            <CalendarDays className="mr-1.5 h-3.5 w-3.5" />Este mês
          </Button>
          {(dateFrom || dateTo) && (
            <Button type="button" variant="ghost" size="sm" onClick={clear}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />Limpar
            </Button>
          )}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Data inicial</Label>
          <DatePicker value={dateFrom} onChange={onDateFromChange} placeholder="Data inicial" />
        </div>
        <div className="space-y-2">
          <Label>Data final</Label>
          <DatePicker value={dateTo} onChange={onDateToChange} placeholder="Data final" />
        </div>
      </div>
      {invalid && <p className="text-xs text-destructive">A data inicial não pode ser posterior à data final.</p>}
    </div>
  );
}

export function ReportFiltersPanel({ children }: { children: ReactNode }) {
  return <div className="space-y-5 rounded-xl border bg-card p-4">{children}</div>;
}

export function isInvalidPeriod(dateFrom: string, dateTo: string) {
  return Boolean(dateFrom && dateTo && dateFrom > dateTo);
}
