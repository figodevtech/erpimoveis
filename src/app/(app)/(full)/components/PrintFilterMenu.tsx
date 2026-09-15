"use client";

import { Filter, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PRINT_ACTION_BUTTON_CLASS } from "@/lib/print/actionStyles";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type PrintFilterOption<T extends string = string> = { value: T; label: string };

/**
 * Filtro de seleção múltipla da barra de impressão.
 *
 * Irmão do `PrintDisplayOptionsMenu`, e não uma extensão dele: aquele grava um
 * atributo em `<html>` por opção para o CSS decidir o que aparece, e aqui a
 * seleção é só estado do pai — quem filtra é o React, repaginando a folha.
 */
export function PrintFilterMenu<T extends string>({
  options,
  selected,
  onChange,
  label = "Filtrar",
}: {
  options: PrintFilterOption<T>[];
  selected: ReadonlySet<T>;
  onChange: (next: Set<T>) => void;
  label?: string;
}) {
  const marcadas = options.filter((option) => selected.has(option.value)).length;
  const parcial = marcadas < options.length;

  function alternar(value: T, checked: boolean) {
    const proximo = new Set(selected);
    if (checked) proximo.add(value);
    else proximo.delete(value);
    onChange(proximo);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="sm" variant="outline" className={PRINT_ACTION_BUTTON_CLASS}>
          <Filter className="w-3 h-3" aria-hidden="true" />
          {label}
          {parcial && <span className="tabular-nums">({marcadas}/{options.length})</span>}
        </Button>
      </DropdownMenuTrigger>
      {/* Montado num portal no body: sem `no-print`, aberto no Ctrl+P ele
          imprimiria por cima da página 1. */}
      <DropdownMenuContent align="start" className="no-print">
        <DropdownMenuLabel>Filtrar na impressão</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.value}
            checked={selected.has(option.value)}
            // Mantém o menu aberto: marcar vários tipos não pode exigir reabrir a cada clique.
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(value) => alternar(option.value, value === true)}
          >
            {option.label}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            onChange(new Set(options.map((option) => option.value)));
          }}
        >
          Marcar todos
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            onChange(new Set());
          }}
        >
          Limpar
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Escolha única da barra de impressão — a forma da folha, e não o que entra nela. */
export function PrintGroupingMenu<T extends string>({
  options,
  value,
  onChange,
  label = "Agrupar",
}: {
  options: PrintFilterOption<T>[];
  value: T;
  onChange: (next: T) => void;
  label?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="sm" variant="outline" className={PRINT_ACTION_BUTTON_CLASS}>
          <Layers className="w-3 h-3" aria-hidden="true" />
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="no-print">
        <DropdownMenuLabel>Agrupar na impressão</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={value} onValueChange={(next) => onChange(next as T)}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
