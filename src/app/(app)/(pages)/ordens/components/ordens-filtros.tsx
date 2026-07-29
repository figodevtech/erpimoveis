// ./src/app/(app)/(pages)/ordens/components/ordens-filtros.tsx
"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  SlidersHorizontal,
  CalendarIcon,
  ChevronsUpDown,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PrioFiltro } from "./ordens-tabela-helpers";
import { ptBR } from "date-fns/locale";
import { Label } from "@/components/ui/label";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

type FilterSheetProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  prioFiltro: PrioFiltro;
  setPrioFiltro: (v: PrioFiltro) => void;
  setorFiltro: string;
  setSetorFiltro: (v: string) => void;
  setores: Array<{ value: string; label: string }>;
  alvoFiltro: "TODOS" | "VEICULO" | "PECA" | "EQUIPAMENTO";
  setAlvoFiltro: (v: "TODOS" | "VEICULO" | "PECA" | "EQUIPAMENTO") => void;
  dataInicio?: Date;
  dataFim?: Date;
  onSetInicio: (d?: Date) => void;
  onSetFim: (d?: Date) => void;
  onLimpar: () => void;
};

export function OrdensFilterSheet({
  open,
  onOpenChange,
  prioFiltro,
  setPrioFiltro,
  setorFiltro,
  setSetorFiltro,
  setores,
  alvoFiltro,
  setAlvoFiltro,
  dataInicio,
  dataFim,
  onSetInicio,
  onSetFim,
  onLimpar,
}: FilterSheetProps) {
  const [setorOpen, setSetorOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-1 hover:cursor-pointer"
        >
          <SlidersHorizontal className="h-4 w-4" />
          Filtros
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Filtros da listagem</SheetTitle>
        </SheetHeader>

        <div className="grid flex-1 auto-rows-min gap-6 px-4">
          {/* Prioridade */}
          <div className="space-y-2">
            <Label>Prioridade</Label>
            <Select
              value={prioFiltro}
              onValueChange={(v) => setPrioFiltro(v as PrioFiltro)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Todas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TODAS">Todas</SelectItem>
                <SelectItem value="ALTA">Alta</SelectItem>
                <SelectItem value="NORMAL">Normal</SelectItem>
                <SelectItem value="BAIXA">Baixa</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Setor */}
          <div className="space-y-2">
            <Label>Setor</Label>
            <Popover open={setorOpen} onOpenChange={setSetorOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={setorOpen}
                  className="w-full justify-between"
                >
                  <span className="truncate">
                    {setorFiltro === "TODOS"
                      ? "Todos"
                      : setores.find((s) => s.value === setorFiltro)?.label ||
                        "Selecione..."}
                  </span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="p-0"
                align="start"
                 side="bottom"
                style={{ width: "var(--radix-popover-trigger-width)" }}
                onWheel={(e) => e.stopPropagation()}
                onTouchMove={(e) => e.stopPropagation()}
                onOpenAutoFocus={(e) => e.preventDefault()}
              >
                <Command>
                  <CommandInput placeholder="Buscar setor..." className="h-9 text-base" />
                  <CommandList
                    className="max-h-52 overflow-auto"
                    onWheel={(e) => e.stopPropagation()}
                  >
                    <CommandEmpty>Nenhum setor encontrado.</CommandEmpty>
                    <CommandGroup>
                      <CommandItem
                        value="TODOS"
                        className="hover:cursor-pointer"
                        onSelect={() => {
                          setSetorFiltro("TODOS");
                          setSetorOpen(false);
                        }}
                      >
                        Todos
                        <Check
                          className={cn(
                            "ml-auto h-4 w-4",
                            setorFiltro === "TODOS"
                              ? "opacity-100"
                              : "opacity-0"
                          )}
                        />
                      </CommandItem>
                      {setores.map((s) => (
                        <CommandItem
                          key={s.value}
                          value={s.label || s.value}
                          className="hover:cursor-pointer"
                          onSelect={() => {
                            setSetorFiltro(s.value);
                            setSetorOpen(false);
                          }}
                        >
                          {s.label || "-"}
                          <Check
                            className={cn(
                              "ml-auto h-4 w-4",
                              setorFiltro === s.value
                                ? "opacity-100"
                                : "opacity-0"
                            )}
                          />
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {/* Alvo */}
          <div className="space-y-2">
            <Label>Alvo</Label>
            <Select
              value={alvoFiltro}
              onValueChange={(v) =>
                setAlvoFiltro(v as "TODOS" | "VEICULO" | "PECA" | "EQUIPAMENTO")
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TODOS">Todos</SelectItem>
                <SelectItem value="VEICULO">Veículo</SelectItem>
                <SelectItem value="PECA">Peça</SelectItem>
                <SelectItem value="EQUIPAMENTO">Máquina/Equipamento</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Datas */}
          <div className="space-y-3">
            <p className="text-sm font-medium">Data de entrada (intervalo)</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Data início */}
              <div className="space-y-2">
                <span className="text-xs text-muted-foreground">Início</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !dataInicio && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dataInicio
                        ? dataInicio.toLocaleDateString("pt-BR")
                        : "Selecionar data"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={dataInicio}
                      onSelect={onSetInicio}
                      initialFocus
                      locale={ptBR}
                    />
                  </PopoverContent>
                </Popover>
              </div>

              {/* Data fim */}
              <div className="space-y-2">
                <span className="text-xs text-muted-foreground">Fim</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !dataFim && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dataFim
                        ? dataFim.toLocaleDateString("pt-BR")
                        : "Selecionar data"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={dataFim}
                      onSelect={onSetFim}
                      initialFocus
                      locale={ptBR}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>
          <div className="mt-2 flex justify-between gap-2">
            <Button
              variant="outline"
              className="w-30"
              size="default"
              type="button"
              onClick={onLimpar}
            >
              Limpar
            </Button>
            <Button
              size="default"
              className="w-30"
              type="button"
              onClick={() => onOpenChange(false)}
            >
              Aplicar
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
