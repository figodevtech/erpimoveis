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
    <div className={cn("dashboard-kpi min-h-24 p-3.5", className)}>
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        {Icon ? <span className="flex size-8 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="h-4 w-4" aria-hidden="true" /></span> : null}
      </div>
      <div className="relative z-10 mt-2 text-xl font-semibold tracking-tight xl:text-2xl">{value}</div>
    </div>
  );
}
