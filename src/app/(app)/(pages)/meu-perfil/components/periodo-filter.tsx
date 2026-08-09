"use client";

import { CalendarIcon, CalendarRange } from "lucide-react";
import { endOfMonth, endOfWeek, format, startOfMonth, startOfWeek, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { intervalo, periodoDesteMes } from "../lib/format";
import type { Periodo } from "../types";

type Props = { periodo: Periodo; onChange: (periodo: Periodo) => void };

const OPCOES: Array<{ chave: string; rotulo: string; calcular: () => Periodo }> = [
  {
    chave: "semana",
    rotulo: "Esta semana",
    calcular: () =>
      intervalo(startOfWeek(new Date(), { locale: ptBR }), endOfWeek(new Date(), { locale: ptBR })),
  },
  { chave: "mes", rotulo: "Este mês", calcular: periodoDesteMes },
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

function dataDoIso(valor: string): Date | undefined {
  const [ano, mes, dia] = valor.split("-").map(Number);
  if (!ano || !mes || !dia) return undefined;
  return new Date(ano, mes - 1, dia);
}

function SeletorData({
  id,
  rotulo,
  valor,
  desabilitar,
  onChange,
}: {
  id: string;
  rotulo: string;
  valor: string;
  desabilitar?: (data: Date) => boolean;
  onChange: (valor: string) => void;
}) {
  const data = dataDoIso(valor);

  return (
    <div className="flex min-w-0 items-center gap-2">
      <Label htmlFor={id} className="shrink-0 text-xs text-muted-foreground">{rotulo}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            id={id}
            variant="outline"
            className={cn(
              "h-9 min-w-0 flex-1 justify-start px-3 text-left font-normal sm:w-[10.5rem] sm:flex-none",
              !data && "text-muted-foreground",
            )}
          >
            <CalendarIcon className="mr-2 size-4" aria-hidden />
            {data ? format(data, "dd/MM/yyyy") : "Selecione"}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="single"
            selected={data}
            onSelect={(novaData) => onChange(novaData ? format(novaData, "yyyy-MM-dd") : "")}
            disabled={desabilitar}
            locale={ptBR}
            initialFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function PeriodoFilter({ periodo, onChange }: Props) {
  const limiteDe = dataDoIso(periodo.ate);
  const limiteAte = dataDoIso(periodo.de);

  return (
    <section
      aria-label="Filtro de período"
      className="flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-end sm:justify-between"
    >
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex items-center gap-2 text-sm text-muted-foreground sm:mb-2">
          <CalendarRange className="size-4" aria-hidden />
          <span>Período</span>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-end">
          <SeletorData
            id="periodo-de"
            rotulo="De"
            valor={periodo.de}
            desabilitar={limiteDe ? (data) => data > limiteDe : undefined}
            onChange={(de) => onChange({ ...periodo, de })}
          />
          <SeletorData
            id="periodo-ate"
            rotulo="Até"
            valor={periodo.ate}
            desabilitar={limiteAte ? (data) => data < limiteAte : undefined}
            onChange={(ate) => onChange({ ...periodo, ate })}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1.5 rounded-xl border bg-muted/40 p-1 sm:flex sm:flex-wrap">
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
                "h-8 rounded-xl border border-transparent px-3 text-xs font-medium transition-all",
                "hover:cursor-pointer hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                selecionado
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground",
              )}
            >
              {opcao.rotulo}
            </button>
          );
        })}
      </div>
    </section>
  );
}
