"use client";

import type { ReactNode } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, Check, LockKeyhole, type LucideIcon } from "lucide-react";
import { DialogFooter } from "@/components/ui/dialog";

/**
 * Casca de etapas dos anúncios Mercado Livre, usada tanto para criar quanto para
 * editar. Só o miolo e o rodapé mudam entre os dois fluxos; a navegação, o
 * progresso e o bloqueio de etapas seguintes são os mesmos.
 */

export type ListingStepDefinition<T extends string> = {
  value: T;
  title: string;
  short: string;
  description: string;
  icon: LucideIcon;
};

type Props<T extends string> = {
  steps: ListingStepDefinition<T>[];
  step: T;
  onStepChange: (step: T) => void;
  /** Uma etapa inválida impede o avanço para as seguintes. */
  stepValidity: Record<T, boolean>;
  /** Quantas pendências cada etapa tem, para marcar o círculo em vermelho. */
  issueCountByStep?: Partial<Record<T, number>>;
  /** Aviso fixo entre o cabeçalho e as etapas. */
  banner?: ReactNode;
  footerNote: ReactNode;
  footerActions: ReactNode;
  children: ReactNode;
};

export function ListingStepper<T extends string>({
  steps,
  step,
  onStepChange,
  stepValidity,
  issueCountByStep = {},
  banner,
  footerNote,
  footerActions,
  children,
}: Props<T>) {
  const currentIndex = Math.max(
    steps.findIndex((item) => item.value === step),
    0,
  );
  const currentStep = steps[currentIndex];
  const progress = ((currentIndex + 1) / steps.length) * 100;

  function canOpenStep(index: number) {
    if (index <= currentIndex) return true;
    return steps.slice(0, index).every((item) => stepValidity[item.value]);
  }

  return (
    <Tabs
      value={step}
      onValueChange={(value) => {
        const index = steps.findIndex((item) => item.value === value);
        if (canOpenStep(index)) onStepChange(value as T);
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="shrink-0 border-b bg-gradient-to-b from-muted/35 to-background px-3 py-2 sm:px-6 sm:py-3">
        <div className="mb-2 flex items-end justify-between gap-4 px-1">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">
              Etapa {currentIndex + 1} de {steps.length}
            </p>
            <p className="truncate text-sm font-semibold leading-tight text-foreground">{currentStep?.title}</p>
          </div>
          <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
            {Math.round(progress)}% concluído
          </span>
        </div>

        <div className="mb-2 h-1 overflow-hidden rounded-full bg-muted shadow-inner">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#3483fa] to-[#5b9dff] transition-[width] duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* As colunas saem do próprio array: acrescentar uma etapa não quebra a linha. */}
        <TabsList
          className="relative grid h-auto w-full gap-0.5 border-0 bg-transparent p-0 shadow-none sm:gap-2 dark:bg-transparent"
          style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
        >
          {/* A linha vai do centro do primeiro ao centro do último passo. */}
          <div
            aria-hidden="true"
            className="absolute top-[17px] h-0.5 bg-border sm:top-[19px]"
            style={{ left: `${50 / steps.length}%`, right: `${50 / steps.length}%` }}
          >
            <div
              className="h-full bg-emerald-500 transition-[width] duration-500 ease-out"
              style={{ width: `${steps.length > 1 ? (currentIndex / (steps.length - 1)) * 100 : 100}%` }}
            />
          </div>
          {steps.map((item, index) => {
            const complete = stepValidity[item.value] && index < currentIndex;
            const active = item.value === step;
            const hasError = index <= currentIndex && !stepValidity[item.value] && Boolean(issueCountByStep[item.value]);
            const accessible = canOpenStep(index);
            const StepIcon = item.icon;
            return (
              <TabsTrigger
                key={item.value}
                value={item.value}
                disabled={!accessible}
                className="group relative z-10 h-auto min-w-0 flex-col gap-1 rounded-lg border border-transparent bg-transparent px-0.5 py-1 text-muted-foreground sm:px-2 shadow-none transition-all duration-200 hover:-translate-y-0.5 hover:bg-background hover:shadow-sm data-[state=active]:border-primary/25 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-md disabled:opacity-70 dark:data-[state=active]:border-primary/30 dark:data-[state=active]:bg-card"
              >
                <span
                  className={`relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 bg-background ring-2 ring-background sm:h-8 sm:w-8 transition-all duration-300 ${
                    complete
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : active
                        ? "scale-110 border-primary bg-primary text-primary-foreground shadow-md shadow-primary/25"
                        : hasError
                          ? "border-destructive bg-destructive text-destructive-foreground"
                          : "border-border bg-background text-muted-foreground"
                  }`}
                >
                  {complete ? (
                    <Check className="h-4 w-4 stroke-[3]" />
                  ) : hasError ? (
                    <AlertTriangle className="h-4 w-4" />
                  ) : !accessible ? (
                    <LockKeyhole className="h-3.5 w-3.5" />
                  ) : (
                    <StepIcon className="h-4 w-4" />
                  )}
                  {active ? (
                    <span className="absolute -right-1 -top-1 h-2.5 w-2.5 animate-pulse rounded-full border-2 border-background bg-[#ffe600]" />
                  ) : null}
                </span>
                <span className="min-w-0 text-center">
                  <span className="block truncate text-[10px] font-semibold leading-tight sm:text-xs">{item.short}</span>
                  <span className="mt-0.5 hidden truncate text-[10px] font-normal text-muted-foreground lg:block">
                    {complete
                      ? "Concluído"
                      : hasError
                        ? "Requer atenção"
                        : active
                          ? item.description
                          : accessible
                            ? "Disponível"
                            : "Bloqueado"}
                  </span>
                </span>
              </TabsTrigger>
            );
          })}
        </TabsList>
      </div>

      {banner}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-4 py-4 sm:px-6 sm:py-5">{children}</div>
      </div>

      <DialogFooter className="shrink-0 items-center gap-3 border-t bg-muted/20 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:justify-between sm:px-6">
        {footerNote}
        <div className="flex w-full flex-wrap justify-end gap-2 sm:w-auto">{footerActions}</div>
      </DialogFooter>
    </Tabs>
  );
}
