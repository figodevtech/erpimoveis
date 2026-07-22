"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { Plano_de_conta, Plano_de_conta_grupo } from "../types";

type GroupedPlans = {
  grupo: Plano_de_conta_grupo;
  planos: Plano_de_conta[];
};

type PlanoContaComboboxProps = {
  value?: string;
  groups: GroupedPlans[];
  loading?: boolean;
  disabled?: boolean;
  placeholder?: string;
  clearable?: boolean;
  clearLabel?: string;
  onClear?: () => void;
  onValueChange: (value: string, plano: Plano_de_conta) => void;
};

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

export function PlanoContaCombobox({
  value = "",
  groups,
  loading = false,
  disabled = false,
  placeholder = "Selecione o plano de conta",
  clearable = false,
  clearLabel = "Sem seleção",
  onClear,
  onValueChange,
}: PlanoContaComboboxProps) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(
    () => groups.flatMap((group) => group.planos).find((plano) => String(plano.id) === value),
    [groups, value],
  );
  const selectedGroup = selected?.grupo;

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || loading}
          className="w-full min-w-0 justify-between px-3 font-normal"
        >
          <span className={cn("min-w-0 truncate text-left", !selected && "text-muted-foreground")}>
            {loading
              ? "Carregando..."
              : selected
                ? `${selectedGroup?.nome ? `${selectedGroup.nome} · ` : ""}${selected.codigo ? `${selected.codigo} - ` : ""}${selected.nome}`
                : placeholder}
          </span>
          {loading
            ? <Loader2 className="ml-2 h-4 w-4 shrink-0 animate-spin" />
            : <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-[280px] max-w-[calc(100vw-1rem)] p-0"
      >
        <Command
          filter={(itemValue, search) =>
            normalizeSearch(itemValue).includes(normalizeSearch(search)) ? 1 : 0
          }
        >
          <CommandInput placeholder="Pesquisar grupo, código ou plano..." />
          <CommandList
            className="max-h-72 overscroll-contain"
            onWheel={(event) => event.stopPropagation()}
          >
            <CommandEmpty>Nenhum plano de conta encontrado.</CommandEmpty>
            {clearable && onClear ? (
              <CommandGroup>
                <CommandItem
                  value={clearLabel}
                  onSelect={() => {
                    onClear();
                    setOpen(false);
                  }}
                >
                  <Check className={cn("h-4 w-4 shrink-0", value ? "opacity-0" : "opacity-100")} />
                  <span>{clearLabel}</span>
                </CommandItem>
              </CommandGroup>
            ) : null}
            {groups.map(({ grupo, planos }) => (
              <CommandGroup key={grupo.id} heading={`${grupo.codigo} - ${grupo.nome}`}>
                {planos.map((plano) => (
                  <CommandItem
                    key={plano.id}
                    value={`${grupo.codigo} ${grupo.nome} ${plano.codigo ?? ""} ${plano.nome} ${plano.descricao ?? ""} ${plano.id}`}
                    onSelect={() => {
                      onValueChange(String(plano.id), plano);
                      setOpen(false);
                    }}
                    className="min-w-0"
                  >
                    <Check
                      className={cn(
                        "h-4 w-4 shrink-0",
                        String(plano.id) === value ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="min-w-0 truncate">
                      {plano.codigo ? `${plano.codigo} - ${plano.nome}` : plano.nome}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
