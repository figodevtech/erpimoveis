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
import type { ReactNode } from "react";

export type PaymentListFilters = {
  cliente: string;
  notaNumero: string;
  dataInicio?: Date;
  dataFim?: Date;
  /** Restringe a listagem aos registros criados pelo usuario logado. */
  apenasMinhas?: boolean;
  /** Faixa de valor do documento (orçamento da OS / total da venda). */
  valorMin?: number;
  valorMax?: number;
  // --- Ordens de serviço ---
  setorId?: string;
  prioridade?: string;
  alvoTipo?: string;
  /** Id de quem abriu a OS. */
  responsavelId?: string;
  /** Método de algum pagamento (RECEITA) já registrado no documento. */
  metodoPagamento?: string;
  // --- Vendas ---
  canal?: string;
  categoriaVendaId?: string;
  vendedorId?: string;
};

type PaymentsFilterSheetProps = {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  filters: PaymentListFilters;
  onFiltersChange: (value: PaymentListFilters) => void;
  onAplicar: () => void;
  onLimpar: () => void;
  showTextFilters?: boolean;
  /** Rótulo do campo de valor: "Orçamento (R$)" na OS, "Valor total (R$)" na venda. */
  valorLabel?: string;
  /**
   * Filtros específicos do domínio (setor/prioridade/alvo na OS; canal/categoria
   * na venda). A folha em si não sabe o que é uma OS ou uma venda — quem chama
   * decide o que entra aqui, e a folha só garante Limpar/Aplicar consistentes.
   */
  children?: ReactNode;
};

export function PaymentsFilterSheet({
  open,
  onOpenChange,
  filters,
  onFiltersChange,
  onAplicar,
  onLimpar,
  showTextFilters = true,
  valorLabel = "Valor (R$)",
  children,
}: PaymentsFilterSheetProps) {
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

        {/* Só o miolo rola: Limpar e Aplicar ficam ancorados no rodapé. */}
        <div className="grid min-h-0 flex-1 auto-rows-min gap-6 overflow-y-auto px-4 pb-4">
          <div className="p-4 bg-card rounded-xl">
            {showTextFilters ? (
              <div className="space-y-2">
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
              </div>
            ) : null}

            {showTextFilters ? (
              <div className="space-y-2">
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
              </div>
            ) : null}

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

            <div className="space-y-3 border-t pt-4">
              <p className="text-sm font-medium">{valorLabel}</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <span className="text-xs text-muted-foreground">Mínimo</span>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    value={filters.valorMin ?? ""}
                    onChange={(e) => {
                      const raw = e.target.value;
                      onFiltersChange({
                        ...filters,
                        valorMin:
                          raw === "" ? undefined : Math.max(0, Number(raw)),
                      });
                    }}
                    placeholder="0,00"
                  />
                </div>
                <div className="space-y-2">
                  <span className="text-xs text-muted-foreground">Máximo</span>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    value={filters.valorMax ?? ""}
                    onChange={(e) => {
                      const raw = e.target.value;
                      onFiltersChange({
                        ...filters,
                        valorMax:
                          raw === "" ? undefined : Math.max(0, Number(raw)),
                      });
                    }}
                    placeholder="Sem limite"
                  />
                </div>
              </div>
            </div>

            {children ? (
              <div className="space-y-5 border-t pt-4">{children}</div>
            ) : null}
          </div>
        </div>

        {/*
          Fora da área que rola: o painel já passou de dez filtros somando os
          específicos de cada tela, e os botões que encerram a escolha não podem
          depender de o usuário rolar até o fim para reaparecer.
        */}
        <div className="flex shrink-0 justify-between gap-2 border-t bg-background p-4">
          <Button
            variant="outline"
            className="w-30"
            type="button"
            onClick={onLimpar}
          >
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
      </SheetContent>
    </Sheet>
  );
}
