"use client";

import * as React from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { DateRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { Calendar as CalendarIcon, SlidersHorizontal } from "lucide-react";
import type { Banco, FluxoViewMode, TransactionRelationFilters } from "../types";
import { Tipo_transacao } from "../types";
import { useCategoriasTransacao } from "../hooks/use-categoria-transacao";
import { useCentrosCusto } from "../hooks/use-centros-custo";
import { usePlanosDeConta } from "../hooks/use-planos-de-conta";
import { PlanoContaCombobox } from "./plano-conta-combobox";
import { SearchCombobox } from "./search-combobox";

interface SearchFilterProps {
  setDateFrom: (value: string) => void;
  setDateTo: (value: string) => void;
  dateFrom: string;
  dateTo: string;
  search: string;
  setSearch: (value: string) => void;
  setTipo: (value: Tipo_transacao | "") => void;
  tipo: Tipo_transacao | "";
  viewMode: FluxoViewMode;
  setViewMode: (value: FluxoViewMode) => void;
  relationFilters: TransactionRelationFilters;
  setRelationFilters: (value: TransactionRelationFilters) => void;
  lockedTipoLabel?: string;
  renderOnlyTrigger?: boolean;
}

function parseYYYYMMDD(v: string): Date | undefined {
  if (!v) return undefined;
  const d = new Date(`${v}T00:00:00`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function toYYYYMMDD(d?: Date): string {
  return d ? format(d, "yyyy-MM-dd") : "";
}

export default function SearchFilter({
  setSearch,
  search,
  setTipo,
  tipo,
  dateFrom,
  dateTo,
  setDateFrom,
  setDateTo,
  viewMode,
  setViewMode,
  relationFilters,
  setRelationFilters,
  lockedTipoLabel,
  renderOnlyTrigger = false,
}: SearchFilterProps) {
  const uid = React.useId();
  const listboxId = `${uid}-tipo-listbox`;
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [openRange, setOpenRange] = React.useState(false);
  const [draftSearch, setDraftSearch] = React.useState(search);
  const [draftTipo, setDraftTipo] = React.useState<Tipo_transacao | "">(tipo);
  const [draftDateFrom, setDraftDateFrom] = React.useState(dateFrom);
  const [draftDateTo, setDraftDateTo] = React.useState(dateTo);
  const [draftViewMode, setDraftViewMode] = React.useState<FluxoViewMode>(viewMode);
  const [draftRelationFilters, setDraftRelationFilters] =
    React.useState<TransactionRelationFilters>(relationFilters);
  const [banks, setBanks] = React.useState<Banco[]>([]);
  const [loadingBanks, setLoadingBanks] = React.useState(false);
  const [bankLoadError, setBankLoadError] = React.useState<string | null>(null);
  const { categorias, loadingCategorias, errorCategorias } = useCategoriasTransacao();
  const { gruposPlanosDeConta, loadingPlanos, errorPlanos } = usePlanosDeConta();
  const { centrosCusto, loadingCentrosCusto, errorCentrosCusto } = useCentrosCusto();

  React.useEffect(() => {
    if (!sheetOpen) {
      setDraftSearch(search);
      setDraftTipo(tipo);
      setDraftDateFrom(dateFrom);
      setDraftDateTo(dateTo);
      setDraftViewMode(viewMode);
      setDraftRelationFilters(relationFilters);
    }
  }, [sheetOpen, search, tipo, dateFrom, dateTo, viewMode, relationFilters]);

  React.useEffect(() => {
    if (!sheetOpen) return;
    let active = true;

    async function loadBanks() {
      try {
        setLoadingBanks(true);
        setBankLoadError(null);
        const response = await fetch("/api/banks?limit=100", { cache: "no-store" });
        const json = await response.json();
        if (!response.ok) throw new Error(json?.error || "Erro ao carregar bancos");
        if (active) setBanks(json.data ?? []);
      } catch (error) {
        console.error("Erro ao carregar bancos dos filtros:", error);
        if (active) {
          setBanks([]);
          setBankLoadError("Erro ao carregar bancos");
        }
      } finally {
        if (active) setLoadingBanks(false);
      }
    }

    void loadBanks();
    return () => {
      active = false;
    };
  }, [sheetOpen]);

  const range: DateRange | undefined = React.useMemo(() => {
    const from = parseYYYYMMDD(draftDateFrom);
    const to = parseYYYYMMDD(draftDateTo);
    if (!from && !to) return undefined;
    return { from, to };
  }, [draftDateFrom, draftDateTo]);

  const activeCount = [
    search.trim(),
    tipo,
    dateFrom,
    dateTo,
    viewMode !== "TODAS" ? viewMode : "",
    relationFilters.categoriaId,
    relationFilters.bancoId,
    relationFilters.planoContaId,
    relationFilters.centroCustoId,
  ].filter(Boolean).length;

  const periodLabel = React.useMemo(() => {
    const from = range?.from;
    const to = range?.to;
    if (from && to) return `${format(from, "dd/MM/yyyy")} - ${format(to, "dd/MM/yyyy")}`;
    if (from && !to) return `${format(from, "dd/MM/yyyy")} - ...`;
    return "Período";
  }, [range?.from, range?.to]);

  // A_PAGAR/A_RECEBER derivam o tipo da própria visualização; Liquidadas não.
  // Vale o modo em rascunho, não o aplicado: o usuário pode trocar os dois no
  // mesmo passe pelo sheet.
  const tipoBloqueado = draftViewMode === "A_RECEBER" || draftViewMode === "A_PAGAR";

  const applyFilters = () => {
    setSearch(draftSearch);
    setTipo(tipoBloqueado ? "" : draftTipo);
    setDateFrom(draftDateFrom);
    setDateTo(draftDateTo);
    setViewMode(draftViewMode);
    setRelationFilters(draftRelationFilters);
    setSheetOpen(false);
  };

  const clearFilters = () => {
    setDraftSearch("");
    setDraftTipo("");
    setDraftDateFrom("");
    setDraftDateTo("");
    setDraftViewMode("TODAS");
    const emptyRelations: TransactionRelationFilters = {
      categoriaId: "",
      bancoId: "",
      planoContaId: "",
      centroCustoId: "",
    };
    setDraftRelationFilters(emptyRelations);
    setSearch("");
    setTipo("");
    setDateFrom("");
    setDateTo("");
    setViewMode("TODAS");
    setRelationFilters(emptyRelations);
  };

  return (
    <div className={cn("w-full", renderOnlyTrigger && "sm:w-auto")}>
      <div className={cn("flex items-center gap-2", renderOnlyTrigger && "w-full flex-col sm:w-auto sm:flex-row")}>
        {activeCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="h-9 w-full justify-center hover:cursor-pointer sm:w-auto"
            onClick={clearFilters}
          >
            Limpar filtros
          </Button>
        )}

        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-9 w-full justify-center gap-2 hover:cursor-pointer sm:w-auto"
            >
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
              <SheetTitle>Filtros do fluxo de caixa</SheetTitle>
            </SheetHeader>

            <div className="grid flex-1 auto-rows-min gap-5 overflow-y-auto p-4">
              <div className="space-y-2">
                <Label>Visualização</Label>
                <Tabs value={draftViewMode} onValueChange={(value) => setDraftViewMode(value as FluxoViewMode)}>
                  <TabsList className="grid h-auto w-full grid-cols-2">
                    <TabsTrigger value="TODAS" className="px-2 text-xs sm:text-sm">
                      Todas
                    </TabsTrigger>
                    <TabsTrigger value="LIQUIDADAS" className="px-2 text-xs sm:text-sm">
                      Liquidadas
                    </TabsTrigger>
                    <TabsTrigger value="A_RECEBER" className="px-2 text-xs sm:text-sm">
                      A receber
                    </TabsTrigger>
                    <TabsTrigger value="A_PAGAR" className="px-2 text-xs sm:text-sm">
                      A pagar
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              <div className="space-y-5 rounded-xl border bg-card p-4">
                <div className="space-y-2">
                  <Label htmlFor="fluxo-search">Busca</Label>
                  <Input
                    id="fluxo-search"
                    value={draftSearch}
                    onChange={(e) => setDraftSearch(e.target.value)}
                    placeholder="Buscar na descrição"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Tipo</Label>
                  <Select
                    disabled={tipoBloqueado}
                    value={draftTipo || ""}
                    onValueChange={(value) => {
                      if (value === "TODOS") setDraftTipo("");
                      else setDraftTipo(value as Tipo_transacao);
                    }}
                  >
                    <SelectTrigger className="w-full" aria-controls={listboxId}>
                      <SelectValue
                        placeholder={
                          tipoBloqueado
                            ? lockedTipoLabel || "Tipo definido pela visualização"
                            : "Todos"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent id={listboxId}>
                      <SelectItem value="TODOS">Todos</SelectItem>
                      <SelectItem value={Tipo_transacao.RECEITA}>Receitas</SelectItem>
                      <SelectItem value={Tipo_transacao.DESPESA}>Despesas</SelectItem>
                      <SelectItem value={Tipo_transacao.DEPOSITO}>Depósitos</SelectItem>
                      <SelectItem value={Tipo_transacao.SAQUE}>Saques</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-4 border-t pt-4">
                  <p className="text-sm font-medium">Classificação</p>

                  <div className="space-y-2">
                    <Label>Categoria</Label>
                    <SearchCombobox
                      value={draftRelationFilters.categoriaId}
                      onValueChange={(categoriaId) =>
                        setDraftRelationFilters((current) => ({ ...current, categoriaId }))
                      }
                      loading={loadingCategorias}
                      disabled={!!errorCategorias}
                      placeholder={errorCategorias ? "Erro ao carregar" : "Todas as categorias"}
                      searchPlaceholder="Pesquisar categoria..."
                      emptyMessage="Nenhuma categoria encontrada."
                      clearable
                      clearLabel="Todas as categorias"
                      options={categorias.map((categoria) => ({
                        value: String(categoria.id),
                        label: categoria.nome,
                        description: categoria.descricao ?? undefined,
                      }))}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Banco / conta</Label>
                    <SearchCombobox
                      value={draftRelationFilters.bancoId}
                      onValueChange={(bancoId) =>
                        setDraftRelationFilters((current) => ({ ...current, bancoId }))
                      }
                      loading={loadingBanks}
                      disabled={!!bankLoadError}
                      placeholder={bankLoadError ?? "Todos os bancos"}
                      searchPlaceholder="Pesquisar banco ou conta..."
                      emptyMessage="Nenhum banco encontrado."
                      clearable
                      clearLabel="Todos os bancos"
                      options={banks.map((bank) => ({
                        value: String(bank.id),
                        label: bank.titulo,
                        description: [
                          bank.tipo,
                          bank.agencia && `Ag. ${bank.agencia}`,
                          bank.contanumero && `Conta ${bank.contanumero}`,
                        ]
                          .filter(Boolean)
                          .join(" · "),
                        searchText: `${bank.proprietario ?? ""} ${bank.tipo ?? ""}`,
                      }))}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Plano de conta</Label>
                    <PlanoContaCombobox
                      value={draftRelationFilters.planoContaId}
                      onValueChange={(planoContaId) =>
                        setDraftRelationFilters((current) => ({ ...current, planoContaId }))
                      }
                      onClear={() =>
                        setDraftRelationFilters((current) => ({ ...current, planoContaId: "" }))
                      }
                      clearable
                      clearLabel="Todos os planos de conta"
                      loading={loadingPlanos}
                      disabled={!!errorPlanos}
                      groups={gruposPlanosDeConta}
                      placeholder={errorPlanos ? "Erro ao carregar" : "Todos os planos de conta"}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Centro de custo</Label>
                    <SearchCombobox
                      value={draftRelationFilters.centroCustoId}
                      onValueChange={(centroCustoId) =>
                        setDraftRelationFilters((current) => ({ ...current, centroCustoId }))
                      }
                      loading={loadingCentrosCusto}
                      disabled={!!errorCentrosCusto}
                      placeholder={errorCentrosCusto ? "Erro ao carregar" : "Todos os centros de custo"}
                      searchPlaceholder="Pesquisar centro de custo..."
                      emptyMessage="Nenhum centro de custo encontrado."
                      clearable
                      clearLabel="Todos os centros de custo"
                      options={centrosCusto.map((centro) => ({
                        value: String(centro.id),
                        label: centro.nome,
                        description: centro.descricao ?? undefined,
                      }))}
                    />
                  </div>
                </div>

                <div className="space-y-2 border-t pt-4">
                  <Label>Período</Label>
                  <Popover open={openRange} onOpenChange={setOpenRange}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        className={cn(
                          "w-full justify-between text-left font-normal",
                          !range?.from && "text-muted-foreground",
                        )}
                      >
                        <span className="truncate">{periodLabel}</span>
                        <CalendarIcon className="ml-2 h-4 w-4 shrink-0 opacity-70" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <div className="p-3">
                        <Calendar
                          mode="range"
                          numberOfMonths={2}
                          selected={range}
                          onSelect={(next) => {
                            setDraftDateFrom(toYYYYMMDD(next?.from));
                            setDraftDateTo(toYYYYMMDD(next?.to));
                          }}
                          locale={ptBR}
                          initialFocus
                        />

                        <div className="mt-3 flex w-full gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            className="flex-1"
                            onClick={() => {
                              setDraftDateFrom("");
                              setDraftDateTo("");
                            }}
                          >
                            Limpar
                          </Button>

                          <Button
                            type="button"
                            className="flex-1"
                            onClick={() => setOpenRange(false)}
                            disabled={!range?.from || !range?.to}
                          >
                            Aplicar
                          </Button>
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="flex justify-end gap-2 border-t pt-4">
                  <Button type="button" variant="outline" onClick={clearFilters}>
                    Limpar
                  </Button>
                  <Button type="button" onClick={applyFilters}>
                    Aplicar filtros
                  </Button>
                </div>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}
