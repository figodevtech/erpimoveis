"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type KpiProps = {
  label: string;
  value: string | number;
  icon?: React.ComponentType<{ className?: string }>;
  className?: string;
};

export default function Kpi({ label, value, icon: Icon, className }: KpiProps) {
  return (
    <div className={cn("dashboard-kpi min-h-20 p-3 sm:min-h-24 sm:p-3.5", className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-2 text-xs leading-tight text-muted-foreground sm:text-sm">{label}</p>
        {Icon ? <span className="flex size-7 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary sm:size-8"><Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden="true" /></span> : null}
      </div>
      <div className="relative z-10 mt-2 break-words text-lg font-semibold tracking-tight sm:text-xl xl:text-2xl">{value}</div>
    </div>
  );
}
