// src/app/(app)/(pages)/meu-perfil/components/periodo-filter.tsx
"use client";

import { CalendarRange } from "lucide-react";
import { endOfMonth, endOfWeek, startOfMonth, startOfWeek, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { motion } from "motion/react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { intervalo, periodoDesteMes } from "../lib/format";
import { MOLA } from "../lib/motion";
import type { Periodo } from "../types";

type Props = {
  periodo: Periodo;
  onChange: (periodo: Periodo) => void;
};

const OPCOES: Array<{ chave: string; rotulo: string; calcular: () => Periodo }> = [
  {
    chave: "semana",
    rotulo: "Esta semana",
    // A semana comeca no domingo, seguindo o locale pt-BR ja usado nos
    // calendarios do sistema.
    calcular: () =>
      intervalo(startOfWeek(new Date(), { locale: ptBR }), endOfWeek(new Date(), { locale: ptBR })),
  },
  {
    chave: "mes",
    rotulo: "Este mês",
    calcular: periodoDesteMes,
  },
  {
    chave: "mes-anterior",
    rotulo: "Mês anterior",
    calcular: () => {
      const anterior = subMonths(new Date(), 1);
      return intervalo(startOfMonth(anterior), endOfMonth(anterior));
    },
  },
  { chave: "tudo", rotulo: "Tudo", calcular: () => ({ de: "", ate: "" }) },
];

export function PeriodoFilter({ periodo, onChange }: Props) {
  return (
    <section
      aria-label="Filtro de período"
      className="flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-end sm:justify-between"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex items-center gap-2 text-sm text-muted-foreground sm:mb-2">
          <CalendarRange className="size-4" aria-hidden />
          <span>Período</span>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-end">
          <div className="grid gap-1.5">
            <Label htmlFor="periodo-de" className="text-xs text-muted-foreground">
              De
            </Label>
            <Input
              id="periodo-de"
              type="date"
              className="h-9 w-full sm:w-[10.5rem]"
              value={periodo.de}
              max={periodo.ate || undefined}
              onChange={(e) => onChange({ ...periodo, de: e.target.value })}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="periodo-ate" className="text-xs text-muted-foreground">
              Até
            </Label>
            <Input
              id="periodo-ate"
              type="date"
              className="h-9 w-full sm:w-[10.5rem]"
              value={periodo.ate}
              min={periodo.de || undefined}
              onChange={(e) => onChange({ ...periodo, ate: e.target.value })}
            />
          </div>
        </div>
      </div>

      {/* Os atalhos formam um unico controle segmentado: a pilula do selecionado
          desliza entre eles via layoutId, em vez de piscar de um para o outro. */}
      <div className="flex flex-wrap gap-1 rounded-lg border bg-muted/40 p-1">
        {OPCOES.map((opcao) => {
          const alvo = opcao.calcular();
          const selecionado = periodo.de === alvo.de && periodo.ate === alvo.ate;

          return (
            <button
              key={opcao.chave}
              type="button"
              aria-pressed={selecionado}
              onClick={() => onChange(alvo)}
              className={cn(
                "relative rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                selecionado ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {selecionado && (
                <motion.span
                  layoutId="periodo-atalho-ativo"
                  aria-hidden
                  className="absolute inset-0 rounded-md bg-primary shadow-sm"
                  transition={MOLA}
                />
              )}
              <span className="relative">{opcao.rotulo}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
