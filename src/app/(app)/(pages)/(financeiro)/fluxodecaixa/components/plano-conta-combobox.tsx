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
  /**
   * Natureza do lançamento. Quando informada, uma conta que não a aceita fica
   * bloqueada aqui — antes do envio. A rota e o banco repetem a validação,
   * porque esta tela não é a única forma de gravar.
   */
  natureza?: "RECEITA" | "DESPESA";
};

/** Explicação curta do destino, para quem lança não precisar saber a linha de cor. */
function textoDoDestino(plano: Plano_de_conta) {
  const destino = plano.destino;
  if (!destino) return null;
  if (destino.situacao === "CLASSIFICADO" && destino.linha_codigo) {
    return `DRE: ${destino.linha_nome ?? destino.linha_codigo}`;
  }
  if (destino.situacao === "EXCLUIDO") {
    return `Fora da DRE${destino.motivo ? `: ${destino.motivo}` : ""}`;
  }
  return "Sem classificação: ficará como pendência na DRE";
}

/**
 * `naturezas` vazio significa que o cadastro ainda não tem classificação, ou que
 * a resposta veio de uma versão antiga da API. Nos dois casos não há base para
 * bloquear — e bloquear sem base impediria o lançamento do dia a dia.
 */
function incompativel(plano: Plano_de_conta, natureza?: "RECEITA" | "DESPESA") {
  if (!natureza) return false;
  const aceitas = plano.classificacao?.naturezas ?? [];
  return aceitas.length > 0 && !aceitas.includes(natureza);
}

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
  natureza,
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
      {selected && textoDoDestino(selected) ? (
        <p
          className={cn(
            "mt-1 truncate text-xs",
            selected.destino?.situacao === "PENDENTE" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {textoDoDestino(selected)}
        </p>
      ) : null}
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
                {planos.map((plano) => {
                  const bloqueada = incompativel(plano, natureza);
                  const destino = textoDoDestino(plano);
                  return (
                    <CommandItem
                      key={plano.id}
                      value={`${grupo.codigo} ${grupo.nome} ${plano.codigo ?? ""} ${plano.nome} ${plano.descricao ?? ""} ${plano.id}`}
                      disabled={bloqueada}
                      onSelect={() => {
                        if (bloqueada) return;
                        onValueChange(String(plano.id), plano);
                        setOpen(false);
                      }}
                      className="min-w-0 items-start"
                    >
                      <Check
                        className={cn(
                          "mt-0.5 h-4 w-4 shrink-0",
                          String(plano.id) === value ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="flex min-w-0 flex-col">
                        <span className="min-w-0 truncate">
                          {plano.codigo ? `${plano.codigo} - ${plano.nome}` : plano.nome}
                        </span>
                        {bloqueada ? (
                          <span className="text-xs text-destructive">
                            {plano.classificacao?.nome} não aceita lançamento de{" "}
                            {natureza === "RECEITA" ? "receita" : "despesa"}
                          </span>
                        ) : destino ? (
                          <span className="truncate text-xs text-muted-foreground">{destino}</span>
                        ) : null}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
