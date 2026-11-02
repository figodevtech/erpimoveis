"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronsUpDown, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ComodidadeDialog,
  type TipoComodidade,
} from "@/app/(app)/(pages)/configuracoes/tipos/components/comodidadeDialog/comodidade-dialog";
import { useModulePermission, useRemote } from "./shared";
import { cn } from "@/lib/utils";

// Mesmos limites de imovel.comodidades no schema do imóvel.
const MAX_TAGS = 100;
const MAX_LENGTH = 120;

/** Chave de comparação: "wi-fi", "Wi-Fi " e "WI-FI" são a mesma comodidade. */
function key(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR").trim().replace(/\s+/g, " ");
}

function clean(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, MAX_LENGTH);
}

export function ComodidadesField({
  value,
  onChange,
  disabled,
}: {
  value?: string[] | null;
  onChange: (value: string[]) => void;
  disabled?: boolean;
}) {
  const { can } = useModulePermission();
  const remote = useRemote<{ items: TipoComodidade[] }>("/api/tipos/comodidades?ativo=true");
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cadastros antigos vinham de um textarea (uma por linha) e podem ter linhas vazias.
  const tags = useMemo(() => (value ?? []).map(clean).filter(Boolean), [value]);
  const selected = useMemo(() => new Set(tags.map(key)), [tags]);
  const tipos = remote.data?.items ?? [];
  const marcados = tipos.filter((tipo) => selected.has(key(tipo.nome))).length;

  const add = (raw: string[]) => {
    const next = [...tags];
    const seen = new Set(selected);
    for (const entry of raw.map(clean)) {
      if (!entry || seen.has(key(entry)) || next.length >= MAX_TAGS) continue;
      seen.add(key(entry));
      next.push(entry);
    }
    if (next.length !== tags.length) onChange(next);
  };

  const remove = (tag: string) => onChange(tags.filter((entry) => key(entry) !== key(tag)));

  const toggle = (nome: string) => (selected.has(key(nome)) ? remove(nome) : add([nome]));

  const commit = () => {
    if (!input.trim()) return;
    add([input]);
    setInput("");
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Popover open={open} onOpenChange={setOpen} modal>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={open}
              disabled={disabled || remote.loading}
              className="min-w-0 flex-1 justify-between px-3 font-normal"
            >
              <span className={cn("min-w-0 truncate text-left", !marcados && "text-muted-foreground")}>
                {remote.loading
                  ? "Carregando comodidades…"
                  : marcados
                  ? `${marcados} ${marcados === 1 ? "comodidade padrão marcada" : "comodidades padrão marcadas"}`
                  : "Selecionar comodidades padrão"}
              </span>
              {remote.loading ? (
                <Loader2 className="ml-2 h-4 w-4 shrink-0 animate-spin" />
              ) : (
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            collisionPadding={8}
            // No toque, focar a busca abre o teclado por cima da lista.
            onOpenAutoFocus={(event) => {
              if (window.matchMedia("(pointer: coarse)").matches) event.preventDefault();
            }}
            className="flex max-h-[var(--radix-popover-content-available-height)] w-[var(--radix-popover-trigger-width)] min-w-[280px] max-w-[calc(100vw-1rem)] flex-col p-0 md:w-[min(42rem,calc(100vw-1rem))]"
          >
            <Command
              className="min-h-0 flex-1"
              filter={(itemValue, search) => (key(itemValue).includes(key(search)) ? 1 : 0)}
            >
              <CommandInput placeholder="Buscar comodidade..." />
              <CommandList className="max-h-72 min-h-0 flex-1 md:max-h-96">
                <CommandEmpty>
                  {remote.error ? "Não foi possível carregar as comodidades." : "Nenhuma comodidade encontrada."}
                </CommandEmpty>
                {/* Colunas (e não grade) no desktop: a ordem alfabética desce por coluna, como as setas do teclado. */}
                <CommandGroup className="md:[&_[cmdk-group-items]]:columns-3 md:[&_[cmdk-group-items]]:gap-x-1">
                  {tipos.map((tipo) => {
                    const checked = selected.has(key(tipo.nome));
                    return (
                      <CommandItem
                        key={tipo.id}
                        value={tipo.nome}
                        onSelect={() => toggle(tipo.nome)}
                        className="break-inside-avoid hover:cursor-pointer"
                      >
                        <Checkbox checked={checked} tabIndex={-1} aria-hidden className="pointer-events-none" />
                        <span className="truncate">{tipo.nome}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {can("tipos:comodidades:criar") ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={disabled}
                onClick={() => setCreating(true)}
                aria-label="Novo tipo de comodidade"
                className="shrink-0 hover:cursor-pointer"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Novo tipo de comodidade</TooltipContent>
          </Tooltip>
        ) : null}
      </div>

      <div
        onClick={() => inputRef.current?.focus()}
        className={cn(
          "flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2.5 py-1.5 text-sm shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
          disabled && "cursor-not-allowed opacity-50"
        )}
      >
        {tags.map((tag) => (
          <span
            key={key(tag)}
            className="inline-flex max-w-full items-center gap-1 rounded-md bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground"
          >
            <span className="truncate">{tag}</span>
            {!disabled ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  remove(tag);
                }}
                className="rounded-full p-0.5 hover:bg-primary-foreground/20 hover:cursor-pointer focus:outline-none"
                aria-label={`Remover ${tag}`}
              >
                <X className="size-3" />
              </button>
            ) : null}
          </span>
        ))}
        <input
          ref={inputRef}
          id="comodidades"
          value={input}
          disabled={disabled || tags.length >= MAX_TAGS}
          maxLength={MAX_LENGTH}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              // Sem isso, o Enter enviaria o formulário do imóvel.
              event.preventDefault();
              commit();
            } else if (event.key === "Backspace" && !input && tags.length) {
              remove(tags[tags.length - 1]);
            }
          }}
          onPaste={(event) => {
            // Colar uma lista (uma por linha) vira várias tags de uma vez.
            const text = event.clipboardData.getData("text");
            if (!/\r?\n/.test(text)) return;
            event.preventDefault();
            add(text.split(/\r?\n/));
          }}
          placeholder={tags.length ? "" : "Digite uma comodidade e pressione Enter"}
          className="h-7 min-w-[160px] flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed md:text-sm"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Digite e pressione Enter para adicionar, ou marque na lista acima. {tags.length}/{MAX_TAGS}
      </p>

      <ComodidadeDialog
        open={creating}
        onOpenChange={setCreating}
        initialName={input}
        onSaved={(item) => {
          remote.reload();
          if (item.ativo) {
            add([item.nome]);
            if (key(input) === key(item.nome)) setInput("");
          }
        }}
      />
    </div>
  );
}
