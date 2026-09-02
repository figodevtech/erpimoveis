"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import Dica from "./dica";

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
            <Dica rotulo={title} conteudo={hint}>
              {titulo}
            </Dica>
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
