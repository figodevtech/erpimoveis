/* eslint-disable @next/next/no-img-element -- imagens de produtos usam URLs dinâmicas do cadastro. */

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
  BadgeCheck,
  Barcode,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeft,
  ChevronsRight,
  Filter,
  LayoutGrid,
  List,
  Loader2,
  MapPin,
  Package,
  PackageSearch,
  Plus,
  ShieldCheck,
  ShieldX,
  Tag,
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
import { Pagination, Produto } from "../(pages)/estoque/types";
import formatarEmReal from "@/utils/formatarEmReal";
import { DialogProduto } from "../(pages)/estoque/components/dialog-produto/dialog-produto";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";

interface ProductSelectProps {
  children?: ReactNode;
  OnSelect?: (value: Produto) => void;
  setOpen?: (value: boolean) => void;
  open?: boolean;
  permitirCriacao?: boolean;
  apiEndpoint?: string;
  isProductDisabled?: (product: Produto) => boolean;
  getProductDisabledReason?: (product: Produto) => string | undefined;
}

export default function ProductSelect({
  children,
  OnSelect,
  setOpen,
  open,
  permitirCriacao = true,
  apiEndpoint = "/api/products/select",
  isProductDisabled,
  getProductDisabledReason,
}: ProductSelectProps) {
  const { data: session } = useSession();
  const canCreateProduct = permissionSetHas(
    (session?.user as any)?.permissoes,
    PERMS.ESTOQUE_CRIAR
  );

  const [isLoading, setIsLoading] = useState(false);
  const [pagination, setPagination] = useState<Pagination>({
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 0,
  });

  const [productItems, setProductItems] = useState<Produto[]>([]);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [stockFilter, setStockFilter] = useState<"TODOS" | "EM_ESTOQUE" | "SEM_ESTOQUE">("TODOS");

  const requestSequence = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const [openProduto, setOpenProduto] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<number | undefined>(undefined);

  const handleGetProducts = async (
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
      const response = await axios.get(apiEndpoint, {
        signal: controller.signal,
        params: {
          page: pageNumber || 1,
          limit: limit || pagination.limit,
          search: searchText !== undefined ? searchText : search,
          status: "TODOS",
        },
      });

      if (response.status === 200 && requestId === requestSequence.current) {
        const { data } = response;
        setProductItems(data.data || []);
        setPagination(data.pagination || { total: 0, page: 1, limit: 20, totalPages: 0 });
      }
    } catch (error) {
      if (!axios.isCancel(error) && requestId === requestSequence.current) {
        console.error("Erro ao buscar Produtos:", error);
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
      void handleGetProducts(1, pagination.limit, search);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, search]);

  useEffect(() => () => requestController.current?.abort(), []);

  const executarBusca = () => {
    const term = searchInput.trim();
    if (term === search) {
      void handleGetProducts(1, pagination.limit, term);
    } else {
      setSearch(term);
    }
  };

  const limparBusca = () => {
    setSearchInput("");
    if (search === "") {
      void handleGetProducts(1, pagination.limit, "");
    } else {
      setSearch("");
    }
  };

  const handleSelectProduct = (product: Produto) => {
    if (isProductDisabled?.(product)) return;
    if (OnSelect) OnSelect(product);
    if (setOpen) {
      setOpen(false);
      setSearchInput("");
      setSearch("");
    }
  };

  const filteredProducts = productItems.filter((p) => {
    if (stockFilter === "EM_ESTOQUE") return Number(p.estoque ?? 0) > 0;
    if (stockFilter === "SEM_ESTOQUE") return Number(p.estoque ?? 0) <= 0;
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
              {/* <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-2xs">
                <Boxes className="size-5" />
              </div> */}
              <div>
                <DialogTitle className="text-base sm:text-lg font-semibold tracking-tight">
                  Selecionar Produto
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Busque por nome, ID, referência, código de barras ou NCM.
                </DialogDescription>
              </div>
            </div>

            {permitirCriacao && canCreateProduct && (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  onClick={() => setOpenProduto(true)}
                  size="sm"
                  className="h-9 px-3 text-xs gap-1.5 hover:cursor-pointer font-medium shadow-2xs"
                >
                  <Plus className="size-4" />
                  <span>Novo Produto</span>
                </Button>

                <DialogProduto
                  isOpen={openProduto}
                  setIsOpen={(openState) => {
                    if (!openState) {
                      setSelectedProductId(undefined);
                      void handleGetProducts(1, pagination.limit, "");
                    }
                    setOpenProduto(openState);
                  }}
                  productId={selectedProductId}
                  setSelectedProductId={setSelectedProductId}
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
                placeholder="Buscar por nome, #89 (ID), /MD-8 (Etiqueta), ref, EAN..."
              />
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground px-0.5">
                <span className="font-semibold text-primary">Dicas:</span>
                <span><code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-bold text-foreground">#89</code> ID exato</span>
                <span>•</span>
                <span><code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-bold text-foreground">/MD-8</code> Busca por Etiqueta</span>
              </div>
            </div>

            {/* Controles de Visualização & Filtro de Estoque */}
            <div className="flex items-center gap-2 shrink-0">
              <Select
                value={stockFilter}
                onValueChange={(val) => setStockFilter(val as any)}
              >
                <SelectTrigger className="h-9 text-xs rounded-xl w-36 bg-card">
                  <Filter className="size-3.5 mr-1.5 text-muted-foreground" />
                  <SelectValue placeholder="Estoque" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TODOS">Todos os Itens</SelectItem>
                  <SelectItem value="EM_ESTOQUE">Em Estoque (&gt;0)</SelectItem>
                  <SelectItem value="SEM_ESTOQUE">Sem Estoque (=0)</SelectItem>
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

          {isLoading && filteredProducts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
              <Loader2 className="size-8 animate-spin text-primary" />
              <span className="text-xs font-medium">Buscando produtos no catálogo...</span>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center p-6 space-y-3 rounded-2xl border border-dashed border-border/80 bg-card">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <PackageSearch className="size-6" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-semibold">Nenhum produto encontrado</h4>
                <p className="text-xs text-muted-foreground max-w-sm">
                  {search
                    ? `Não encontramos resultados para "${search}". Tente termos mais genéricos ou verifique a ortografia.`
                    : "Nenhum produto atende aos filtros selecionados."}
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
              {filteredProducts.map((p) => {
                const estoqueQty = Number(p.estoque ?? 0);
                const semEstoque = estoqueQty <= 0;
                const precovenda = Number(p.precovenda ?? 0);
                const disabled = isProductDisabled?.(p) ?? false;
                const disabledReason = disabled ? getProductDisabledReason?.(p) : undefined;

                return (
                  <div
                    key={p.id}
                    onClick={() => handleSelectProduct(p)}
                    aria-disabled={disabled}
                    title={disabledReason}
                    className={`group relative flex flex-col justify-between rounded-2xl border p-4 bg-card transition-all ${disabled ? "cursor-not-allowed opacity-55" : "hover:shadow-md hover:cursor-pointer"} ${semEstoque
                        ? "border-rose-500/30 bg-rose-500/5 hover:border-rose-500/60"
                        : "border-border/60 hover:border-primary/50 hover:bg-accent/20"
                      }`}
                  >
                    {/* Topo do Card */}
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted border border-border/50 text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary group-hover:border-primary/20 transition-colors">
                            {p.imgUrl ? (
                              <img
                                src={p.imgUrl}
                                alt={p.titulo}
                                className="h-full w-full object-cover rounded-xl"
                              />
                            ) : (
                              <Package className="size-4" />
                            )}
                          </div>
                          <Badge
                            variant="outline"
                            className="text-[10px] font-mono px-2 py-0.5 bg-muted/50 border-border/60 text-muted-foreground"
                          >
                            ID #{p.id}
                          </Badge>
                        </div>

                        {/* Badges de Conservação */}
                        <div className="flex items-center gap-1 shrink-0">
                          {p.conservacao === "NOVO" && (
                            <Badge
                              variant="outline"
                              className="text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-500/20 gap-1 px-1.5 py-0"
                            >
                              <BadgeCheck className="size-3" /> Novo
                            </Badge>
                          )}
                          {p.conservacao === "USADO" && (
                            <Badge
                              variant="outline"
                              className="text-[10px] bg-amber-500/10 text-amber-600 border-amber-500/20 gap-1 px-1.5 py-0"
                            >
                              <ShieldX className="size-3" /> Usado
                            </Badge>
                          )}
                          {p.conservacao === "RECONDICIONADO" && (
                            <Badge
                              variant="outline"
                              className="text-[10px] bg-blue-500/10 text-blue-600 border-blue-500/20 gap-1 px-1.5 py-0"
                            >
                              <ShieldCheck className="size-3" /> Recondicionado
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* Título & Fabricante */}
                      <div>
                        <h3 className="text-xs sm:text-sm font-semibold text-foreground leading-snug line-clamp-2 group-hover:text-primary transition-colors">
                          {p.titulo || "Produto sem título"}
                        </h3>
                        {p.fabricante ? (
                          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                            Fabricante: <span className="font-medium text-foreground/80">{p.fabricante}</span>
                          </p>
                        ) : null}
                      </div>

                      {/* Metadata: Referência, Código de Barras */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground pt-1 border-t border-border/40">
                        {p.referencia ? (
                          <span className="flex items-center gap-1">
                            <Tag className="size-3 text-muted-foreground/70" />
                            <span>Ref: <strong className="font-medium text-foreground/90">{p.referencia}</strong></span>
                          </span>
                        ) : null}
                        {p.codigobarras ? (
                          <span className="flex items-center gap-1">
                            <Barcode className="size-3 text-muted-foreground/70" />
                            <span className="font-mono">{p.codigobarras}</span>
                          </span>
                        ) : null}
                      </div>

                      {/* Destaques: Localização e Etiqueta */}
                      {(p.local || p.etiqueta) ? (
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          {p.local ? (
                            <Badge
                              variant="outline"
                              className="text-[11px] bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/30 gap-1 px-2 py-0.5 font-medium"
                              title="Localização do produto no estoque"
                            >
                              <MapPin className="size-3 shrink-0 text-amber-600 dark:text-amber-400" />
                              <span>Local: <strong className="font-semibold">{p.local}</strong></span>
                            </Badge>
                          ) : null}

                          {p.etiqueta ? (
                            <Badge
                              variant="outline"
                              className="text-[11px] bg-indigo-500/10 text-indigo-800 dark:text-indigo-300 border-indigo-500/30 gap-1 px-2 py-0.5 font-mono"
                              title="Etiqueta do produto"
                            >
                              <Tag className="size-3 shrink-0 text-indigo-600 dark:text-indigo-400" />
                              <span>Etiqueta: <strong className="font-semibold">{p.etiqueta}</strong></span>
                            </Badge>
                          ) : null}
                        </div>
                      ) : null}

                      {p.descricao ? (
                        <p className="text-[11px] text-muted-foreground/80 line-clamp-2 leading-relaxed">
                          {p.descricao}
                        </p>
                      ) : null}
                      {disabledReason ? (
                        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                          {disabledReason}
                        </p>
                      ) : null}
                    </div>

                    {/* Rodapé do Card: Preço & Estoque */}
                    <div className="mt-4 pt-3 border-t border-border/50 flex items-center justify-between gap-2">
                      <Badge
                        variant="outline"
                        className={`text-[11px] font-medium px-2 py-0.5 ${semEstoque
                            ? "bg-rose-500/10 text-rose-600 border-rose-500/30 font-semibold"
                            : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
                          }`}
                      >
                        {semEstoque ? "Sem Estoque" : `Estoque: ${estoqueQty} ${p.unidade || "un"}`}
                      </Badge>

                      <div className="flex items-center gap-1.5 text-right">
                        <span className="text-sm sm:text-base font-extrabold text-foreground tracking-tight">
                          {formatarEmReal(precovenda)}
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
                    <TableHead>Produto</TableHead>
                    <TableHead className="hidden md:table-cell">Código / Ref</TableHead>
                    <TableHead className="hidden sm:table-cell">Fabricante</TableHead>
                    <TableHead className="w-28 text-center">Estoque</TableHead>
                    <TableHead className="w-32 text-right">Preço</TableHead>
                    <TableHead className="w-20 text-center">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProducts.map((p) => {
                    const estoqueQty = Number(p.estoque ?? 0);
                    const semEstoque = estoqueQty <= 0;
                    const precovenda = Number(p.precovenda ?? 0);
                    const disabled = isProductDisabled?.(p) ?? false;
                    const disabledReason = disabled ? getProductDisabledReason?.(p) : undefined;

                    return (
                      <TableRow
                        key={p.id}
                        onClick={() => handleSelectProduct(p)}
                        aria-disabled={disabled}
                        title={disabledReason}
                        className={`${disabled ? "cursor-not-allowed opacity-55" : "hover:cursor-pointer"} ${semEstoque ? "bg-rose-500/5 hover:bg-rose-500/10" : ""
                          }`}
                      >
                        <TableCell className="font-mono text-muted-foreground">
                          #{p.id}
                        </TableCell>

                        <TableCell>
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted border text-muted-foreground">
                              <Package className="size-3.5" />
                            </div>
                            <div className="flex flex-col min-w-0 space-y-0.5">
                              <span className="font-semibold text-foreground truncate max-w-xs sm:max-w-md">
                                {p.titulo || "Produto sem título"}
                              </span>
                              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                {p.fabricante ? (
                                  <span className="sm:hidden">{p.fabricante}</span>
                                ) : null}
                                {p.conservacao ? (
                                  <span className="text-[10px] uppercase font-bold text-muted-foreground/70">
                                    • {p.conservacao}
                                  </span>
                                ) : null}
                                {p.local ? (
                                  <span className="flex items-center gap-0.5 text-amber-700 dark:text-amber-400 font-medium bg-amber-500/10 px-1.5 py-0 rounded border border-amber-500/20">
                                    <MapPin className="size-3 text-amber-600 shrink-0" />
                                    {p.local}
                                  </span>
                                ) : null}
                                {p.etiqueta ? (
                                  <span className="flex items-center gap-0.5 text-indigo-700 dark:text-indigo-400 font-mono font-medium bg-indigo-500/10 px-1.5 py-0 rounded border border-indigo-500/20">
                                    <Tag className="size-3 text-indigo-600 shrink-0" />
                                    {p.etiqueta}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </TableCell>

                        <TableCell className="hidden md:table-cell font-mono text-[11px] text-muted-foreground">
                          {p.referencia || p.codigobarras || "—"}
                        </TableCell>

                        <TableCell className="hidden sm:table-cell text-muted-foreground">
                          {p.fabricante || "—"}
                        </TableCell>

                        <TableCell className="text-center">
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-1.5 py-0 ${semEstoque
                                ? "bg-rose-500/10 text-rose-600 border-rose-500/30"
                                : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
                              }`}
                          >
                            {estoqueQty} {p.unidade || "un"}
                          </Badge>
                        </TableCell>

                        <TableCell className="text-right font-extrabold text-foreground">
                          {formatarEmReal(precovenda)}
                        </TableCell>

                        <TableCell className="text-center">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs text-primary hover:bg-primary/10 hover:cursor-pointer"
                            disabled={disabled}
                          >
                            {disabled ? "Indisponível" : "Selecionar"}
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
                Exibindo <strong className="text-foreground">{filteredProducts.length}</strong> de{" "}
                <strong className="text-foreground">{pagination.total}</strong> produtos
              </span>
              {isLoading && <Loader2 className="size-3.5 animate-spin text-primary ml-1" />}
            </div>

            {/* Controles de Páginas */}
            <div className="flex items-center gap-1 sm:gap-2">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 hover:cursor-pointer"
                onClick={() => handleGetProducts(1, pagination.limit, search)}
                disabled={pagination.page <= 1 || isLoading}
                title="Primeira página"
              >
                <ChevronsLeft className="size-4" />
              </Button>

              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 hover:cursor-pointer"
                onClick={() => handleGetProducts(pagination.page - 1, pagination.limit, search)}
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
                onClick={() => handleGetProducts(pagination.page + 1, pagination.limit, search)}
                disabled={pagination.page >= pagination.totalPages || pagination.totalPages === 0 || isLoading}
                title="Próxima página"
              >
                <ChevronRightIcon className="size-4" />
              </Button>

              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 hover:cursor-pointer"
                onClick={() => handleGetProducts(pagination.totalPages, pagination.limit, search)}
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
                  void handleGetProducts(1, newLimit, search);
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
