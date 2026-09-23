"use client";

import * as React from "react";
import { ptBR } from "date-fns/locale";
import { Calendar as CalendarIcon, SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import { formatarDataCurta } from "./datas";

export type SheetPeriodoFiltrosProps = {
  /** Nomeia o que está sendo filtrado — é a única coisa que muda entre dashboards. */
  titulo: string;
  aberto: boolean;
  aoMudarAberto: (aberto: boolean) => void;
  dataInicio: Date | null;
  dataFim: Date | null;
  aoMudarDataInicio: (data?: Date) => void;
  aoMudarDataFim: (data?: Date) => void;
  aoLimpar: () => void;
};

/**
 * O intervalo de datas de um dashboard.
 *
 * Dois calendários `single` em vez de um `range`: o usuário quase sempre já sabe
 * as duas pontas e digitar mês a mês num range é pior. "Aplicar filtros" só
 * fecha a gaveta — cada escolha já vale na hora.
 */
export default function SheetPeriodoFiltros({
  titulo,
  aberto,
  aoMudarAberto,
  dataInicio,
  dataFim,
  aoMudarDataInicio,
  aoMudarDataFim,
  aoLimpar,
}: SheetPeriodoFiltrosProps) {
  const campos = [
    { rotulo: "Data inicial", valor: dataInicio, aoSelecionar: aoMudarDataInicio },
    { rotulo: "Data final", valor: dataFim, aoSelecionar: aoMudarDataFim },
  ];

  return (
    <Sheet open={aberto} onOpenChange={aoMudarAberto}>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 shrink-0 gap-1 px-2 text-[11px] hover:cursor-pointer sm:px-3 sm:text-sm"
          aria-label={titulo}
          title="Filtrar período"
        >
          <SlidersHorizontal className="h-4 w-4" />
          Filtros
        </Button>
      </SheetTrigger>

      <SheetContent>
        <SheetHeader>
          <SheetTitle>{titulo}</SheetTitle>
        </SheetHeader>

        <div className="grid flex-1 auto-rows-min gap-6 px-4">
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground">Intervalo de datas</p>
            <div className="flex flex-col gap-3 sm:flex-row">
              {campos.map((campo) => (
                <div key={campo.rotulo} className="flex-1 space-y-1">
                  <p className="text-[11px] text-muted-foreground">{campo.rotulo}</p>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "h-9 w-full justify-start text-left text-xs font-normal",
                          !campo.valor && "text-muted-foreground",
                        )}
                      >
                        <CalendarIcon className="mr-1.5 h-4 w-4" />
                        {campo.valor ? formatarDataCurta(campo.valor) : "Selecione"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={campo.valor ?? undefined}
                        onSelect={campo.aoSelecionar}
                        initialFocus
                        locale={ptBR}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-2 flex justify-between gap-2">
            <Button type="button" variant="outline" onClick={aoLimpar}>
              Limpar filtros
            </Button>
            <SheetClose asChild>
              <Button type="button">Aplicar filtros</Button>
            </SheetClose>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
