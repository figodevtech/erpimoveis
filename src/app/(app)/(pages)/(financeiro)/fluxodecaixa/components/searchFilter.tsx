"use client";

import * as React from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { DateRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePaymentMethodOptions } from "@/hooks/use-payment-method-options";
import { cn } from "@/lib/utils";
import { Calendar as CalendarIcon, SlidersHorizontal } from "lucide-react";
import type { Banco, FluxoViewMode, TransactionRelationFilters } from "../types";
import { Tipo_transacao, VIEW_MODE_TABS } from "../types";
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
  apenasMinhas: boolean;
  setApenasMinhas: (value: boolean) => void;
  /**
   * `financeiro:ver_todas_transacoes`. Sem ela o recorte e do servidor e nao ha
   * o que alternar — no lugar do controle fica a explicacao.
   */
  podeVerTodas: boolean;
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
  apenasMinhas,
  setApenasMinhas,
  podeVerTodas,
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
  const [draftApenasMinhas, setDraftApenasMinhas] = React.useState(apenasMinhas);
  const [draftRelationFilters, setDraftRelationFilters] =
    React.useState<TransactionRelationFilters>(relationFilters);
  const [banks, setBanks] = React.useState<Banco[]>([]);
  const [loadingBanks, setLoadingBanks] = React.useState(false);
  const [bankLoadError, setBankLoadError] = React.useState<string | null>(null);
  const { categorias, loadingCategorias, errorCategorias } = useCategoriasTransacao();
  const { gruposPlanosDeConta, loadingPlanos, errorPlanos } = usePlanosDeConta();
  const { centrosCusto, loadingCentrosCusto, errorCentrosCusto } = useCentrosCusto();
  const {
    options: paymentMethodOptions,
    isLoading: loadingPaymentMethods,
    error: paymentMethodsError,
  } = usePaymentMethodOptions();

  React.useEffect(() => {
    if (!sheetOpen) {
      setDraftSearch(search);
      setDraftTipo(tipo);
      setDraftDateFrom(dateFrom);
      setDraftDateTo(dateTo);
      setDraftViewMode(viewMode);
      setDraftApenasMinhas(apenasMinhas);
      setDraftRelationFilters(relationFilters);
    }
  }, [sheetOpen, search, tipo, dateFrom, dateTo, viewMode, relationFilters, apenasMinhas]);

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
    viewMode !== "FLUXO" ? viewMode : "",
    relationFilters.categoriaId,
    relationFilters.bancoId,
    relationFilters.planoContaId,
    relationFilters.centroCustoId,
    relationFilters.metodoPagamento,
    // Só conta como filtro quando foi a pessoa que o ligou: para quem não pode
    // ver tudo o recorte é permanente, e um contador que nunca zera convida a
    // clicar em "Limpar filtros" atrás de um botão que não existe.
    podeVerTodas && apenasMinhas ? "apenasMinhas" : "",
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
    setApenasMinhas(draftApenasMinhas);
    setSheetOpen(false);
  };

  const clearFilters = () => {
    setDraftSearch("");
    setDraftTipo("");
    setDraftDateFrom("");
    setDraftDateTo("");
    setDraftViewMode("FLUXO");
    setDraftApenasMinhas(false);
    const emptyRelations: TransactionRelationFilters = {
      categoriaId: "",
      bancoId: "",
      planoContaId: "",
      centroCustoId: "",
      metodoPagamento: "",
    };
    setDraftRelationFilters(emptyRelations);
    setSearch("");
    setTipo("");
    setDateFrom("");
    setDateTo("");
    setViewMode("FLUXO");
    setRelationFilters(emptyRelations);
    setApenasMinhas(false);
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

          {/*
            Três faixas: cabeçalho, miolo que rola e rodapé fixo.

            Os botões viviam no fim do conteúdo, então com todos os filtros
            abertos era preciso rolar até o fim para aplicar — e em tela baixa
            eles simplesmente não apareciam. Agora só o miolo rola; Aplicar e
            Limpar ficam sempre à vista.

            `min-h-0` no miolo é o que faz o `overflow-y-auto` valer: sem ele, um
            filho de flex adota a altura do conteúdo e empurra o rodapé para fora
            da tela em vez de rolar.

            O `gap-4` que o SheetContent traz sai daqui: a separação entre as
            faixas passa a ser a borda de cada uma, e o espaço extra só somaria
            altura ao que já está apertado.
          */}
          <SheetContent className="w-full gap-0 overflow-hidden sm:max-w-md">
            <SheetHeader className="shrink-0 border-b">
              <SheetTitle>Filtros do fluxo de caixa</SheetTitle>
            </SheetHeader>

            <div className="grid min-h-0 flex-1 auto-rows-min gap-5 overflow-y-auto p-4">
              <div className="space-y-2">
                <Label>Visualização</Label>
                <Tabs value={draftViewMode} onValueChange={(value) => setDraftViewMode(value as FluxoViewMode)}>
                  {/* Mesma lista das abas do cabeçalho da tabela, na mesma ordem. */}
                  <TabsList className="grid h-auto w-full grid-cols-2">
                    {VIEW_MODE_TABS.map((tab) => (
                      <TabsTrigger
                        key={tab.value}
                        value={tab.value}
                        className="px-2 text-xs sm:text-sm"
                      >
                        {tab.label}
                      </TabsTrigger>
                    ))}
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
                    placeholder="Descrição, pagador, valor, categoria, nota..."
                    aria-describedby="fluxo-search-ajuda"
                  />
                  <p id="fluxo-search-ajuda" className="text-xs text-muted-foreground">
                    Procura em descrição, pagador, CPF/CNPJ, valor (ex.: 894,19),
                    categoria, plano de conta, centro de custo e dados do
                    documento. Use{" "}
                    <span className="font-medium text-foreground">#87</span> para
                    abrir direto o lançamento 87.
                  </p>
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

                <div className="space-y-2">
                  <Label>Método de pagamento</Label>
                  <Select
                    disabled={loadingPaymentMethods || !!paymentMethodsError}
                    value={draftRelationFilters.metodoPagamento || ""}
                    onValueChange={(value) =>
                      setDraftRelationFilters((current) => ({
                        ...current,
                        metodoPagamento: value === "TODOS" ? "" : value,
                      }))
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue
                        placeholder={
                          paymentMethodsError
                            ? "Erro ao carregar"
                            : loadingPaymentMethods
                              ? "Carregando..."
                              : "Todos os métodos"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="TODOS">Todos os métodos</SelectItem>
                      {paymentMethodOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
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
                  <Label>Autoria</Label>
                  {/*
                    Quem pode ver tudo alterna; quem não pode lê por que a lista
                    está recortada. Um checkbox desabilitado diria a mesma coisa
                    pior: parece um ajuste que a pessoa poderia destravar.
                  */}
                  {podeVerTodas ? (
                    <label className="flex items-start gap-2 text-sm hover:cursor-pointer">
                      <Checkbox
                        checked={draftApenasMinhas}
                        onCheckedChange={(valor) => setDraftApenasMinhas(valor === true)}
                        className="mt-0.5 hover:cursor-pointer"
                      />
                      <span>
                        Apenas as transações que eu criei
                        <span className="block text-xs text-muted-foreground">
                          Vale para a lista, os cartões e a exportação. Os
                          registros sem autor continuam aparecendo.
                        </span>
                      </span>
                    </label>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Você vê os lançamentos compartilhados entre usuários comuns,
                      incluindo registros sem autor. Lançamentos de quem possui
                      “Caixa administrativo” ficam ocultos.
                    </p>
                  )}
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
              </div>
            </div>

            <div className="shrink-0 border-t bg-background p-4">
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={clearFilters}>
                  Limpar
                </Button>
                <Button type="button" onClick={applyFilters}>
                  Aplicar filtros
                </Button>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}
