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

export type CampoData = "entrada" | "saida" | "concluido";

type Opcao = { value: string; label: string };

type FilterSheetProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  prioFiltro: PrioFiltro;
  setPrioFiltro: (v: PrioFiltro) => void;
  setorFiltro: string;
  setSetorFiltro: (v: string) => void;
  setores: Opcao[];
  alvoFiltro: "TODOS" | "VEICULO" | "PECA" | "EQUIPAMENTO";
  setAlvoFiltro: (v: "TODOS" | "VEICULO" | "PECA" | "EQUIPAMENTO") => void;
  /** Usuários ativos: servem tanto para responsável quanto para realizador. */
  pessoas: Opcao[];
  responsavelFiltro: string;
  setResponsavelFiltro: (v: string) => void;
  realizadorFiltro: string;
  setRealizadorFiltro: (v: string) => void;
  somenteDestacadas: boolean;
  setSomenteDestacadas: (v: boolean) => void;
  campoData: CampoData;
  setCampoData: (v: CampoData) => void;
  dataInicio?: Date;
  dataFim?: Date;
  onSetInicio: (d?: Date) => void;
  onSetFim: (d?: Date) => void;
  onLimpar: () => void;
};

/**
 * Seletor com busca, para listas que crescem com a oficina (setor, pessoas).
 * Um `Select` simples obrigaria a rolar até achar o nome.
 */
function ComboFiltro({
  valor,
  aoEscolher,
  opcoes,
  rotuloTodos,
  placeholderBusca,
  vazio,
}: {
  valor: string;
  aoEscolher: (v: string) => void;
  opcoes: Opcao[];
  rotuloTodos: string;
  placeholderBusca: string;
  vazio: string;
}) {
  const [aberto, setAberto] = useState(false);
  const escolhida = opcoes.find((o) => o.value === valor);

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={aberto}
          className="w-full justify-between"
        >
          <span className="truncate">
            {valor === "TODOS" ? rotuloTodos : escolhida?.label || "Selecione..."}
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
          <CommandInput placeholder={placeholderBusca} className="h-9 text-base" />
          <CommandList className="max-h-52 overflow-auto" onWheel={(e) => e.stopPropagation()}>
            <CommandEmpty>{vazio}</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="TODOS"
                className="hover:cursor-pointer"
                onSelect={() => {
                  aoEscolher("TODOS");
                  setAberto(false);
                }}
              >
                {rotuloTodos}
                <Check className={cn("ml-auto h-4 w-4", valor === "TODOS" ? "opacity-100" : "opacity-0")} />
              </CommandItem>
              {opcoes.map((opcao) => (
                <CommandItem
                  key={opcao.value}
                  value={opcao.label || opcao.value}
                  className="hover:cursor-pointer"
                  onSelect={() => {
                    aoEscolher(opcao.value);
                    setAberto(false);
                  }}
                >
                  {opcao.label || "-"}
                  <Check
                    className={cn("ml-auto h-4 w-4", valor === opcao.value ? "opacity-100" : "opacity-0")}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

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
  pessoas,
  responsavelFiltro,
  setResponsavelFiltro,
  realizadorFiltro,
  setRealizadorFiltro,
  somenteDestacadas,
  setSomenteDestacadas,
  campoData,
  setCampoData,
  dataInicio,
  dataFim,
  onSetInicio,
  onSetFim,
  onLimpar,
}: FilterSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-1 shrink-0 whitespace-nowrap hover:cursor-pointer"
        >
          <SlidersHorizontal className="h-4 w-4" />
          <span>Filtros</span>
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Filtros da listagem</SheetTitle>
        </SheetHeader>

        {/* Só o miolo rola: Limpar e Aplicar ficam ancorados no rodapé. */}
        <div className="grid min-h-0 flex-1 auto-rows-min gap-6 overflow-y-auto px-4 pb-4">
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
            <ComboFiltro
              valor={setorFiltro}
              aoEscolher={setSetorFiltro}
              opcoes={setores}
              rotuloTodos="Todos"
              placeholderBusca="Buscar setor..."
              vazio="Nenhum setor encontrado."
            />
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

          {/* Responsável: quem abriu a OS. */}
          <div className="space-y-2">
            <Label>Responsável</Label>
            <ComboFiltro
              valor={responsavelFiltro}
              aoEscolher={setResponsavelFiltro}
              opcoes={pessoas}
              rotuloTodos="Todos"
              placeholderBusca="Buscar pessoa..."
              vazio="Nenhuma pessoa encontrada."
            />
            <p className="text-xs text-muted-foreground">
              Quem abriu a ordem. Escolher alguém desliga o botão &ldquo;Minhas OS&rdquo;.
            </p>
          </div>

          {/* Realizador: quem executou serviço, que raramente é quem abriu. */}
          <div className="space-y-2">
            <Label>Realizador</Label>
            <ComboFiltro
              valor={realizadorFiltro}
              aoEscolher={setRealizadorFiltro}
              opcoes={pessoas}
              rotuloTodos="Todos"
              placeholderBusca="Buscar pessoa..."
              vazio="Nenhuma pessoa encontrada."
            />
            <p className="text-xs text-muted-foreground">
              OS com algum serviço atribuído a essa pessoa.
            </p>
          </div>

          {/* Destaque */}
          <div className="space-y-2">
            <Label>Destaque</Label>
            <Select
              value={somenteDestacadas ? "DESTACADAS" : "TODAS"}
              onValueChange={(v) => setSomenteDestacadas(v === "DESTACADAS")}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TODAS">Todas as ordens</SelectItem>
                <SelectItem value="DESTACADAS">Somente destacadas</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Datas */}
          <div className="space-y-3">
            <p className="text-sm font-medium">Período</p>
            <div className="space-y-2">
              <span className="text-xs text-muted-foreground">Medir por</span>
              <Select value={campoData} onValueChange={(v) => setCampoData(v as CampoData)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="entrada">Data de entrada</SelectItem>
                  <SelectItem value="saida">Data de saída</SelectItem>
                  <SelectItem value="concluido">Finalização da OS</SelectItem>
                </SelectContent>
              </Select>
            </div>
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
        </div>

        {/*
          Fora da área que rola: com sete filtros no painel, os botões que
          encerram a escolha não podem depender de chegar ao fim da lista.
        */}
        <div className="flex shrink-0 justify-between gap-2 border-t bg-background p-4">
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
      </SheetContent>
    </Sheet>
  );
}
