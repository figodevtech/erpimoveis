"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type ChartCardProps = {
  title: string;
  description?: string;
  badge?: string;
  badgeIcon?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
};

export default function ChartCard({ title, description, badge, badgeIcon, className, children }: ChartCardProps) {
  return (
    <div className={cn("dashboard-surface p-4 sm:p-5", className)}>
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold tracking-tight">{title}</p>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {badge ? (
          <Badge variant="secondary" className="gap-1 whitespace-nowrap border-0 bg-primary/8 text-primary shadow-none">
            {badgeIcon}
            {badge}
          </Badge>
        ) : null}
      </div>
      {children}
    </div>
  );
}
