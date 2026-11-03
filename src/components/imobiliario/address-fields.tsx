"use client";

import { useEffect, useMemo, useState } from "react";
import { Drawer as DrawerPrimitive } from "vaul";
import { Check, ChevronsUpDown, Loader2, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useGetCidades } from "@/app/(app)/hooks/useGetCidades";
import { ESTADOS_BRASIL } from "@/app/(app)/(pages)/clientes/components/customerDialogRegister/types";
import { useRemote } from "./shared";
import { cn } from "@/lib/utils";

/** "São Paulo", "sao paulo " e "SÃO PAULO" são o mesmo nome. */
export const placeKey = (value: string) =>
  value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR").trim().replace(/\s+/g, " ");

const UF_NAMES: Record<string, string> = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia", CE: "Ceará", DF: "Distrito Federal",
  ES: "Espírito Santo", GO: "Goiás", MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul", MG: "Minas Gerais",
  PA: "Pará", PB: "Paraíba", PR: "Paraná", PE: "Pernambuco", PI: "Piauí", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte",
  RS: "Rio Grande do Sul", RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina", SP: "São Paulo", SE: "Sergipe", TO: "Tocantins",
};

/** code: dado extra da opção que não aparece (ex.: código IBGE do município). */
type Option = { value: string; label: string; hint?: string; code?: string };

/**
 * Combobox de endereço. No computador, lista em popover; no celular (a ficha já é um painel
 * inferior), outro painel inferior por cima, com busca e itens grandes para o toque. A busca
 * não abre sozinha no celular: o teclado cobriria a lista; quem quiser digitar toca no campo.
 */
function AddressCombobox({
  id,
  value,
  options,
  onChange,
  placeholder,
  title,
  searchPlaceholder,
  emptyText,
  disabled,
  loading,
  creatable,
  footer,
}: {
  id: string;
  value: string;
  options: Option[];
  onChange: (value: string, option?: Option) => void;
  placeholder: string;
  title: string;
  searchPlaceholder: string;
  emptyText: string;
  disabled?: boolean;
  loading?: boolean;
  /** Aceita o texto digitado como valor novo (ex.: bairro ainda não cadastrado). */
  creatable?: boolean;
  footer?: React.ReactNode;
}) {
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = options.find((option) => placeKey(option.value) === placeKey(value));
  const display = selected?.label ?? value;
  const typed = search.trim().replace(/\s+/g, " ");
  const canCreate = creatable && typed && !options.some((option) => placeKey(option.value) === placeKey(typed));

  const pick = (next: string, option?: Option) => {
    onChange(next, option);
    setOpen(false);
    setSearch("");
  };

  const list = (
    <Command
      className="min-h-0 flex-1 bg-transparent"
      filter={(itemValue, query) => (placeKey(itemValue).includes(placeKey(query)) ? 1 : 0)}
    >
      <CommandInput value={search} onValueChange={setSearch} placeholder={searchPlaceholder} className="h-11 text-base md:text-sm" />
      <CommandList className={cn("min-h-0 flex-1 overscroll-contain", isDesktop ? "max-h-72" : "max-h-none")}>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        ) : (
          <CommandEmpty>{canCreate ? null : emptyText}</CommandEmpty>
        )}
        {canCreate ? (
          <CommandGroup>
            <CommandItem value={`__novo__ ${typed}`} onSelect={() => pick(typed)} className="py-3 md:py-2 hover:cursor-pointer">
              <Plus className="h-4 w-4 text-primary" />
              <span>
                Usar “<strong>{typed}</strong>”
              </span>
            </CommandItem>
          </CommandGroup>
        ) : null}
        {!loading ? (
          <CommandGroup>
            {options.map((option) => (
              <CommandItem
                key={option.value}
                value={`${option.label} ${option.hint ?? ""} ${option.value}`}
                onSelect={() => pick(option.value, option)}
                className="py-3 md:py-2 hover:cursor-pointer"
              >
                <Check className={cn("h-4 w-4 shrink-0", placeKey(option.value) === placeKey(value) ? "opacity-100" : "opacity-0")} />
                <span className="truncate">{option.label}</span>
                {option.hint ? <span className="ml-auto shrink-0 text-xs text-muted-foreground">{option.hint}</span> : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
      </CommandList>
      {footer}
    </Command>
  );

  const trigger = (
    <Button
      id={id}
      type="button"
      variant="outline"
      role="combobox"
      aria-expanded={open}
      disabled={disabled}
      onClick={isDesktop ? undefined : () => setOpen(true)}
      className="h-9 w-full min-w-0 justify-between px-3 font-normal"
    >
      <span className={cn("min-w-0 truncate text-left", !display && "text-muted-foreground")}>{display || placeholder}</span>
      {loading ? <Loader2 className="ml-2 h-4 w-4 shrink-0 animate-spin" /> : <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />}
    </Button>
  );

  if (isDesktop) {
    return (
      <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setSearch(""); }} modal>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent
          align="start"
          collisionPadding={8}
          className="flex max-h-[var(--radix-popover-content-available-height)] w-[var(--radix-popover-trigger-width)] min-w-[240px] max-w-[calc(100vw-1rem)] flex-col p-0"
        >
          {list}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <>
      {trigger}
      <DrawerPrimitive.Root open={open} onOpenChange={(next) => { setOpen(next); if (!next) setSearch(""); }}>
        <DrawerContent
          className="h-[85dvh] max-h-[85dvh]"
          // Sem foco automático na busca: o teclado subiria por cima da lista.
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <DrawerHeader className="pb-2 text-left">
            <DrawerTitle>{title}</DrawerTitle>
            <DrawerDescription className="sr-only">{searchPlaceholder}</DrawerDescription>
          </DrawerHeader>
          <div className="flex min-h-0 flex-1 flex-col px-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">{list}</div>
        </DrawerContent>
      </DrawerPrimitive.Root>
    </>
  );
}

export type AddressValue = Record<string, any>;

/**
 * Estado, cidade e bairro do imóvel. Cidade vem da lista do IBGE da UF (grava também o código
 * do município); bairro vem dos já usados em imóveis da cidade, aceitando um novo. Trocar a UF
 * limpa cidade e bairro; trocar a cidade limpa o bairro.
 */
export function AddressPlaceFields({
  address,
  onChange,
  disabled,
}: {
  address: AddressValue;
  onChange: (address: AddressValue) => void;
  disabled?: boolean;
}) {
  const uf = String(address.estado ?? "").toUpperCase();
  const cidade = String(address.cidade ?? "");
  const { cidades, loading, error, recarregar } = useGetCidades(uf || undefined);
  // Lista fixa da cidade (pelo código IBGE) + bairros dos imóveis já cadastrados.
  const codigo = String(address.codigo_municipio ?? "");
  const neighborhoods = useRemote<{ items: string[]; fonte?: string[] }>(
    uf && cidade ? `/api/imoveis/bairros?${new URLSearchParams({ estado: uf, cidade, ...(codigo ? { codigo } : {}) })}` : null
  );

  // Cidade vinda do CEP (ou de cadastro antigo) sem código: casa com a lista do IBGE assim que ela chega.
  useEffect(() => {
    if (disabled || !cidade || address.codigo_municipio || !cidades.length) return;
    const match = cidades.find((c) => placeKey(c.nome) === placeKey(cidade));
    if (match) onChange({ ...address, cidade: match.nome, codigo_municipio: String(match.id) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cidades, cidade, address.codigo_municipio, disabled]);

  const ufOptions = useMemo<Option[]>(
    () => ESTADOS_BRASIL.map((sigla) => ({ value: sigla, label: `${sigla} · ${UF_NAMES[sigla] ?? sigla}` })),
    []
  );
  const cityOptions = useMemo<Option[]>(
    () => cidades.map((c) => ({ value: c.nome, label: c.nome, code: String(c.id) })),
    [cidades]
  );
  const neighborhoodOptions = useMemo<Option[]>(
    () => (neighborhoods.data?.items ?? []).map((name) => ({ value: name, label: name })),
    [neighborhoods.data]
  );

  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="estado" className="text-sm">
          Estado (UF)
        </Label>
        <AddressCombobox
          id="estado"
          value={uf}
          options={ufOptions}
          disabled={disabled}
          placeholder="UF"
          title="Estado"
          searchPlaceholder="Buscar estado…"
          emptyText="Nenhum estado encontrado."
          onChange={(next) =>
            onChange(
              next === uf
                ? address
                : { ...address, estado: next, cidade: "", codigo_municipio: null, bairro: "" }
            )
          }
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="cidade" className="text-sm">
          Cidade
        </Label>
        <AddressCombobox
          id="cidade"
          value={cidade}
          options={cityOptions}
          disabled={disabled || !uf}
          loading={loading}
          // Sem a lista (IBGE e lista interna fora do ar), ainda dá para digitar a cidade.
          creatable={Boolean(error)}
          placeholder={uf ? "Selecione a cidade" : "Escolha a UF antes"}
          title={`Cidades · ${uf}`}
          searchPlaceholder="Buscar cidade…"
          emptyText={error ? "Lista indisponível: digite a cidade." : "Nenhuma cidade encontrada."}
          footer={
            error ? (
              <button
                type="button"
                onClick={recarregar}
                className="flex w-full items-center justify-center gap-1.5 border-t py-2 text-xs text-primary hover:cursor-pointer hover:bg-muted"
              >
                <RefreshCw className="h-3 w-3" /> Tentar carregar as cidades de novo
              </button>
            ) : null
          }
          onChange={(next, option) =>
            onChange(
              placeKey(next) === placeKey(cidade)
                ? { ...address, cidade: next, codigo_municipio: option?.code ?? address.codigo_municipio ?? null }
                : { ...address, cidade: next, codigo_municipio: option?.code ?? null, bairro: "" }
            )
          }
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="bairro" className="text-sm">
          Bairro
        </Label>
        <AddressCombobox
          id="bairro"
          value={String(address.bairro ?? "")}
          options={neighborhoodOptions}
          disabled={disabled || !cidade}
          loading={neighborhoods.loading && !neighborhoods.data}
          creatable
          placeholder={cidade ? "Selecione ou digite" : "Escolha a cidade antes"}
          title={cidade ? `Bairros · ${cidade}` : "Bairros"}
          searchPlaceholder="Buscar ou digitar bairro…"
          emptyText="Nenhum bairro na lista. Digite para usar um novo."
          footer={
            neighborhoods.data?.fonte?.includes("OpenStreetMap") ? (
              <p className="border-t px-3 py-1.5 text-[10px] text-muted-foreground">
                Bairros: ©{" "}
                <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline">
                  OpenStreetMap
                </a>{" "}
                e imóveis cadastrados
              </p>
            ) : null
          }
          onChange={(next) => onChange({ ...address, bairro: next })}
        />
      </div>
    </>
  );
}
