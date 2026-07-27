"use client";

import { useMemo, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { ProductListFilters } from "../types";
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
  estoqueMin: "",
  estoqueMax: "",
  precoMin: "",
  precoMax: "",
};

interface ProdutoFiltrosSheetProps {
  filters: ProductListFilters;
  onApply: (filters: ProductListFilters) => void;
}

export function ProdutoFiltrosSheet({ filters, onApply }: ProdutoFiltrosSheetProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ProductListFilters>(filters);
  const { grupos, loadingGrupos } = useGruposProduto();
  const { unidades, loadingUnidades } = useUnidadesMedida();

  const activeCount = useMemo(
    () => Object.values(filters).filter((value) => value.trim() !== "").length,
    [filters],
  );

  const update = (field: keyof ProductListFilters, value: string) => {
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

              <div className="flex justify-end gap-2 border-t pt-4">
                <Button type="button" variant="outline" onClick={clear}>Limpar</Button>
                <Button type="button" onClick={() => { onApply(draft); setOpen(false); }}>Aplicar filtros</Button>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
