// src/app/(app)/(pages)/ordens/components/orcamento/componentes/campo-quantidade.tsx
"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Minus, Plus } from "lucide-react";

const toNum = (v: any) => (v === null || v === undefined || isNaN(+v) ? 0 : +v);

export function CampoQuantidade({
  value,
  onChange,
  min = 0,
  step = 1,
  className = "",
  compact = false,
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  step?: number;
  className?: string;
  compact?: boolean;
}) {
  const dec = () => onChange(Math.max(min, toNum(value) - step));
  const inc = () => onChange(toNum(value) + step);

  return (
    <div className={`flex items-center justify-center gap-1 ${className}`}>
      <Button
        type="button"
        size="icon"
        variant="outline"
        className={compact ? "h-8 w-7" : "h-8 w-8"}
        onClick={dec}
      >
        <Minus className="h-3.5 w-3.5" />
      </Button>
      <Input
        type="number"
        inputMode="numeric"
        className={compact ? "h-8 w-12 px-1 text-center" : "h-8 w-20 text-center"}
        value={String(value)}
        onChange={(e) => onChange(toNum(e.target.value || 0))}
        min={min}
        step={step}
      />
      <Button
        type="button"
        size="icon"
        variant="outline"
        className={compact ? "h-8 w-7" : "h-8 w-8"}
        onClick={inc}
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
