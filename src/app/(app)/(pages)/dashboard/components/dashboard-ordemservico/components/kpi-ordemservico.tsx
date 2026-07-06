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
    <div className={cn("rounded-lg border p-3", className)}>
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        {Icon ? <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> : null}
      </div>
      <div className="mt-1 md:text-2xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}
