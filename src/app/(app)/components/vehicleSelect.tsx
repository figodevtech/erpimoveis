"use client";

import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import {
  ArrowRight,
  Bike,
  Car,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeft,
  ChevronsRight,
  FileText,
  Filter,
  Gauge,
  LayoutGrid,
  List,
  Loader2,
  PackageSearch,
  Plus,
  Truck,
  User,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SelectSearchInput } from "./select-search-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { VeiculoDialog } from "../(pages)/veiculos/dialgo-veiculo/dialog-veiculo";
import type { Pagination, Veiculo } from "../(pages)/veiculos/types";

interface VehicleSelectProps {
  children?: ReactNode;
  OnSelect?: (value: Veiculo) => void;
  setOpen?: (value: boolean) => void;
  open?: boolean;
  clienteId?: number | null;
  title?: string;
}

function formatarCpfCnpj(val?: string | null) {
  if (!val) return "—";
  const clean = val.replace(/\D+/g, "");
  if (clean.length === 11) {
    return clean.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }
  if (clean.length === 14) {
    return clean.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  }
  return val;
}

export default function VehicleSelect({
  children,
  OnSelect,
  setOpen,
  open,
  clienteId,
  title,
}: VehicleSelectProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [pagination, setPagination] = useState<Pagination>({
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 0,
  });

  const [vehicleItems, setVehicleItems] = useState<Veiculo[]>([]);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [tipoFilter, setTipoFilter] = useState<string>("TODOS");

  const requestSequence = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const [openVeiculo, setOpenVeiculo] = useState(false);

  const handleGetVehicles = useCallback(async (
    pageNumber?: number,
    limit?: number,
    searchText?: string,
    tipoVeiculo?: string,
  ) => {
    const requestId = ++requestSequence.current;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setIsLoading(true);

    try {
      const response = await axios.get("/api/veiculos", {
        signal: controller.signal,
        params: {
          page: pageNumber || 1,
          limit: limit || pagination.limit,
          search: searchText !== undefined ? searchText : search,
          clienteId: clienteId ?? undefined,
          tipo: tipoVeiculo !== undefined && tipoVeiculo !== "TODOS" ? tipoVeiculo : undefined,
        },
      });

      if (response.status === 200 && requestId === requestSequence.current) {
        const { data } = response;
        setVehicleItems(Array.isArray(data.data) ? data.data : []);
        setPagination(data.pagination || { total: 0, page: 1, limit: 20, totalPages: 0 });
      }
    } catch (error) {
      if (!axios.isCancel(error) && requestId === requestSequence.current) {
        setVehicleItems([]);
      }
    } finally {
      if (requestId === requestSequence.current) {
        setIsLoading(false);
      }
    }
  }, [clienteId, pagination.limit, search]);

  useEffect(() => {
    requestSequence.current += 1;
    requestController.current?.abort();
    const timeout = window.setTimeout(() => setSearch(searchInput.trim()), 400);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    if (open) {
      void handleGetVehicles(1, pagination.limit, search, tipoFilter);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, search, tipoFilter]);

  useEffect(() => () => requestController.current?.abort(), []);

  const executarBusca = () => {
    const term = searchInput.trim();
    if (term === search) {
      void handleGetVehicles(1, pagination.limit, term, tipoFilter);
    } else {
      setSearch(term);
    }
  };

  const limparBusca = () => {
    setSearchInput("");
    if (search === "") {
      void handleGetVehicles(1, pagination.limit, "", tipoFilter);
    } else {
      setSearch("");
    }
  };

  const handleSelectVehicle = (veiculo: Veiculo) => {
    if (OnSelect) OnSelect(veiculo);
    if (setOpen) {
      setOpen(false);
      setSearchInput("");
      setSearch("");
    }
  };

  const renderTipoIcon = (tipo?: string) => {
    switch (tipo) {
      case "MOTOS":
        return <Bike className="size-4" />;
      case "CAMINHOES":
        return <Truck className="size-4" />;
      default:
        return <Car className="size-4" />;
    }
  };

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (setOpen) setOpen(nextOpen);
        if (!nextOpen) {
          setSearchInput("");
          setSearch("");
        }
      }}
      open={open}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="flex flex-col w-screen h-[100dvh] max-w-full max-h-none m-0 p-0 gap-0 rounded-none border-0 bg-card shadow-2xl overflow-hidden inset-0 top-0 left-0 translate-x-0 translate-y-0 sm:top-[50%] sm:left-[50%] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-[95vw] sm:max-w-5xl lg:max-w-6xl sm:h-[88vh] sm:max-h-[850px] sm:rounded-2xl sm:border min-w-0">

        {/* Header Fixo */}
        <DialogHeader className="shrink-0 p-4 sm:p-5 pr-10 sm:pr-12 border-b border-border/60 bg-muted/20 text-left">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-2xs">
                <Car className="size-5" />
              </div>
              <div>
                <DialogTitle className="text-base sm:text-lg font-semibold tracking-tight">
                  {title ?? "Selecionar Veículo"}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Busque por placa, modelo, marca, ano, chassi ou proprietário.
                </DialogDescription>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                onClick={() => setOpenVeiculo(true)}
                size="sm"
                className="h-9 px-3 text-xs gap-1.5 hover:cursor-pointer font-medium shadow-2xs"
              >
                <Plus className="size-4" />
                <span>Novo Veículo</span>
              </Button>

              <VeiculoDialog
                isOpen={openVeiculo}
                setIsOpen={(dialogOpen) => {
                  if (!dialogOpen) {
                    void handleGetVehicles(1, pagination.limit, search, tipoFilter);
                  }
                  setOpenVeiculo(dialogOpen);
                }}
                clienteId={clienteId ?? undefined}
                onRegister={() => void handleGetVehicles(1, pagination.limit, search, tipoFilter)}
              />
            </div>
          </div>
        </DialogHeader>

        {/* Indicador de Carregamento Topo */}
        <div className="relative h-1 w-full bg-muted overflow-hidden shrink-0">
          {isLoading && (
            <div className="absolute inset-0 bg-primary animate-pulse" />
          )}
        </div>

        {/* Filtros e Busca */}
        <div className="shrink-0 p-4 border-b border-border/40 bg-card space-y-3">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-start gap-3 justify-between">
            <div className="flex-1 min-w-0 space-y-1.5">
              <SelectSearchInput
                value={searchInput}
                onValueChange={setSearchInput}
                onSearch={executarBusca}
                onClear={limparBusca}
                placeholder="Buscar por placa, modelo, marca, #12 (ID) ou proprietário..."
              />
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground px-0.5">
                <span className="font-semibold text-primary">Dicas:</span>
                <span><code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-bold text-foreground">#12</code> ID exato</span>
                <span>•</span>
                <span><code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-bold text-foreground">ABC-1234</code> Placa</span>
              </div>
            </div>

            {/* Controles de Visualização & Filtro Tipo */}
            <div className="flex items-center gap-2 shrink-0">
              <Select
                value={tipoFilter}
                onValueChange={(val) => setTipoFilter(val)}
              >
                <SelectTrigger className="h-9 text-xs rounded-xl w-36 bg-card">
                  <Filter className="size-3.5 mr-1.5 text-muted-foreground" />
                  <SelectValue placeholder="Tipo Veículo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TODOS">Todos os Tipos</SelectItem>
                  <SelectItem value="CARROS">Carros</SelectItem>
                  <SelectItem value="MOTOS">Motos</SelectItem>
                  <SelectItem value="CAMINHOES">Caminhões</SelectItem>
                </SelectContent>
              </Select>

              <div className="flex items-center rounded-xl border border-border p-0.5 bg-muted/30">
                <Button
                  type="button"
                  variant={viewMode === "grid" ? "secondary" : "ghost"}
                  size="icon"
                  onClick={() => setViewMode("grid")}
                  className="h-8 w-8 rounded-lg hover:cursor-pointer"
                  title="Visualização em Cards"
                >
                  <LayoutGrid className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant={viewMode === "table" ? "secondary" : "ghost"}
                  size="icon"
                  onClick={() => setViewMode("table")}
                  className="h-8 w-8 rounded-lg hover:cursor-pointer"
                  title="Visualização em Tabela"
                >
                  <List className="size-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Conteúdo Central Scrollável */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 min-h-0 min-w-0 w-full bg-muted/10">
          {isLoading && vehicleItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
              <Loader2 className="size-8 animate-spin text-primary" />
              <span className="text-xs font-medium">Buscando veículos na base...</span>
            </div>
          ) : vehicleItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center p-6 space-y-3 rounded-2xl border border-dashed border-border/80 bg-card">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <PackageSearch className="size-6" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-semibold">Nenhum veículo encontrado</h4>
                <p className="text-xs text-muted-foreground max-w-sm">
                  {search
                    ? `Não encontramos resultados para "${search}". Tente buscar por outros termos como marca, modelo ou placa.`
                    : "Nenhum veículo cadastrado na base."}
                </p>
              </div>
              {search ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={limparBusca}
                  className="text-xs hover:cursor-pointer"
                >
                  Limpar Pesquisa
                </Button>
              ) : null}
            </div>
          ) : viewMode === "grid" ? (
            /* Visualização em CARDS Grid */
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {vehicleItems.map((v) => {
                const clienteNome = v.cliente?.nomerazaosocial;

                return (
                  <div
                    key={v.id}
                    onClick={() => handleSelectVehicle(v)}
                    className="group relative flex flex-col justify-between rounded-2xl border border-border/60 p-4 bg-card transition-all hover:shadow-md hover:border-primary/50 hover:bg-accent/20 hover:cursor-pointer"
                  >
                    {/* Topo do Card */}
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 border border-primary/20 text-primary group-hover:scale-105 transition-transform">
                            {renderTipoIcon(v.tipo)}
                          </div>
                          <Badge
                            variant="outline"
                            className="text-[10px] font-mono px-2 py-0.5 bg-muted/50 border-border/60 text-muted-foreground"
                          >
                            ID #{v.id}
                          </Badge>
                        </div>

                        <Badge
                          variant="outline"
                          className="text-[11px] font-mono font-bold px-2 py-0.5 bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 border-slate-700 shadow-2xs"
                        >
                          {v.placa || "SEM PLACA"}
                        </Badge>
                      </div>

                      {/* Marca e Modelo */}
                      <div>
                        <h3 className="text-xs sm:text-sm font-semibold text-foreground leading-snug line-clamp-2 group-hover:text-primary transition-colors">
                          {[v.marca, v.modelo].filter(Boolean).join(" ") || "Veículo sem modelo"}
                        </h3>
                        <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2">
                          {v.ano ? <span>Ano: <strong className="text-foreground/80">{v.ano}</strong></span> : null}
                          {v.cor ? <span>• Cor: <strong className="text-foreground/80">{v.cor}</strong></span> : null}
                        </p>
                      </div>

                      {/* KM & Proprietário */}
                      <div className="space-y-1.5 pt-2 border-t border-border/40 text-[11px] text-muted-foreground">
                        {v.kmatual !== undefined && v.kmatual !== null ? (
                          <div className="flex items-center gap-1.5">
                            <Gauge className="size-3 shrink-0 text-muted-foreground/70" />
                            <span><strong className="font-mono text-foreground/80">{v.kmatual.toLocaleString()}</strong> km</span>
                          </div>
                        ) : null}

                        <div className="flex items-center gap-1.5 truncate">
                          <User className="size-3 shrink-0 text-muted-foreground/70" />
                          <span className="truncate">
                            {clienteNome ? (
                              <strong className="font-medium text-foreground/80">{clienteNome}</strong>
                            ) : (
                              <span className="italic text-muted-foreground">Sem proprietário</span>
                            )}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Rodapé do Card */}
                    <div className="mt-4 pt-3 border-t border-border/50 flex items-center justify-between gap-2">
                      <Badge
                        variant="outline"
                        className="text-[10px] px-2 py-0.5 font-medium bg-muted/60 text-muted-foreground"
                      >
                        {v.tipo || "CARROS"}
                      </Badge>

                      <div className="flex items-center gap-1 text-xs font-semibold text-primary">
                        <span>Selecionar</span>
                        <ArrowRight className="size-4 group-hover:translate-x-0.5 transition-transform" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* Visualização em TABELA */
            <div className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-2xs">
              <Table className="text-xs">
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="w-16">ID</TableHead>
                    <TableHead className="w-28">Placa</TableHead>
                    <TableHead>Veículo (Marca / Modelo / Ano)</TableHead>
                    <TableHead className="hidden sm:table-cell">Proprietário</TableHead>
                    <TableHead className="hidden md:table-cell">KM</TableHead>
                    <TableHead className="hidden lg:table-cell">Tipo</TableHead>
                    <TableHead className="w-20 text-center">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vehicleItems.map((v) => {
                    return (
                      <TableRow
                        key={v.id}
                        onClick={() => handleSelectVehicle(v)}
                        className="hover:cursor-pointer transition-colors hover:bg-muted/40"
                      >
                        <TableCell className="font-mono text-muted-foreground">
                          #{v.id}
                        </TableCell>

                        <TableCell>
                          <Badge
                            variant="outline"
                            className="font-mono text-[10px] font-bold px-1.5 py-0.5 bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 border-slate-700"
                          >
                            {v.placa || "SEM PLACA"}
                          </Badge>
                        </TableCell>

                        <TableCell>
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted border text-muted-foreground">
                              {renderTipoIcon(v.tipo)}
                            </div>
                            <div className="flex flex-col min-w-0 space-y-0.5">
                              <span className="font-semibold text-foreground truncate max-w-xs sm:max-w-md">
                                {[v.marca, v.modelo].filter(Boolean).join(" ") || "Veículo sem modelo"}
                              </span>
                              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                {v.ano ? <span>{v.ano}</span> : null}
                                {v.cor ? <span>• {v.cor}</span> : null}
                              </div>
                            </div>
                          </div>
                        </TableCell>

                        <TableCell className="hidden sm:table-cell text-muted-foreground truncate max-w-[160px]">
                          {v.cliente?.nomerazaosocial || "Sem proprietário"}
                        </TableCell>

                        <TableCell className="hidden md:table-cell font-mono text-muted-foreground">
                          {v.kmatual !== undefined && v.kmatual !== null ? `${v.kmatual.toLocaleString()} km` : "—"}
                        </TableCell>

                        <TableCell className="hidden lg:table-cell text-muted-foreground">
                          {v.tipo || "CARROS"}
                        </TableCell>

                        <TableCell className="text-center">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs text-primary hover:bg-primary/10 hover:cursor-pointer"
                          >
                            Selecionar
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {/* Rodapé Fixo com Paginação */}
        <DialogFooter className="shrink-0 p-3 sm:p-4 border-t border-border/60 bg-muted/20">
          <div className="flex flex-wrap items-center justify-between gap-3 w-full">
            {/* Contador de Registros */}
            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
              <span>
                Exibindo <strong className="text-foreground">{vehicleItems.length}</strong> de{" "}
                <strong className="text-foreground">{pagination.total}</strong> veículos
              </span>
              {isLoading && <Loader2 className="size-3.5 animate-spin text-primary ml-1" />}
            </div>

            {/* Controles de Páginas */}
            <div className="flex items-center gap-1 sm:gap-2">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 hover:cursor-pointer"
                onClick={() => handleGetVehicles(1, pagination.limit, search, tipoFilter)}
                disabled={pagination.page <= 1 || isLoading}
                title="Primeira página"
              >
                <ChevronsLeft className="size-4" />
              </Button>

              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 hover:cursor-pointer"
                onClick={() => handleGetVehicles(pagination.page - 1, pagination.limit, search, tipoFilter)}
                disabled={pagination.page <= 1 || isLoading}
                title="Página anterior"
              >
                <ChevronLeftIcon className="size-4" />
              </Button>

              <span className="text-xs font-semibold px-2">
                Pág. {pagination.page} de {pagination.totalPages || 1}
              </span>

              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 hover:cursor-pointer"
                onClick={() => handleGetVehicles(pagination.page + 1, pagination.limit, search, tipoFilter)}
                disabled={pagination.page >= pagination.totalPages || pagination.totalPages === 0 || isLoading}
                title="Próxima página"
              >
                <ChevronRightIcon className="size-4" />
              </Button>

              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 hover:cursor-pointer"
                onClick={() => handleGetVehicles(pagination.totalPages, pagination.limit, search, tipoFilter)}
                disabled={pagination.page >= pagination.totalPages || pagination.totalPages === 0 || isLoading}
                title="Última página"
              >
                <ChevronsRight className="size-4" />
              </Button>
            </div>

            {/* Select Itens Por Página */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground hidden sm:inline">Exibir:</span>
              <Select
                value={String(pagination.limit)}
                onValueChange={(val) => {
                  const newLimit = Number(val);
                  void handleGetVehicles(1, newLimit, search, tipoFilter);
                }}
              >
                <SelectTrigger className="h-8 text-xs w-20 rounded-xl">
                  <SelectValue placeholder={pagination.limit} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="20">20/pg</SelectItem>
                  <SelectItem value="50">50/pg</SelectItem>
                  <SelectItem value="100">100/pg</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
