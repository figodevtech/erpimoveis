"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { CanalAnuncio, ProductListFilters } from "../types";
import { useGruposProduto } from "./dialog-produto/hooks/use-grupo-produtos";
import { useUnidadesMedida } from "./dialog-produto/hooks/use-unidades-medida";
import { SearchCombobox } from "../../(financeiro)/fluxodecaixa/components/search-combobox";

export const EMPTY_PRODUCT_FILTERS: ProductListFilters = {
  grupoId: "",
  conservacao: "",
  unidade: "",
  fabricante: "",
  local: "",
  exibirPdv: "",
  temEtiqueta: "",
  estoqueMin: "",
  estoqueMax: "",
  precoMin: "",
  precoMax: "",
  canais: [],
};

const SHOPEE_ATIVA = process.env.NEXT_PUBLIC_SHOPEE_INTEGRATION_ENABLED === "true";

// O que conta como anunciado vem de produto.canais_anuncio no banco: site com a
// publicação ativa, Mercado Livre e Shopee pelo vínculo do anúncio. A Shopee só
// aparece com a integração ligada, como no Marketplace.
const CANAIS_ANUNCIO: { value: CanalAnuncio; label: string }[] = [
  { value: "SITE", label: "Site" },
  { value: "MERCADO_LIVRE", label: "Mercado Livre" },
  ...(SHOPEE_ATIVA ? [{ value: "SHOPEE" as const, label: "Shopee" }] : []),
];

function CanaisAnuncioSelect({
  value,
  onChange,
}: {
  value: CanalAnuncio[];
  onChange: (value: CanalAnuncio[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const selecionados = new Set(value);
  const resumo = value.length
    ? CANAIS_ANUNCIO.filter((canal) => selecionados.has(canal.value)).map((canal) => canal.label).join(", ")
    : "Todos os produtos";

  const alternar = (canal: CanalAnuncio) =>
    onChange(selecionados.has(canal) ? value.filter((item) => item !== canal) : [...value, canal]);

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
          <span className="truncate">{resumo}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0" align="start" style={{ width: "var(--radix-popover-trigger-width)" }}>
        <Command>
          <CommandList>
            <CommandGroup>
              <CommandItem value="todos" className="hover:cursor-pointer" onSelect={() => onChange([])}>
                <span className={value.length === 0 ? "font-medium" : ""}>Todos os produtos</span>
                <Check className={`ml-auto h-4 w-4 ${value.length === 0 ? "opacity-100" : "opacity-0"}`} />
              </CommandItem>
              {CANAIS_ANUNCIO.map((canal) => (
                <CommandItem
                  key={canal.value}
                  value={canal.label}
                  className="flex items-center gap-2 hover:cursor-pointer"
                  onSelect={() => alternar(canal.value)}
                >
                  {/* Só mostra o estado: o clique é do item, senão alternaria duas vezes. */}
                  <Checkbox checked={selecionados.has(canal.value)} tabIndex={-1} className="pointer-events-none" />
                  <span className={selecionados.has(canal.value) ? "font-medium" : ""}>{canal.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

interface ProdutoFiltrosSheetProps {
  filters: ProductListFilters;
  onApply: (filters: ProductListFilters) => void;
}

export function ProdutoFiltrosSheet({ filters, onApply }: ProdutoFiltrosSheetProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ProductListFilters>(filters);
  const { grupos, loadingGrupos } = useGruposProduto(open);
  const { unidades, loadingUnidades } = useUnidadesMedida(open);

  const activeCount = useMemo(
    () =>
      Object.values(filters).filter((value) =>
        Array.isArray(value) ? value.length > 0 : value.trim() !== "",
      ).length,
    [filters],
  );

  const update = (field: Exclude<keyof ProductListFilters, "canais">, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const clear = () => {
    setDraft(EMPTY_PRODUCT_FILTERS);
    onApply(EMPTY_PRODUCT_FILTERS);
    setOpen(false);
  };

  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
      {activeCount > 0 && (
        <Button type="button" variant="outline" size="sm" className="h-9" onClick={clear}>
          Limpar filtros
        </Button>
      )}

      <Sheet
        open={open}
        onOpenChange={(nextOpen) => {
          if (nextOpen) setDraft(filters);
          setOpen(nextOpen);
        }}
      >
        <SheetTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="h-9 gap-2">
            <SlidersHorizontal className="h-4 w-4" />
            Filtros
            {activeCount > 0 && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                {activeCount}
              </span>
            )}
          </Button>
        </SheetTrigger>

        <SheetContent className="w-full overflow-hidden sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Filtros dos produtos</SheetTitle>
          </SheetHeader>

          <div className="grid flex-1 auto-rows-min gap-5 overflow-y-auto p-4">
            <div className="space-y-5 rounded-xl border bg-card p-4">
              <div className="space-y-2">
                <Label>Grupo</Label>
                <SearchCombobox
                  value={draft.grupoId}
                  onValueChange={(value) => update("grupoId", value)}
                  loading={loadingGrupos}
                  placeholder="Todos os grupos"
                  searchPlaceholder="Pesquisar grupo..."
                  emptyMessage="Nenhum grupo encontrado."
                  clearable
                  clearLabel="Todos os grupos"
                  options={grupos.map((grupo) => ({
                    value: String(grupo.id),
                    label: grupo.nome,
                    description: grupo.descricao ?? undefined,
                  }))}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Conservação</Label>
                  <Select value={draft.conservacao || "TODOS"} onValueChange={(v) => update("conservacao", v === "TODOS" ? "" : v)}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="TODOS">Todas</SelectItem>
                      <SelectItem value="NOVO">Novo</SelectItem>
                      <SelectItem value="USADO">Usado</SelectItem>
                      <SelectItem value="RECONDICIONADO">Recondicionado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Unidade</Label>
                  <Select value={draft.unidade || "TODAS"} onValueChange={(v) => update("unidade", v === "TODAS" ? "" : v)}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="TODAS">Todas</SelectItem>
                      {unidades.map((unidade) => <SelectItem key={unidade.id} value={unidade.sigla}>{unidade.sigla}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {loadingUnidades && <p className="text-xs text-muted-foreground">Carregando...</p>}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="produto-fabricante">Fabricante</Label>
                <Input id="produto-fabricante" value={draft.fabricante} onChange={(e) => update("fabricante", e.target.value)} placeholder="Qualquer fabricante" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="produto-local">Localização</Label>
                <Input id="produto-local" value={draft.local} onChange={(e) => update("local", e.target.value)} placeholder="Prateleira, corredor..." />
              </div>

              <div className="space-y-2">
                <Label>Anunciado em</Label>
                <CanaisAnuncioSelect
                  value={draft.canais}
                  onChange={(canais) => setDraft((current) => ({ ...current, canais }))}
                />
                {draft.canais.length > 1 && (
                  <p className="text-xs text-muted-foreground">Mostra os produtos anunciados em qualquer um dos canais marcados.</p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Exibição no PDV</Label>
                <Select value={draft.exibirPdv || "TODOS"} onValueChange={(v) => update("exibirPdv", v === "TODOS" ? "" : v)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TODOS">Todos</SelectItem>
                    <SelectItem value="true">Exibidos no PDV</SelectItem>
                    <SelectItem value="false">Não exibidos no PDV</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Etiqueta</Label>
                <Select value={draft.temEtiqueta || "TODOS"} onValueChange={(v) => update("temEtiqueta", v === "TODOS" ? "" : v)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TODOS">Todos</SelectItem>
                    <SelectItem value="true">Com etiqueta</SelectItem>
                    <SelectItem value="false">Sem etiqueta</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2 border-t pt-4">
                <Label>Faixa de estoque</Label>
                <div className="grid grid-cols-2 gap-3">
                  <Input type="number" min="0" value={draft.estoqueMin} onChange={(e) => update("estoqueMin", e.target.value)} placeholder="Mínimo" />
                  <Input type="number" min="0" value={draft.estoqueMax} onChange={(e) => update("estoqueMax", e.target.value)} placeholder="Máximo" />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Faixa de preço de venda</Label>
                <div className="grid grid-cols-2 gap-3">
                  <Input type="number" min="0" step="0.01" value={draft.precoMin} onChange={(e) => update("precoMin", e.target.value)} placeholder="Mínimo" />
                  <Input type="number" min="0" step="0.01" value={draft.precoMax} onChange={(e) => update("precoMax", e.target.value)} placeholder="Máximo" />
                </div>
              </div>
            </div>
          </div>

          {/* Fora da área com rolagem: aplicar fica à mão em qualquer altura da lista. */}
          <SheetFooter className="flex-row justify-end border-t">
            <Button type="button" variant="outline" onClick={clear}>Limpar</Button>
            <Button type="button" onClick={() => { onApply(draft); setOpen(false); }}>Aplicar filtros</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
