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
import { Customer, Pagination } from "../(pages)/clientes/types";
import {
  ArrowRight,
  Building2,
  Car,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeft,
  ChevronsRight,
  FileText,
  Filter,
  LayoutGrid,
  List,
  Loader2,
  Mail,
  MapPin,
  PackageSearch,
  Phone,
  Plus,
  User,
  Users,
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
import { CustomerDialog } from "../(pages)/clientes/components/customerDialogRegister/customerDialog";
import { formatCnpj, formatCpf, normalizeCnpj, normalizeCpf } from "@/lib/fiscal-identifiers";

interface CustomerSelectProps {
  children?: ReactNode;
  OnSelect?: (value: Customer) => void;
  setOpen?: (value: boolean) => void;
  open?: boolean;
  /** Inclui o Consumidor Final na busca; só as telas de venda o aceitam. */
  permitirConsumidorFinal?: boolean;
}

function formatarCpfCnpj(val?: string | null) {
  if (!val) return "—";
  const cnpj = normalizeCnpj(val);
  if (cnpj.length === 14 || /[A-Z]/.test(cnpj)) return formatCnpj(cnpj);
  const cpf = normalizeCpf(val);
  if (cpf.length === 11) return formatCpf(cpf);
  return val;
}

export default function CustomerSelect({
  children,
  OnSelect,
  setOpen,
  open,
  permitirConsumidorFinal = false,
}: CustomerSelectProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [pagination, setPagination] = useState<Pagination>({
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 0,
  });

  const [customerItems, setCustomerItems] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [tipoPessoaFilter, setTipoPessoaFilter] = useState<"TODOS" | "FISICA" | "JURIDICA">("TODOS");

  const [openCustomer, setOpenCustomer] = useState(false);
  const requestSequence = useRef(0);
  const requestController = useRef<AbortController | null>(null);

  const handleGetCustomers = async (
    pageNumber?: number,
    limit?: number,
    searchText?: string,
    tipo?: string
  ) => {
    const requestId = ++requestSequence.current;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setIsLoading(true);

    try {
      const response = await axios.get("/api/customers/com-veiculos", {
        signal: controller.signal,
        params: {
          page: pageNumber || 1,
          limit: limit || pagination.limit,
          search: searchText !== undefined ? searchText : search,
          tipopessoa: tipo !== undefined ? tipo : tipoPessoaFilter,
          status: "TODOS",
          ...(permitirConsumidorFinal ? { consumidorFinal: "1" } : {}),
        },
      });

      if (response.status === 200 && requestId === requestSequence.current) {
        const { data } = response;
        setCustomerItems(data.data || []);
        setPagination(data.pagination || { total: 0, page: 1, limit: 20, totalPages: 0 });
      }
    } catch (error) {
      if (!axios.isCancel(error) && requestId === requestSequence.current) {
        console.error("Erro ao buscar clientes:", error);
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
      void handleGetCustomers(1, pagination.limit, search, tipoPessoaFilter);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, search, tipoPessoaFilter]);

  useEffect(() => () => requestController.current?.abort(), []);

  const executarBusca = () => {
    const term = searchInput.trim();
    if (term === search) {
      void handleGetCustomers(1, pagination.limit, term, tipoPessoaFilter);
    } else {
      setSearch(term);
    }
  };

  const limparBusca = () => {
    setSearchInput("");
    if (search === "") {
      void handleGetCustomers(1, pagination.limit, "", tipoPessoaFilter);
    } else {
      setSearch("");
    }
  };

  const handleSelectCustomer = (customer: Customer) => {
    if (OnSelect) OnSelect(customer);
    if (setOpen) {
      setOpen(false);
      setSearchInput("");
      setSearch("");
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
                <Users className="size-5" />
              </div>
              <div>
                <DialogTitle className="text-base sm:text-lg font-semibold tracking-tight">
                  Selecionar Cliente
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Busque por nome, CPF/CNPJ, e-mail, telefone, placa ou veículo.
                </DialogDescription>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                onClick={() => setOpenCustomer(true)}
                size="sm"
                className="h-9 px-3 text-xs gap-1.5 hover:cursor-pointer font-medium shadow-2xs"
              >
                <Plus className="size-4" />
                <span>Novo Cliente</span>
              </Button>

              <CustomerDialog
                isOpen={openCustomer}
                setIsOpen={(openState) => {
                  if (!openState) {
                    void handleGetCustomers(1, pagination.limit, search, tipoPessoaFilter);
                  }
                  setOpenCustomer(openState);
                }}
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
                placeholder="Buscar por nome, #12 (ID), CPF/CNPJ, telefone ou placa de veículo..."
              />
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground px-0.5">
                <span className="font-semibold text-primary">Dicas:</span>
                <span><code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-bold text-foreground">#12</code> ID exato</span>
                <span>•</span>
                <span><code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-bold text-foreground">ABC-1234</code> Busca por Placa</span>
              </div>
            </div>

            {/* Controles de Visualização & Filtro Tipo Pessoa */}
            <div className="flex items-center gap-2 shrink-0">
              <Select
                value={tipoPessoaFilter}
                onValueChange={(val) => setTipoPessoaFilter(val as any)}
              >
                <SelectTrigger className="h-9 text-xs rounded-xl w-36 bg-card">
                  <Filter className="size-3.5 mr-1.5 text-muted-foreground" />
                  <SelectValue placeholder="Tipo Pessoa" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TODOS">Todos os Tipos</SelectItem>
                  <SelectItem value="FISICA">Pessoa Física (PF)</SelectItem>
                  <SelectItem value="JURIDICA">Pessoa Jurídica (PJ)</SelectItem>
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
          {isLoading && customerItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
              <Loader2 className="size-8 animate-spin text-primary" />
              <span className="text-xs font-medium">Buscando clientes na base...</span>
            </div>
          ) : customerItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center p-6 space-y-3 rounded-2xl border border-dashed border-border/80 bg-card">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <PackageSearch className="size-6" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-semibold">Nenhum cliente encontrado</h4>
                <p className="text-xs text-muted-foreground max-w-sm">
                  {search
                    ? `Não encontramos resultados para "${search}". Tente buscar por outros termos como nome, telefone ou placa.`
                    : "Nenhum cliente encontrado para os filtros selecionados."}
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
              {customerItems.map((c) => {
                const isPJ = c.tipopessoa === "JURIDICA";
                const veiculos = c.veiculos ?? [];

                return (
                  <div
                    key={c.id}
                    onClick={() => handleSelectCustomer(c)}
                    className="group relative flex flex-col justify-between rounded-2xl border border-border/60 p-4 bg-card transition-all hover:shadow-md hover:border-primary/50 hover:bg-accent/20 hover:cursor-pointer"
                  >
                    {/* Topo do Card */}
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 border border-primary/20 text-primary group-hover:scale-105 transition-transform">
                            {isPJ ? <Building2 className="size-4" /> : <User className="size-4" />}
                          </div>
                          <Badge
                            variant="outline"
                            className="text-[10px] font-mono px-2 py-0.5 bg-muted/50 border-border/60 text-muted-foreground"
                          >
                            ID #{c.id}
                          </Badge>
                        </div>

                        <Badge
                          variant="outline"
                          className={`text-[10px] font-semibold px-2 py-0.5 ${
                            isPJ
                              ? "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/30"
                              : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                          }`}
                        >
                          {isPJ ? "Pessoa Jurídica" : "Pessoa Física"}
                        </Badge>
                      </div>

                      {/* Nome e CPF/CNPJ */}
                      <div>
                        <h3 className="text-xs sm:text-sm font-semibold text-foreground leading-snug line-clamp-2 group-hover:text-primary transition-colors">
                          {c.nomerazaosocial || "Cliente sem nome"}
                        </h3>
                        <p className="text-[11px] font-mono text-muted-foreground mt-0.5 flex items-center gap-1">
                          <FileText className="size-3 text-muted-foreground/70" />
                          <span>{formatarCpfCnpj(c.cpfcnpj)}</span>
                        </p>
                      </div>

                      {/* Contatos & Cidade */}
                      <div className="space-y-1 pt-1 border-t border-border/40 text-[11px] text-muted-foreground">
                        {c.telefone ? (
                          <div className="flex items-center gap-1.5 truncate">
                            <Phone className="size-3 shrink-0 text-muted-foreground/70" />
                            <span className="truncate">{c.telefone}</span>
                          </div>
                        ) : null}

                        {c.email ? (
                          <div className="flex items-center gap-1.5 truncate">
                            <Mail className="size-3 shrink-0 text-muted-foreground/70" />
                            <span className="truncate">{c.email}</span>
                          </div>
                        ) : null}

                        {(c.cidade || c.estado) ? (
                          <div className="flex items-center gap-1.5 truncate">
                            <MapPin className="size-3 shrink-0 text-muted-foreground/70" />
                            <span className="truncate">
                              {[c.cidade, c.estado].filter(Boolean).join(" - ")}
                            </span>
                          </div>
                        ) : null}
                      </div>

                      {/* Veículos vinculados */}
                      {veiculos.length > 0 ? (
                        <div className="pt-2 border-t border-border/40 space-y-1">
                          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block">
                            Veículos ({veiculos.length})
                          </span>
                          <div className="flex flex-wrap items-center gap-1">
                            {veiculos.slice(0, 3).map((v) => (
                              <Badge
                                key={v.id}
                                variant="outline"
                                className="text-[10px] bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/20 gap-1 px-1.5 py-0 font-mono"
                              >
                                <Car className="size-3 text-slate-500 shrink-0" />
                                <span>{v.placa || "Sem placa"}</span>
                                {v.modelo ? <span className="font-normal opacity-80">({v.modelo})</span> : null}
                              </Badge>
                            ))}
                            {veiculos.length > 3 ? (
                              <Badge variant="outline" className="text-[10px] px-1 py-0">
                                +{veiculos.length - 3}
                              </Badge>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </div>

                    {/* Rodapé do Card */}
                    <div className="mt-4 pt-3 border-t border-border/50 flex items-center justify-between gap-2">
                      <Badge
                        variant="outline"
                        className={`text-[10px] px-2 py-0.5 font-medium ${
                          c.status === "INATIVO"
                            ? "bg-rose-500/10 text-rose-600 border-rose-500/30"
                            : c.status === "PENDENTE"
                            ? "bg-amber-500/10 text-amber-600 border-amber-500/30"
                            : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
                        }`}
                      >
                        {c.status || "ATIVO"}
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
                    <TableHead>Cliente / Nome</TableHead>
                    <TableHead className="hidden sm:table-cell">CPF / CNPJ</TableHead>
                    <TableHead className="hidden md:table-cell">Contato</TableHead>
                    <TableHead className="hidden lg:table-cell">Veículos</TableHead>
                    <TableHead className="w-24 text-center">Status</TableHead>
                    <TableHead className="w-20 text-center">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customerItems.map((c) => {
                    const isPJ = c.tipopessoa === "JURIDICA";
                    const veiculos = c.veiculos ?? [];

                    return (
                      <TableRow
                        key={c.id}
                        onClick={() => handleSelectCustomer(c)}
                        className="hover:cursor-pointer transition-colors hover:bg-muted/40"
                      >
                        <TableCell className="font-mono text-muted-foreground">
                          #{c.id}
                        </TableCell>

                        <TableCell>
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted border text-muted-foreground">
                              {isPJ ? <Building2 className="size-3.5" /> : <User className="size-3.5" />}
                            </div>
                            <div className="flex flex-col min-w-0 space-y-0.5">
                              <span className="font-semibold text-foreground truncate max-w-xs sm:max-w-md">
                                {c.nomerazaosocial || "Cliente sem nome"}
                              </span>
                              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                <span className="sm:hidden font-mono">{formatarCpfCnpj(c.cpfcnpj)}</span>
                                {c.cidade ? (
                                  <span className="hidden sm:inline-block">
                                    {[c.cidade, c.estado].filter(Boolean).join("-")}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </TableCell>

                        <TableCell className="hidden sm:table-cell font-mono text-muted-foreground">
                          {formatarCpfCnpj(c.cpfcnpj)}
                        </TableCell>

                        <TableCell className="hidden md:table-cell text-muted-foreground">
                          <div className="flex flex-col text-[11px]">
                            <span>{c.telefone || "—"}</span>
                            <span className="text-muted-foreground/70 truncate max-w-[160px]">{c.email || ""}</span>
                          </div>
                        </TableCell>

                        <TableCell className="hidden lg:table-cell">
                          {veiculos.length > 0 ? (
                            <div className="flex flex-wrap items-center gap-1">
                              {veiculos.slice(0, 2).map((v) => (
                                <Badge key={v.id} variant="outline" className="text-[10px] px-1.5 py-0 font-mono">
                                  {v.placa}
                                </Badge>
                              ))}
                              {veiculos.length > 2 ? (
                                <span className="text-[10px] text-muted-foreground font-medium">
                                  +{veiculos.length - 2}
                                </span>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-muted-foreground/60">—</span>
                          )}
                        </TableCell>

                        <TableCell className="text-center">
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-1.5 py-0 ${
                              c.status === "INATIVO"
                                ? "bg-rose-500/10 text-rose-600 border-rose-500/30"
                                : c.status === "PENDENTE"
                                ? "bg-amber-500/10 text-amber-600 border-amber-500/30"
                                : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
                            }`}
                          >
                            {c.status || "ATIVO"}
                          </Badge>
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
                Exibindo <strong className="text-foreground">{customerItems.length}</strong> de{" "}
                <strong className="text-foreground">{pagination.total}</strong> clientes
              </span>
              {isLoading && <Loader2 className="size-3.5 animate-spin text-primary ml-1" />}
            </div>

            {/* Controles de Páginas */}
            <div className="flex items-center gap-1 sm:gap-2">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 hover:cursor-pointer"
                onClick={() => handleGetCustomers(1, pagination.limit, search, tipoPessoaFilter)}
                disabled={pagination.page <= 1 || isLoading}
                title="Primeira página"
              >
                <ChevronsLeft className="size-4" />
              </Button>

              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 hover:cursor-pointer"
                onClick={() => handleGetCustomers(pagination.page - 1, pagination.limit, search, tipoPessoaFilter)}
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
                onClick={() => handleGetCustomers(pagination.page + 1, pagination.limit, search, tipoPessoaFilter)}
                disabled={pagination.page >= pagination.totalPages || pagination.totalPages === 0 || isLoading}
                title="Próxima página"
              >
                <ChevronRightIcon className="size-4" />
              </Button>

              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 hover:cursor-pointer"
                onClick={() => handleGetCustomers(pagination.totalPages, pagination.limit, search, tipoPessoaFilter)}
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
                  void handleGetCustomers(1, newLimit, search, tipoPessoaFilter);
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
