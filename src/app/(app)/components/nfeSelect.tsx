"use client";

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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SelectSearchInput } from "./select-search-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/lib/toast";
import formatarEmReal from "@/utils/formatarEmReal";
import axios, { isAxiosError } from "axios";
import {
  ArrowRight,
  Calendar,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeft,
  ChevronsRight,
  Clock,
  FileCheck,
  FileText,
  Key,
  LayoutGrid,
  List,
  Loader2,
  PackageSearch,
  Receipt,
  User,
} from "lucide-react";
import { ReactNode, useEffect, useRef, useState } from "react";
import type { NF } from "../(pages)/estoque/components/dialog-entrada/types";

interface NfeItem {
  id: number;
  modelo: string;
  numero: number;
  serie: number;
  chave_acesso: string;
  dataemissao: string;
  total_nfe: number;
  xmlStatus: string;
  xmlStatusLabel: string;
  destinatarioOuEmitente?: {
    nomerazaosocial?: string | null;
    cpfcnpj?: string | null;
  } | null;
}

interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  pageCount?: number;
}

interface NfeSelectProps {
  children?: ReactNode;
  OnSelect?: (value: NF) => void;
  setOpen?: (value: boolean) => void;
  open?: boolean;
}

const initialPagination: Pagination = {
  total: 0,
  page: 1,
  limit: 20,
  totalPages: 0,
  pageCount: 0,
};

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

export default function NfeSelect({ children, OnSelect, setOpen, open }: NfeSelectProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pagination, setPagination] = useState<Pagination>(initialPagination);
  const [nfeItems, setNfeItems] = useState<NfeItem[]>([]);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");

  const requestSequence = useRef(0);
  const requestController = useRef<AbortController | null>(null);

  const handleGetNfes = async (
    pageNumber = 1,
    limit = pagination.limit,
    searchText = search,
  ) => {
    const requestId = ++requestSequence.current;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setIsLoading(true);

    try {
      const response = await axios.get("/api/fiscal/notas-recebidas", {
        signal: controller.signal,
        params: {
          page: pageNumber,
          limit,
          search: searchText || undefined,
        },
      });

      if (requestId === requestSequence.current) {
        const items = response.data.data ?? [];
        setNfeItems(items);
        setPagination({
          ...(response.data.pagination ?? initialPagination),
          pageCount: items.length,
        });
      }
    } catch (error) {
      if (!axios.isCancel(error) && requestId === requestSequence.current) {
        toast.error("Erro ao buscar notas fiscais", {
          description: isAxiosError(error)
            ? error.response?.data?.detail ?? error.response?.data?.error ?? error.message
            : "Não foi possível listar as notas fiscais de terceiros.",
        });
      }
    } finally {
      if (requestId === requestSequence.current) {
        setIsLoading(false);
      }
    }
  };

  const handleSelect = async (nota: NfeItem) => {
    if (nota.xmlStatus !== "XML_COMPLETO") return;

    setSelectedId(nota.id);
    try {
      const xmlResponse = await axios.get(`/api/fiscal/notas-recebidas/${nota.id}/xml`, {
        responseType: "blob",
      });
      const formData = new FormData();
      formData.append(
        "file",
        new File([xmlResponse.data], `nfe-${nota.chave_acesso || nota.id}.xml`, {
          type: "application/xml",
        }),
      );

      const parsedResponse = await axios.post("/api/entradas/nf", formData);
      OnSelect?.({
        ...parsedResponse.data.parsed,
        documentoFiscalRecebidoId: nota.id,
      });
      setOpen?.(false);
      setSearchInput("");
      setSearch("");
    } catch (error) {
      toast.error("Erro ao selecionar nota fiscal", {
        description: isAxiosError(error)
          ? error.response?.data?.detail ?? error.response?.data?.error ?? error.message
          : "Não foi possível carregar os dados da nota fiscal.",
      });
    } finally {
      setSelectedId(null);
    }
  };

  useEffect(() => {
    requestSequence.current += 1;
    requestController.current?.abort();
    const timeout = window.setTimeout(() => setSearch(searchInput.trim()), 400);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    if (open) {
      void handleGetNfes(1, pagination.limit, search);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, search]);

  useEffect(() => () => requestController.current?.abort(), []);

  const executarBusca = () => {
    const term = searchInput.trim();
    if (term === search) {
      void handleGetNfes(1, pagination.limit, term);
    } else {
      setSearch(term);
    }
  };

  const limparBusca = () => {
    setSearchInput("");
    if (search === "") {
      void handleGetNfes(1, pagination.limit, "");
    } else {
      setSearch("");
    }
  };

  const getXmlStatusBadge = (status: string, label: string) => {
    switch (status) {
      case "XML_COMPLETO":
        return (
          <Badge
            variant="outline"
            className="text-[10px] font-semibold px-2 py-0.5 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 gap-1"
          >
            <FileCheck className="size-3 shrink-0" />
            <span>{label || "XML completo"}</span>
          </Badge>
        );
      case "AGUARDANDO_XML":
        return (
          <Badge
            variant="outline"
            className="text-[10px] font-semibold px-2 py-0.5 bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30 gap-1"
          >
            <Clock className="size-3 shrink-0" />
            <span>{label || "Aguardando XML"}</span>
          </Badge>
        );
      case "NAO_AUTORIZADO":
        return (
          <Badge
            variant="outline"
            className="text-[10px] font-semibold px-2 py-0.5 bg-rose-500/10 text-rose-600 border-rose-500/30"
          >
            {label || "Não autorizado"}
          </Badge>
        );
      default:
        return (
          <Badge
            variant="outline"
            className="text-[10px] font-semibold px-2 py-0.5 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/30"
          >
            {label || "Aguardando manifestação"}
          </Badge>
        );
    }
  };

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        setOpen?.(nextOpen);
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
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-2xs">
              <Receipt className="size-5" />
            </div>
            <div>
              <DialogTitle className="text-base sm:text-lg font-semibold tracking-tight">
                Selecionar Nota Fiscal (Terceiros)
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Selecione uma NF-e recebida com XML completo para importação fiscal de entrada.
              </DialogDescription>
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
                placeholder="Buscar por número da nota, chave de acesso ou emitente..."
              />
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground px-0.5">
                <span className="font-semibold text-primary">Dicas:</span>
                <span><code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-bold text-foreground">#1234</code> Número</span>
                <span>•</span>
                <span><code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-bold text-foreground">44 dígitos</code> Chave NFe</span>
              </div>
            </div>

            {/* Controles de Visualização */}
            <div className="flex items-center gap-2 shrink-0">
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
          {isLoading && nfeItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
              <Loader2 className="size-8 animate-spin text-primary" />
              <span className="text-xs font-medium">Buscando notas fiscais...</span>
            </div>
          ) : nfeItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center p-6 space-y-3 rounded-2xl border border-dashed border-border/80 bg-card">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <PackageSearch className="size-6" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-semibold">Nenhuma nota fiscal encontrada</h4>
                <p className="text-xs text-muted-foreground max-w-sm">
                  {search
                    ? `Não encontramos resultados para "${search}". Tente buscar por emitente, CNPJ ou número da nota.`
                    : "Nenhuma nota fiscal recebida cadastrada."}
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
              {nfeItems.map((nota) => {
                const isSelectable = nota.xmlStatus === "XML_COMPLETO";
                const isDownloading = selectedId === nota.id;

                return (
                  <div
                    key={nota.id}
                    onClick={() => isSelectable && void handleSelect(nota)}
                    className={`group relative flex flex-col justify-between rounded-2xl border border-border/60 p-4 bg-card transition-all ${
                      isSelectable
                        ? "hover:shadow-md hover:border-primary/50 hover:bg-accent/20 hover:cursor-pointer"
                        : "opacity-60 cursor-not-allowed bg-muted/20"
                    }`}
                  >
                    {/* Topo do Card */}
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 border border-primary/20 text-primary">
                            <FileText className="size-4" />
                          </div>
                          <Badge
                            variant="outline"
                            className="text-[10px] font-mono px-2 py-0.5 bg-muted/50 border-border/60 text-muted-foreground"
                          >
                            {nota.modelo} Nº {nota.numero}
                          </Badge>
                        </div>

                        {getXmlStatusBadge(nota.xmlStatus, nota.xmlStatusLabel)}
                      </div>

                      {/* Emitente & CNPJ */}
                      <div>
                        <h3 className="text-xs sm:text-sm font-semibold text-foreground leading-snug line-clamp-2 group-hover:text-primary transition-colors">
                          {nota.destinatarioOuEmitente?.nomerazaosocial || "Emitente não identificado"}
                        </h3>
                        <p className="text-[11px] font-mono text-muted-foreground mt-0.5 flex items-center gap-1">
                          <User className="size-3 text-muted-foreground/70" />
                          <span>{formatarCpfCnpj(nota.destinatarioOuEmitente?.cpfcnpj)}</span>
                        </p>
                      </div>

                      {/* Emissão & Valor */}
                      <div className="space-y-1.5 pt-2 border-t border-border/40 text-[11px] text-muted-foreground">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <Calendar className="size-3 text-muted-foreground/70" />
                            <span>
                              {nota.dataemissao
                                ? new Date(nota.dataemissao).toLocaleDateString("pt-BR")
                                : "—"}
                            </span>
                          </div>
                          <span className="text-xs font-semibold text-foreground font-mono">
                            {formatarEmReal(nota.total_nfe || 0)}
                          </span>
                        </div>

                        {nota.chave_acesso ? (
                          <div className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground/80 truncate pt-0.5">
                            <Key className="size-3 shrink-0" />
                            <span className="truncate">{nota.chave_acesso}</span>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    {/* Rodapé do Card */}
                    <div className="mt-4 pt-3 border-t border-border/50 flex items-center justify-between gap-2">
                      <span className="text-[10px] text-muted-foreground">Série {nota.serie || "1"}</span>

                      {isDownloading ? (
                        <div className="flex items-center gap-1.5 text-xs text-primary font-medium">
                          <Loader2 className="size-3.5 animate-spin" />
                          <span>Carregando XML...</span>
                        </div>
                      ) : isSelectable ? (
                        <div className="flex items-center gap-1 text-xs font-semibold text-primary">
                          <span>Importar</span>
                          <ArrowRight className="size-4 group-hover:translate-x-0.5 transition-transform" />
                        </div>
                      ) : (
                        <span className="text-[10px] text-muted-foreground italic">Requer XML completo</span>
                      )}
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
                    <TableHead className="w-28">Nota / Modelo</TableHead>
                    <TableHead>Emitente / CNPJ</TableHead>
                    <TableHead className="hidden sm:table-cell">Emissão</TableHead>
                    <TableHead className="w-36">Status XML</TableHead>
                    <TableHead className="text-right">Valor Total</TableHead>
                    <TableHead className="w-24 text-center">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {nfeItems.map((nota) => {
                    const isSelectable = nota.xmlStatus === "XML_COMPLETO";
                    const isDownloading = selectedId === nota.id;

                    return (
                      <TableRow
                        key={nota.id}
                        onClick={() => isSelectable && void handleSelect(nota)}
                        className={`transition-colors ${
                          isSelectable
                            ? "hover:cursor-pointer hover:bg-muted/40"
                            : "opacity-60 cursor-not-allowed bg-muted/20"
                        }`}
                      >
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-semibold font-mono text-foreground">
                              {nota.modelo} {nota.numero}
                            </span>
                            <span className="text-[10px] text-muted-foreground">Série {nota.serie || "1"}</span>
                          </div>
                        </TableCell>

                        <TableCell>
                          <div className="flex flex-col min-w-0 space-y-0.5">
                            <span className="font-semibold text-foreground truncate max-w-xs sm:max-w-md">
                              {nota.destinatarioOuEmitente?.nomerazaosocial || "Emitente não identificado"}
                            </span>
                            <span className="font-mono text-[10px] text-muted-foreground">
                              {formatarCpfCnpj(nota.destinatarioOuEmitente?.cpfcnpj)}
                            </span>
                          </div>
                        </TableCell>

                        <TableCell className="hidden sm:table-cell text-muted-foreground">
                          {nota.dataemissao ? new Date(nota.dataemissao).toLocaleDateString("pt-BR") : "—"}
                        </TableCell>

                        <TableCell>
                          {getXmlStatusBadge(nota.xmlStatus, nota.xmlStatusLabel)}
                        </TableCell>

                        <TableCell className="text-right font-mono font-semibold text-foreground">
                          {formatarEmReal(nota.total_nfe || 0)}
                        </TableCell>

                        <TableCell className="text-center">
                          {isDownloading ? (
                            <Loader2 className="size-4 animate-spin text-primary mx-auto" />
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              variant={isSelectable ? "ghost" : "outline"}
                              disabled={!isSelectable}
                              className="h-7 px-2 text-xs text-primary hover:bg-primary/10 hover:cursor-pointer"
                            >
                              {isSelectable ? "Importar" : "Indisponível"}
                            </Button>
                          )}
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
                Exibindo <strong className="text-foreground">{nfeItems.length}</strong> de{" "}
                <strong className="text-foreground">{pagination.total}</strong> notas fiscais
              </span>
              {isLoading && <Loader2 className="size-3.5 animate-spin text-primary ml-1" />}
            </div>

            {/* Controles de Páginas */}
            <div className="flex items-center gap-1 sm:gap-2">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 hover:cursor-pointer"
                onClick={() => void handleGetNfes(1, pagination.limit, search)}
                disabled={pagination.page <= 1 || isLoading}
                title="Primeira página"
              >
                <ChevronsLeft className="size-4" />
              </Button>

              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 hover:cursor-pointer"
                onClick={() => void handleGetNfes(pagination.page - 1, pagination.limit, search)}
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
                onClick={() => void handleGetNfes(pagination.page + 1, pagination.limit, search)}
                disabled={pagination.page >= pagination.totalPages || pagination.totalPages === 0 || isLoading}
                title="Próxima página"
              >
                <ChevronRightIcon className="size-4" />
              </Button>

              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 hover:cursor-pointer"
                onClick={() => void handleGetNfes(pagination.totalPages, pagination.limit, search)}
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
                  void handleGetNfes(1, newLimit, search);
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
