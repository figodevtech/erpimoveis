"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

import { mesmoPeriodo, obterMesAnterior, obterMesAtual, type PeriodoDashboard } from "./periodo";

const PRESETS: { chave: string; rotulo: string; rotuloCurto: string; calcular: () => PeriodoDashboard }[] = [
  { chave: "mes-atual", rotulo: "Mês atual", rotuloCurto: "Mês atual", calcular: obterMesAtual },
  { chave: "mes-anterior", rotulo: "Mês anterior", rotuloCurto: "Anterior", calcular: obterMesAnterior },
];

export type PresetsPeriodoProps = {
  dataInicio: Date | null;
  dataFim: Date | null;
  aoAplicar: (periodo: PeriodoDashboard) => void;
  /** Posição no cabeçalho de quem usa; o visual do grupo é daqui. */
  className?: string;
};

/** Atalhos de período. O botão fica marcado quando o filtro já é aquele mês. */
export default function PresetsPeriodo({ dataInicio, dataFim, aoAplicar, className }: PresetsPeriodoProps) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-1 rounded-xl border bg-muted/40 p-0.5 sm:flex-none sm:p-1",
        className,
      )}
    >
      {PRESETS.map((preset) => {
        const alvo = preset.calcular();
        const selecionado = mesmoPeriodo({ inicio: dataInicio ?? undefined, fim: dataFim ?? undefined }, alvo);

        return (
          <button
            key={preset.chave}
            type="button"
            aria-label={preset.rotulo}
            aria-pressed={selecionado}
            onClick={() => aoAplicar(alvo)}
            className={cn(
              "h-6 flex-1 whitespace-nowrap rounded-lg px-2 text-[11px] font-medium transition-all sm:h-8 sm:flex-none sm:px-2.5 sm:text-xs",
              "hover:cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selecionado ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="sm:hidden">{preset.rotuloCurto}</span>
            <span className="hidden sm:inline">{preset.rotulo}</span>
          </button>
        );
      })}
    </div>
  );
}
