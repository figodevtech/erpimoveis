"use client";

import { useMemo, useState } from "react";
import { AmountRangeFilter } from "./amount-range-filter";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
import { SearchCombobox } from "@/app/(app)/(pages)/(financeiro)/fluxodecaixa/components/search-combobox";
import { useGruposProduto } from "@/app/(app)/(pages)/estoque/components/dialog-produto/hooks/use-grupo-produtos";

export type StorefrontProductFilters = {
  status: string;
  syncStatus: string;
  groupId: string;
  condition: string;
  manufacturer: string;
  image: string;
  stockMin: string;
  stockMax: string;
  priceMin: string;
  priceMax: string;
};

export const EMPTY_STOREFRONT_FILTERS: StorefrontProductFilters = {
  status: "all",
  syncStatus: "all",
  groupId: "",
  condition: "",
  manufacturer: "",
  image: "",
  stockMin: "",
  stockMax: "",
  priceMin: "",
  priceMax: "",
};

export function StorefrontProductFiltersSheet({
  filters,
  onApply,
}: {
  filters: StorefrontProductFilters;
  onApply: (filters: StorefrontProductFilters) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(filters);
  const { grupos, loadingGrupos } = useGruposProduto();
  const activeCount = useMemo(
    () =>
      Object.entries(filters).filter(
        ([key, value]) => value.trim() !== "" && !((key === "status" || key === "syncStatus") && value === "all"),
      ).length,
    [filters],
  );

  const rangeError = ([['stockMin','stockMax'],['priceMin','priceMax']] as const).some(([min,max])=>
    [draft[min],draft[max]].some(value=>value!==''&&(!Number.isFinite(Number(value))||Number(value)<0))||
    (draft[min]!==''&&draft[max]!==''&&Number(draft[min])>Number(draft[max]))) ? "Revise as faixas: os valores devem ser positivos e o mínimo não pode superar o máximo." : null;

  function update(field: keyof StorefrontProductFilters, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function clear() {
    setDraft(EMPTY_STOREFRONT_FILTERS);
    onApply(EMPTY_STOREFRONT_FILTERS);
    setOpen(false);
  }

  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
      {activeCount > 0 ? (
        <Button type="button" variant="outline" size="sm" className="h-9" onClick={clear}>
          Limpar filtros
        </Button>
      ) : null}

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
            {activeCount > 0 ? (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                {activeCount}
              </span>
            ) : null}
          </Button>
        </SheetTrigger>

        <SheetContent className="w-full overflow-hidden sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Filtros dos produtos do Site</SheetTitle>
            <SheetDescription>Combine os filtros e aplique para atualizar a lista.</SheetDescription>
          </SheetHeader>

          <form className="flex min-h-0 flex-1 flex-col" onSubmit={event=>{event.preventDefault();if(!rangeError){onApply(draft);setOpen(false);}}}>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-4">
              <div className="space-y-2">
                <Label>Situação de publicação</Label>
                <Select value={draft.status} onValueChange={(value) => update("status", value)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas</SelectItem>
                    <SelectItem value="unpublished">Ainda não configurados</SelectItem>
                    <SelectItem value="draft">Rascunhos (não publicados)</SelectItem>
                    <SelectItem value="published">Publicados</SelectItem>
                    <SelectItem value="paused">Pausados</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Envio de dados para a loja</Label>
                <Select value={draft.syncStatus} onValueChange={(value) => update("syncStatus", value)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="pending">Envio pendente</SelectItem>
                    <SelectItem value="synced">Dados sincronizados</SelectItem>
                    <SelectItem value="error">Com erro no envio</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Sincronizado confirma apenas o envio do estado atual; não significa que o item está publicado.</p>
              </div>

              <div className="space-y-2">
                <Label>Grupo</Label>
                <SearchCombobox
                  value={draft.groupId}
                  onValueChange={(value) => update("groupId", value)}
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
                  <Select
                    value={draft.condition || "ALL"}
                    onValueChange={(value) => update("condition", value === "ALL" ? "" : value)}
                  >
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">Todas</SelectItem>
                      <SelectItem value="NOVO">Novo</SelectItem>
                      <SelectItem value="USADO">Usado</SelectItem>
                      <SelectItem value="RECONDICIONADO">Recondicionado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Imagem</Label>
                  <Select
                    value={draft.image || "all"}
                    onValueChange={(value) => update("image", value === "all" ? "" : value)}
                  >
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="with">Com imagem</SelectItem>
                      <SelectItem value="without">Sem imagem</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="site-product-manufacturer">Fabricante</Label>
                <Input
                  id="site-product-manufacturer"
                  value={draft.manufacturer}
                  onChange={(event) => update("manufacturer", event.target.value)}
                  placeholder="Qualquer fabricante"
                />
              </div>

              <div className="space-y-2 border-t pt-4">
                <Label>Faixa de estoque</Label>
                <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" onClick={()=>setDraft(current=>({...current,stockMin:"1",stockMax:""}))}>Com estoque</Button><Button type="button" variant="outline" size="sm" onClick={()=>setDraft(current=>({...current,stockMin:"0",stockMax:"0"}))}>Sem estoque</Button></div>
                <div className="grid grid-cols-2 gap-3">
                  <Input type="number" min="0" value={draft.stockMin} onChange={(event) => update("stockMin", event.target.value)} aria-label="Valor mínimo" placeholder="Mínimo" />
                  <Input type="number" min="0" value={draft.stockMax} onChange={(event) => update("stockMax", event.target.value)} aria-label="Valor máximo" placeholder="Máximo" />
                </div>
              </div>

              <AmountRangeFilter id="site-product-price" title="Faixa de preço de venda (R$)" minValue={draft.priceMin} maxValue={draft.priceMax} onChange={(priceMin,priceMax)=>setDraft(current=>({...current,priceMin,priceMax}))}/>

              {rangeError&&<p role="alert" className="text-sm text-destructive">{rangeError}</p>}
            </div>
            <div className="flex justify-between gap-2 border-t p-4">
              <Button type="button" variant="outline" onClick={clear}>Limpar filtros</Button>
              <Button type="submit" disabled={Boolean(rangeError)}>Aplicar filtros</Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
