import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import axios from "axios";
import { ReactNode, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";

import {
  ArrowRight,
  CalendarCheck,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeft,
  ChevronsRight,
  Coins,
  Filter,
  LayoutGrid,
  List,
  Loader2,
  PackageSearch,
  Plus,
  Receipt,
  Sparkles,
  Tag,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SelectSearchInput } from "./select-search-input";
import { Servico } from "@/types/servico";
import { Pagination } from "../(pages)/estoque/types";
import ServicoDialog from "../(pages)/configuracoes/tipos/components/servicoDialog/servico-dialog";
import formatarEmReal from "@/utils/formatarEmReal";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";

interface ServiceSelectProps {
  children?: ReactNode;
  OnSelect?: (value: Servico) => void;
  setOpen?: (value: boolean) => void;
  open?: boolean;
}

type ServicoForm = {
  codigo: string;
  descricao: string;
  precohora: string;
  ativo: boolean;
  permite_agendamento: boolean;
  gera_comissao: boolean;
};

const emptyForm: ServicoForm = {
  codigo: "",
  descricao: "",
  precohora: "",
  ativo: true,
  permite_agendamento: false,
  gera_comissao: true,
};

export default function ServiceSelect({
  children,
  OnSelect,
  setOpen,
  open,
}: ServiceSelectProps) {
  const { data: session } = useSession();
  const canCreateService = permissionSetHas(
    (session?.user as any)?.permissoes,
    PERMS.CONFIG_EDITAR
  );

  const [isLoading, setIsLoading] = useState(false);
  const [pagination, setPagination] = useState<Pagination>({
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 0,
  });

  const [serviceItems, setServiceItems] = useState<Servico[]>([]);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [filterMode, setFilterMode] = useState<"TODOS" | "AGENDAVEIS" | "COMISSAO">("TODOS");

  const requestSequence = useRef(0);
  const requestController = useRef<AbortController | null>(null);

  const [form, setForm] = useState<ServicoForm>(emptyForm);
  const [openServico, setOpenServico] = useState(false);

  const handleGetServices = async (
    pageNumber?: number,
    limit?: number,
    searchText?: string
  ) => {
    const requestId = ++requestSequence.current;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setIsLoading(true);

    try {
      const response = await axios.get("/api/servicos/buscar", {
        signal: controller.signal,
        params: {
          page: pageNumber || 1,
          limit: limit || pagination.limit,
          search: searchText !== undefined ? searchText : search,
        },
      });

      if (response.status === 200 && requestId === requestSequence.current) {
        const { data } = response;
        setServiceItems(data.servicos || []);
        setPagination(data.pagination || { total: 0, page: 1, limit: 20, totalPages: 0 });
      }
    } catch (error) {
      if (!axios.isCancel(error) && requestId === requestSequence.current) {
        console.error("Erro ao buscar Serviços:", error);
      }
    } finally {
      if (requestId === requestSequence.current) {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    requestSequence.current += 1;
    requestController.current?.abort();
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 400);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (open) {
      void handleGetServices(1, pagination.limit, search);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, search]);

  useEffect(() => () => requestController.current?.abort(), []);

  const executarBusca = () => {
    const term = searchInput.trim();
    if (term === search) {
      void handleGetServices(1, pagination.limit, term);
    } else {
      setSearch(term);
    }
  };

  const limparBusca = () => {
    setSearchInput("");
    if (search === "") {
      void handleGetServices(1, pagination.limit, "");
    } else {
      setSearch("");
    }
  };

  const handleSelectService = (service: Servico) => {
    if (OnSelect) OnSelect(service);
    if (setOpen) {
      setOpen(false);
      setSearchInput("");
      setSearch("");
    }
  };

  function openNovo() {
    setForm(emptyForm);
    setOpenServico(true);
  }

  const filteredServices = serviceItems.filter((s) => {
    if (filterMode === "AGENDAVEIS") return Boolean(s.permite_agendamento);
    if (filterMode === "COMISSAO") return Boolean(s.gera_comissao);
    return true;
  });

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
                <Wrench className="size-5" />
              </div>
              <div>
                <DialogTitle className="text-base sm:text-lg font-semibold tracking-tight">
                  Selecionar Serviço
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Busque por código, descrição ou ID do serviço prestado.
                </DialogDescription>
              </div>
            </div>

            {canCreateService && (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  onClick={openNovo}
                  size="sm"
                  className="h-9 px-3 text-xs gap-1.5 hover:cursor-pointer font-medium shadow-2xs"
                >
                  <Plus className="size-4" />
                  <span>Novo Serviço</span>
                </Button>

                <ServicoDialog
                  open={openServico}
                  setOpen={(openState) => {
                    if (!openState) {
                      setForm(emptyForm);
                      void handleGetServices(1, pagination.limit, "");
                    }
                    setOpenServico(openState);
                  }}
                  loadServicos={() => handleGetServices(1, pagination.limit, "")}
                  form={form}
                  setForm={setForm}
                />
              </div>
            )}
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
                placeholder="Buscar por código, descrição do serviço ou ID..."
              />
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground px-0.5">
                <span className="font-semibold text-primary">Dicas:</span>
                <span><code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-bold text-foreground">#12</code> ID exato</span>
                <span>•</span>
                <span><code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-bold text-foreground">SERV-01</code> Código do serviço</span>
              </div>
            </div>

            {/* Controles de Visualização & Filtro */}
            <div className="flex items-center gap-2 shrink-0">
              <Select
                value={filterMode}
                onValueChange={(val) => setFilterMode(val as any)}
              >
                <SelectTrigger className="h-9 text-xs rounded-xl w-36 bg-card">
                  <Filter className="size-3.5 mr-1.5 text-muted-foreground" />
                  <SelectValue placeholder="Filtro" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TODOS">Todos os Serviços</SelectItem>
                  <SelectItem value="AGENDAVEIS">Permite Agendamento</SelectItem>
                  <SelectItem value="COMISSAO">Gera Comissão</SelectItem>
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
          {isLoading && filteredServices.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
              <Loader2 className="size-8 animate-spin text-primary" />
              <span className="text-xs font-medium">Buscando serviços no catálogo...</span>
            </div>
          ) : filteredServices.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center p-6 space-y-3 rounded-2xl border border-dashed border-border/80 bg-card">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <PackageSearch className="size-6" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-semibold">Nenhum serviço encontrado</h4>
                <p className="text-xs text-muted-foreground max-w-sm">
                  {search
                    ? `Não encontramos resultados para "${search}". Tente outros termos ou verifique o código informados.`
                    : "Nenhum serviço atende aos filtros selecionados."}
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
              {filteredServices.map((s) => {
                const valorHora = Number(s.precohora ?? 0);

                return (
                  <div
                    key={s.id}
                    onClick={() => handleSelectService(s)}
                    className="group relative flex flex-col justify-between rounded-2xl border border-border/60 p-4 bg-card transition-all hover:shadow-md hover:border-primary/50 hover:bg-accent/20 hover:cursor-pointer"
                  >
                    {/* Topo do Card */}
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 border border-primary/20 text-primary group-hover:scale-105 transition-transform">
                            <Wrench className="size-4" />
                          </div>
                          <Badge
                            variant="outline"
                            className="text-[10px] font-mono px-2 py-0.5 bg-muted/50 border-border/60 text-muted-foreground"
                          >
                            ID #{s.id}
                          </Badge>
                        </div>

                        {s.codigo ? (
                          <Badge
                            variant="secondary"
                            className="text-[10px] font-mono px-2 py-0.5 bg-muted text-muted-foreground"
                          >
                            {s.codigo}
                          </Badge>
                        ) : null}
                      </div>

                      {/* Descrição do Serviço */}
                      <div>
                        <h3 className="text-xs sm:text-sm font-semibold text-foreground leading-snug line-clamp-2 group-hover:text-primary transition-colors">
                          {s.descricao || "Serviço sem descrição"}
                        </h3>
                      </div>

                      {/* Badges de Atributos: Agendamento, Comissão, Fiscal */}
                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        {s.permite_agendamento && (
                          <Badge
                            variant="outline"
                            className="text-[10px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20 gap-1 px-1.5 py-0 font-medium"
                          >
                            <CalendarCheck className="size-3 text-emerald-600 dark:text-emerald-400" /> Agendável
                          </Badge>
                        )}
                        {s.gera_comissao && (
                          <Badge
                            variant="outline"
                            className="text-[10px] bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20 gap-1 px-1.5 py-0 font-medium"
                          >
                            <Coins className="size-3 text-blue-600 dark:text-blue-400" /> Comissão
                          </Badge>
                        )}
                        {s.codigoservicomunicipal && (
                          <Badge
                            variant="outline"
                            className="text-[10px] bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/30 gap-1 px-1.5 py-0 font-mono"
                            title="Código de Serviço Municipal"
                          >
                            <Receipt className="size-3 text-amber-600 dark:text-amber-400" /> Municipal: {s.codigoservicomunicipal}
                          </Badge>
                        )}
                      </div>
                    </div>

                    {/* Rodapé do Card: Preço */}
                    <div className="mt-4 pt-3 border-t border-border/50 flex items-center justify-between gap-2">
                      <span className="text-[11px] font-medium text-muted-foreground">
                        Preço / Hora
                      </span>

                      <div className="flex items-center gap-1.5 text-right">
                        <span className="text-sm sm:text-base font-extrabold text-foreground tracking-tight">
                          {formatarEmReal(valorHora)}
                        </span>
                        <ArrowRight className="size-4 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
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
                    <TableHead className="w-28">Código</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="hidden sm:table-cell">Atributos</TableHead>
                    <TableHead className="w-32 text-right">Valor / Hora</TableHead>
                    <TableHead className="w-20 text-center">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredServices.map((s) => {
                    const valorHora = Number(s.precohora ?? 0);

                    return (
                      <TableRow
                        key={s.id}
                        onClick={() => handleSelectService(s)}
                        className="hover:cursor-pointer transition-colors hover:bg-muted/40"
                      >
                        <TableCell className="font-mono text-muted-foreground">
                          #{s.id}
                        </TableCell>

                        <TableCell className="font-mono font-medium text-foreground">
                          {s.codigo || "—"}
                        </TableCell>

                        <TableCell>
                          <div className="flex flex-col space-y-0.5">
                            <span className="font-semibold text-foreground">
                              {s.descricao || "Serviço sem descrição"}
                            </span>
                            {s.codigoservicomunicipal ? (
                              <span className="text-[11px] text-muted-foreground font-mono">
                                Cod. Mun: {s.codigoservicomunicipal}
                              </span>
                            ) : null}
                          </div>
                        </TableCell>

                        <TableCell className="hidden sm:table-cell">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {s.permite_agendamento && (
                              <Badge
                                variant="outline"
                                className="text-[10px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20 px-1.5 py-0"
                              >
                                Agendável
                              </Badge>
                            )}
                            {s.gera_comissao && (
                              <Badge
                                variant="outline"
                                className="text-[10px] bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20 px-1.5 py-0"
                              >
                                Comissão
                              </Badge>
                            )}
                          </div>
                        </TableCell>

                        <TableCell className="text-right font-extrabold text-foreground">
                          {formatarEmReal(valorHora)}
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
                Exibindo <strong className="text-foreground">{filteredServices.length}</strong> de{" "}
                <strong className="text-foreground">{pagination.total}</strong> serviços
              </span>
              {isLoading && <Loader2 className="size-3.5 animate-spin text-primary ml-1" />}
            </div>

            {/* Controles de Páginas */}
            <div className="flex items-center gap-1 sm:gap-2">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 hover:cursor-pointer"
                onClick={() => handleGetServices(1, pagination.limit, search)}
                disabled={pagination.page <= 1 || isLoading}
                title="Primeira página"
              >
                <ChevronsLeft className="size-4" />
              </Button>

              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 hover:cursor-pointer"
                onClick={() => handleGetServices(pagination.page - 1, pagination.limit, search)}
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
                onClick={() => handleGetServices(pagination.page + 1, pagination.limit, search)}
                disabled={pagination.page >= pagination.totalPages || pagination.totalPages === 0 || isLoading}
                title="Próxima página"
              >
                <ChevronRightIcon className="size-4" />
              </Button>

              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 hover:cursor-pointer"
                onClick={() => handleGetServices(pagination.totalPages, pagination.limit, search)}
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
                  void handleGetServices(1, newLimit, search);
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
