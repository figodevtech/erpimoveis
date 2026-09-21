"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

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
import {
  listCfopsForEmission,
  type NFeOperationDirection,
} from "@/lib/nfe/cfopOperation";
import type { ModeloDocumentoFiscal } from "@/lib/nfe/types";
import { cn } from "@/lib/utils";

type Props = {
  value: string;
  modelo: ModeloDocumentoFiscal;
  operation: NFeOperationDirection;
  emitterUf?: string | null;
  partnerUf?: string | null;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
};

/** Seletor único de CFOP para todos os motores de emissão. */
export function CfopCombobox({
  value,
  modelo,
  operation,
  emitterUf,
  partnerUf,
  onValueChange,
  disabled,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const cfops = useMemo(
    () => listCfopsForEmission({ modelo, operation, emitterUf, partnerUf }),
    [emitterUf, modelo, operation, partnerUf],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Selecionar CFOP"
          disabled={disabled}
          className={cn("w-full justify-between px-3 font-normal", className)}
        >
          <span className="truncate">{value || "Selecione"}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(34rem,calc(100vw-2rem))] p-0">
        <Command>
          <CommandInput placeholder="Buscar por código ou descrição..." />
          <CommandList className="max-h-72">
            <CommandEmpty>Nenhum CFOP permitido para esta operação.</CommandEmpty>
            <CommandGroup>
              {cfops.map((entry) => (
                <CommandItem
                  key={entry.codigo}
                  value={`${entry.codigo} ${entry.descricao}`}
                  onSelect={() => {
                    onValueChange(entry.codigo);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4 shrink-0",
                      value === entry.codigo ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="min-w-0">
                    <strong>{entry.codigo}</strong> — {entry.descricao}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
