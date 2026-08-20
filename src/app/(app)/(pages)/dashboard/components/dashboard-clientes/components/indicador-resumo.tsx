"use client";

import * as React from "react";
import type { StatusCliente } from "../lib/types";
import { COR_STATUS } from "../lib/status";

export default function IndicadorResumo({
  label,
  valor,
  icone: Icone,
  corStatus,
}: {
  label: string;
  valor: number | string;
  icone?: React.ComponentType<{ className?: string }>;
  corStatus?: StatusCliente;
}) {
  return (
    <div className="dashboard-kpi min-h-24 p-3.5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground sm:text-sm">{label}</p>
        {Icone ? <span className="flex size-8 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icone className="h-3.5 w-3.5 sm:h-4 sm:w-4" /></span> : null}
      </div>
      <div className="relative z-10 mt-2 text-lg font-semibold tracking-tight sm:text-xl md:text-2xl">{valor}</div>
      {corStatus && <div className="mt-1.5 h-1 w-full rounded-full sm:mt-2 sm:h-1.5" style={{ background: COR_STATUS[corStatus] }} aria-hidden />}
    </div>
  );
}
