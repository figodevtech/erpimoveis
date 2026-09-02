"use client";

import * as React from "react";
import { Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type ChartCardProps = {
  title: string;
  description?: string;
  badge?: string;
  badgeIcon?: React.ReactNode;
  /** Explicação de como o gráfico é calculado. Vira um tooltip no título. */
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
};

export default function ChartCard({ title, description, badge, badgeIcon, hint, className, children }: ChartCardProps) {
  const titulo = <p className="dashboard-card-title line-clamp-2">{title}</p>;

  return (
    <div className={cn("dashboard-surface min-w-0 p-3 sm:p-4", className)}>
      <div className="mb-3 flex items-start justify-between gap-2 sm:mb-5 sm:gap-3">
        <div className="min-w-0">
          {hint ? (
            <Tooltip>
              <TooltipTrigger asChild>
                {/* botão, e não só hover, para o tooltip abrir também no toque */}
                <button
                  type="button"
                  aria-label={`Como "${title}" é calculado`}
                  className="flex min-w-0 items-start gap-1 text-left hover:cursor-help focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm"
                >
                  {titulo}
                  <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-72 text-xs leading-relaxed">
                {hint}
              </TooltipContent>
            </Tooltip>
          ) : (
            titulo
          )}
          {description ? <p className="dashboard-card-description line-clamp-2">{description}</p> : null}
        </div>
        {badge ? (
          <Badge variant="secondary" className="hidden shrink-0 gap-1 whitespace-nowrap border-0 bg-primary/8 text-primary shadow-none sm:inline-flex">
            {badgeIcon}
            {badge}
          </Badge>
        ) : null}
      </div>
      {children}
    </div>
  );
}
