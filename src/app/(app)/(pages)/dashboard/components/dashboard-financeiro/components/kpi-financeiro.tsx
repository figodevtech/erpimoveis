import * as React from "react";
import clsx from "clsx";

type Props = {
  rotulo: string;
  valor: string;
  valorNumero?: number;
  Icone?: React.ComponentType<{ className?: string }>;
  destaque?: "positivo" | "negativo";
};

export function KpiFinanceiro({ rotulo, valor, valorNumero, Icone, destaque }: Props) {
  const abs = Math.abs(Number(valorNumero ?? 0));
  const temValor = abs > 0;

  const corBarra = !temValor
    ? "bg-transparent"
    : destaque === "positivo"
    ? "bg-emerald-500/80"
    : destaque === "negativo"
    ? "bg-red-500/80"
    : "bg-muted";

  return (
    <div className="dashboard-kpi min-h-20 p-3 sm:min-h-24 sm:p-3.5">
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-2 text-xs leading-tight text-muted-foreground sm:text-sm">{rotulo}</p>
        {Icone ? <span className="flex size-7 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary sm:size-8"><Icone className="h-3.5 w-3.5 sm:h-4 sm:w-4" /></span> : null}
      </div>

      <div className="relative z-10 mt-2 break-words text-base font-semibold tracking-tight sm:text-xl md:text-2xl">{valor}</div>

      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted/60">
        <div
          className={clsx("h-full rounded-full transition-all", corBarra)}
          style={{ width: temValor ? "66%" : "0%" }}
        />
      </div>
    </div>
  );
}
