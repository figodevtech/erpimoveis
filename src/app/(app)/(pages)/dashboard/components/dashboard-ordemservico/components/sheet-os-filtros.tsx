"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetClose,
} from "@/components/ui/sheet";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { ptBR } from "date-fns/locale";
import { Calendar as CalendarIcon, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatarDataCurta } from "../lib/datas";

export type PropriedadesSheetOsFiltros = {
  aberto: boolean;
  aoMudarAberto: (aberto: boolean) => void;
  dataInicio: Date | null;
  dataFim: Date | null;
  aoMudarDataInicio: (data?: Date) => void;
  aoMudarDataFim: (data?: Date) => void;
  aoLimpar: () => void;
};

export default function SheetOsFiltros({
  aberto,
  aoMudarAberto,
  dataInicio,
  dataFim,
  aoMudarDataInicio,
  aoMudarDataFim,
  aoLimpar,
}: PropriedadesSheetOsFiltros) {
  return (
    <Sheet open={aberto} onOpenChange={aoMudarAberto}>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 shrink-0 gap-1 px-2 text-[11px] hover:cursor-pointer sm:px-3 sm:text-sm"
          aria-label="Filtros de ordens de serviço"
          title="Filtrar período"
        >
          <SlidersHorizontal className="h-4 w-4" />
          Filtros
        </Button>
      </SheetTrigger>

      <SheetContent>
        <SheetHeader>
          <SheetTitle>Filtros de ordens de serviço</SheetTitle>
        </SheetHeader>

        <div className="grid flex-1 auto-rows-min gap-6 px-4">
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground">Intervalo de datas</p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="flex-1 space-y-1">
                <p className="text-[11px] text-muted-foreground">Data inicial</p>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "h-9 w-full justify-start text-left text-xs font-normal",
                        !dataInicio && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-1.5 h-4 w-4" />
                      {dataInicio ? formatarDataCurta(dataInicio) : "Selecione"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={dataInicio ?? undefined}
                      onSelect={aoMudarDataInicio}
                      initialFocus
                      locale={ptBR}
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="flex-1 space-y-1">
                <p className="text-[11px] text-muted-foreground">Data final</p>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "h-9 w-full justify-start text-left text-xs font-normal",
                        !dataFim && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-1.5 h-4 w-4" />
                      {dataFim ? formatarDataCurta(dataFim) : "Selecione"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={dataFim ?? undefined}
                      onSelect={aoMudarDataFim}
                      initialFocus
                      locale={ptBR}
                    />
                  </PopoverContent>
                </Popover>
              </div>
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
