"use client";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { ptBR } from "date-fns/locale";
import { CalendarIcon, SlidersHorizontal } from "lucide-react";

export type PaymentListFilters = {
  cliente: string;
  notaNumero: string;
  dataInicio?: Date;
  dataFim?: Date;
  /** Restringe a listagem aos registros criados pelo usuario logado. */
  apenasMinhas?: boolean;
};

type PaymentsFilterSheetProps = {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  filters: PaymentListFilters;
  onFiltersChange: (value: PaymentListFilters) => void;
  onAplicar: () => void;
  onLimpar: () => void;
  showTextFilters?: boolean;
};

export function PaymentsFilterSheet({
  open,
  onOpenChange,
  filters,
  onFiltersChange,
  onAplicar,
  onLimpar,
  showTextFilters = true,
}: PaymentsFilterSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1 hover:cursor-pointer">
          <SlidersHorizontal className="h-4 w-4" />
          Filtros
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Filtros da listagem</SheetTitle>
        </SheetHeader>

        <div className="grid flex-1 auto-rows-min gap-6 px-4">
          {showTextFilters ? <div className="space-y-2">
            <Label htmlFor="filtro-cliente">Cliente</Label>
            <Input
              id="filtro-cliente"
              value={filters.cliente}
              onChange={(e) =>
                onFiltersChange({
                  ...filters,
                  cliente: e.target.value,
                })
              }
              placeholder="Nome do cliente"
            />
          </div> : null}

          {showTextFilters ? <div className="space-y-2">
            <Label htmlFor="filtro-nota">Nº da nota</Label>
            <Input
              id="filtro-nota"
              value={filters.notaNumero}
              onChange={(e) =>
                onFiltersChange({
                  ...filters,
                  notaNumero: e.target.value,
                })
              }
              placeholder="Número da nota"
            />
          </div> : null}

          <div className="space-y-3">
            <p className="text-sm font-medium">Período</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <span className="text-xs text-muted-foreground">Início</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !filters.dataInicio && "text-muted-foreground",
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {filters.dataInicio
                        ? filters.dataInicio.toLocaleDateString("pt-BR")
                        : "Selecionar data"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={filters.dataInicio}
                      onSelect={(date) =>
                        onFiltersChange({
                          ...filters,
                          dataInicio: date,
                        })
                      }
                      initialFocus
                      locale={ptBR}
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <span className="text-xs text-muted-foreground">Fim</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !filters.dataFim && "text-muted-foreground",
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {filters.dataFim
                        ? filters.dataFim.toLocaleDateString("pt-BR")
                        : "Selecionar data"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={filters.dataFim}
                      onSelect={(date) =>
                        onFiltersChange({
                          ...filters,
                          dataFim: date,
                        })
                      }
                      initialFocus
                      locale={ptBR}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>

          <div className="mt-2 flex justify-between gap-2">
            <Button variant="outline" className="w-30" type="button" onClick={onLimpar}>
              Limpar
            </Button>
            <Button
              className="w-30"
              type="button"
              onClick={() => {
                onAplicar();
                onOpenChange(false);
              }}
            >
              Aplicar
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
