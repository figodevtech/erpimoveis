"use client";

import * as React from "react";
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type KpiProps = {
  label: string;
  value: string | number;
  icon?: React.ComponentType<{ className?: string }>;
  /** Explicação de como o número é calculado. Vira um tooltip no rótulo. */
  hint?: React.ReactNode;
  className?: string;
};

export default function Kpi({ label, value, icon: Icon, hint, className }: KpiProps) {
  const rotulo = <p className="line-clamp-2 text-xs leading-tight text-muted-foreground sm:text-sm">{label}</p>;

  return (
    <div className={cn("dashboard-kpi min-h-20 p-3 sm:min-h-24 sm:p-3.5", className)}>
      <div className="flex items-start justify-between gap-2">
        {hint ? (
          <Tooltip>
            <TooltipTrigger asChild>
              {/* botão, e não só hover, para o tooltip abrir também no toque */}
              <button
                type="button"
                aria-label={`Como "${label}" é calculado`}
                className="flex min-w-0 items-start gap-1 text-left hover:cursor-help focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm"
              >
                {rotulo}
                <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-72 text-xs leading-relaxed">
              {hint}
            </TooltipContent>
          </Tooltip>
        ) : (
          rotulo
        )}
        {Icon ? <span className="flex size-7 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary sm:size-8"><Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden="true" /></span> : null}
      </div>
      <div className="relative z-10 mt-2 break-words text-lg font-semibold tracking-tight sm:text-xl xl:text-2xl">{value}</div>
    </div>
  );
}
