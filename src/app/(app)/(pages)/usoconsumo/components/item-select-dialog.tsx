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
import axios from "axios";
import { ReactNode, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";

import {
  ArrowRight,
  Barcode,
  Boxes,
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
import { SelectSearchInput } from "@/app/(app)/components/select-search-input";
import formatarEmReal from "@/utils/formatarEmReal";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import { ESCOPOS_USOCONSUMO, rotuloDeEscopo, type UsoConsumoEscopo } from "@/lib/usoconsumo/escopo";
import type { UsoConsumoGrupo } from "@/types/usoconsumo";
import { ItemDialog } from "./item-dialog";

export type UsoConsumoItemOption = {
  id: number;
  /** De qual dos dois estoques simples o item veio. */
  escopo?: UsoConsumoEscopo;
  titulo: string;
  descricao?: string | null;
  referencia?: string | null;
  fabricante?: string | null;
  codigobarras?: string | null;
  unidade?: string;
  estoque?: number;
  precocompra?: number;
  ultimovalordecompra?: number | null;
  local?: string | null;
  etiqueta?: string | null;
  img_url?: string | null;
  /**
   * Bloco fiscal do cadastro. Opcional porque nem todo consumidor do dialog
   * precisa dele; a NF-e avulsa usa para montar o item da nota sem redigitação.
   * Note que `cfop_entrada` não vem: é CFOP de entrada e não serve para saída.
   */
  ncm?: string | null;
  cest?: string | null;
  origem_mercadoria?: string | null;
  csosn?: string | null;
  cst?: string | null;
  aliquotaicms?: number | null;
  cst_pis?: string | null;
  aliquota_pis?: number | null;
  modo_pis?: string | null;
  aliquota_por_unidade_pis?: number | null;
  cst_cofins?: string | null;
  aliquota_cofins?: number | null;
  modo_cofins?: string | null;
  aliquota_por_unidade_cofins?: number | null;
  cst_ibscbs?: string | null;
  cclass_trib?: string | null;
  aliquota_ibs_uf?: number | null;
  aliquota_ibs_municipio?: number | null;
  aliquota_cbs?: number | null;
};

type ItemPagination = { total: number; page: number; limit: number; totalPages: number };

type Props = {
  open: boolean;
  setOpen: (open: boolean) => void;
  onSelect: (item: UsoConsumoItemOption) => void;
  children: ReactNode;
  /** Estoque em que a busca comeca. */
  escopo?: UsoConsumoEscopo;
  /**
   * Mostra o filtro para alternar de estoque sem fechar o dialog. A NF-e avulsa
   * liga isso: la o operador escolhe item de qualquer um dos dois, e um filtro
   * so evita duplicar o botao na barra de acoes.
   */
  permitirTrocaDeEscopo?: boolean;
};

export function ItemSelectDialog({
  open,
  setOpen,
  onSelect,
  children,
  escopo = "USOCONSUMO",
  permitirTrocaDeEscopo = false,
}: Props) {
  const { data: session } = useSession();
  const canCreateItem = permissionSetHas(
    (session?.user as any)?.permissoes,
    PERMS.USOCONSUMO_CRIAR,
  );

  const [escopoAtivo, setEscopoAtivo] = useState<UsoConsumoEscopo>(escopo);
  const [isLoading, setIsLoading] = useState(false);
  const [pagination, setPagination] = useState<ItemPagination>({
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 0,
  });

  const [items, setItems] = useState<UsoConsumoItemOption[]>([]);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [stockFilter, setStockFilter] = useState<"TODOS" | "EM_ESTOQUE" | "SEM_ESTOQUE">("TODOS");

  const [groups, setGroups] = useState<UsoConsumoGrupo[]>([]);
  const [openItemDialog, setOpenItemDialog] = useState(false);

  const requestSequence = useRef(0);
  const requestController = useRef<AbortController | null>(null);

  const handleGetItems = async (
    pageNumber?: number,
    limit?: number,
    searchText?: string,
    escopoBusca?: UsoConsumoEscopo,
  ) => {
    const requestId = ++requestSequence.current;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setIsLoading(true);

    try {
      const response = await axios.get("/api/usoconsumo/itens/select", {
        signal: controller.signal,
        params: {
          page: pageNumber || 1,
          limit: limit || pagination.limit,
          search: searchText !== undefined ? searchText : search,
          escopo: escopoBusca ?? escopoAtivo,
        },
      });

      if (response.status === 200 && requestId === requestSequence.current) {
        const { data } = response;
        setItems(data.data || []);
        setPagination(data.pagination || { total: 0, page: 1, limit: 20, totalPages: 0 });
      }
    } catch (error) {
      if (!axios.isCancel(error) && requestId === requestSequence.current) {
        console.error("Erro ao buscar itens:", error);
      }
    } finally {
      if (requestId === requestSequence.current) {
        setIsLoading(false);
      }
    }
  };

  const loadGroups = async () => {
    try {
      const { data } = await axios.get("/api/usoconsumo/grupos");
      setGroups(data.data ?? []);
    } catch (error) {
      console.error("Erro ao buscar grupos:", error);
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
      void handleGetItems(1, pagination.limit, search, escopoAtivo);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, search, escopoAtivo]);

  useEffect(() => {
    if (open && canCreateItem) void loadGroups();
  }, [open, canCreateItem]);

  useEffect(() => () => requestController.current?.abort(), []);

  const executarBusca = () => {
    const term = searchInput.trim();
    if (term === search) {
      void handleGetItems(1, pagination.limit, term, escopoAtivo);
    } else {
      setSearch(term);
    }
  };

  const limparBusca = () => {
    setSearchInput("");
    if (search === "") {
      void handleGetItems(1, pagination.limit, "", escopoAtivo);
    } else {
      setSearch("");
    }
  };

  const handleSelectItem = (item: UsoConsumoItemOption) => {
    onSelect(item);
    setOpen(false);
    setSearchInput("");
    setSearch("");
  };

  const filteredItems = items.filter((item) => {
    if (stockFilter === "EM_ESTOQUE") return Number(item.estoque ?? 0) > 0;
    if (stockFilter === "SEM_ESTOQUE") return Number(item.estoque ?? 0) <= 0;
    return true;
  });

  const rotulo = rotuloDeEscopo(escopoAtivo);

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          setSearchInput("");
          setSearch("");
          setEscopoAtivo(escopo);
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
                <Boxes className="size-5" />
              </div>
              <div>
                <DialogTitle className="text-base sm:text-lg font-semibold tracking-tight">
                  Selecionar {rotulo.item}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Busque por título, referência, fabricante, código de barras ou etiqueta.
                </DialogDescription>
              </div>
            </div>

            {canCreateItem && (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  onClick={() => setOpenItemDialog(true)}
                  size="sm"
                  className="h-9 px-3 text-xs gap-1.5 hover:cursor-pointer font-medium shadow-2xs"
                >
                  <Plus className="size-4" />
                  <span>Novo Item</span>
                </Button>

                <ItemDialog
                  open={openItemDialog}
                  item={null}
                  grupos={groups}
                  escopo={escopoAtivo}
                  onOpenChange={setOpenItemDialog}
                  onSaved={async () => {
                    await handleGetItems(1, pagination.limit, search, escopoAtivo);
                  }}
                  onGroupsChanged={loadGroups}
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
                placeholder="Buscar por título, referência, fabricante, EAN ou etiqueta..."
              />
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground px-0.5">
                <span className="font-semibold text-primary">Dicas:</span>
                <span><code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-bold text-foreground">#12</code> ID exato</span>
                <span>•</span>
                <span><code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-bold text-foreground">USC-000123</code> Busca por Etiqueta</span>
              </div>
            </div>

            {/* Controles de Visualização & Filtros */}
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {permitirTrocaDeEscopo && (
                <Select
                  value={escopoAtivo}
                  onValueChange={(val) => setEscopoAtivo(val as UsoConsumoEscopo)}
                >
                  <SelectTrigger className="h-9 text-xs rounded-xl w-40 bg-card">
                    <Filter className="size-3.5 mr-1.5 text-muted-foreground" />
                    <SelectValue placeholder="Estoque" />
                  </SelectTrigger>
                  <SelectContent>
                    {ESCOPOS_USOCONSUMO.map((opcao) => (
                      <SelectItem key={opcao} value={opcao}>
                        {rotuloDeEscopo(opcao).nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              <Select
                value={stockFilter}
                onValueChange={(val) => setStockFilter(val as any)}
              >
                <SelectTrigger className="h-9 text-xs rounded-xl w-36 bg-card">
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
          {isLoading && filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
              <Loader2 className="size-8 animate-spin text-primary" />
              <span className="text-xs font-medium">Buscando itens no estoque...</span>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center p-6 space-y-3 rounded-2xl border border-dashed border-border/80 bg-card">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <PackageSearch className="size-6" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-semibold">Nenhum item encontrado</h4>
                <p className="text-xs text-muted-foreground max-w-sm">
                  {search
                    ? `Não encontramos resultados para "${search}". Tente termos mais genéricos ou verifique a ortografia.`
                    : "Nenhum item atende aos filtros selecionados."}
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
              {filteredItems.map((item) => {
                const estoqueQty = Number(item.estoque ?? 0);
                const semEstoque = estoqueQty <= 0;
                const valor = Number(item.ultimovalordecompra ?? item.precocompra ?? 0);

                return (
                  <div
                    key={item.id}
                    onClick={() => handleSelectItem(item)}
                    className={`group relative flex flex-col justify-between rounded-2xl border p-4 bg-card transition-all hover:shadow-md hover:cursor-pointer ${semEstoque
                        ? "border-rose-500/30 bg-rose-500/5 hover:border-rose-500/60"
                        : "border-border/60 hover:border-primary/50 hover:bg-accent/20"
                      }`}
                  >
                    {/* Topo do Card */}
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted border border-border/50 text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary group-hover:border-primary/20 transition-colors">
                            {item.img_url ? (
                              <img
                                src={item.img_url}
                                alt={item.titulo}
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
                            ID #{item.id}
                          </Badge>
                        </div>

                        {item.ncm ? (
                          <Badge
                            variant="outline"
                            className="text-[10px] font-mono px-2 py-0.5 bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/20"
                          >
                            NCM {item.ncm}
                          </Badge>
                        ) : null}
                      </div>

                      {/* Título & Fabricante */}
                      <div>
                        <h3 className="text-xs sm:text-sm font-semibold text-foreground leading-snug line-clamp-2 group-hover:text-primary transition-colors">
                          {item.titulo || "Item sem título"}
                        </h3>
                        {item.fabricante ? (
                          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                            Fabricante: <span className="font-medium text-foreground/80">{item.fabricante}</span>
                          </p>
                        ) : null}
                      </div>

                      {/* Metadata: Referência, Código de Barras */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground pt-1 border-t border-border/40">
                        {item.referencia ? (
                          <span className="flex items-center gap-1">
                            <Tag className="size-3 text-muted-foreground/70" />
                            <span>Ref: <strong className="font-medium text-foreground/90">{item.referencia}</strong></span>
                          </span>
                        ) : null}
                        {item.codigobarras ? (
                          <span className="flex items-center gap-1">
                            <Barcode className="size-3 text-muted-foreground/70" />
                            <span className="font-mono">{item.codigobarras}</span>
                          </span>
                        ) : null}
                      </div>

                      {/* Destaques: Localização e Etiqueta */}
                      {(item.local || item.etiqueta) ? (
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          {item.local ? (
                            <Badge
                              variant="outline"
                              className="text-[11px] bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/30 gap-1 px-2 py-0.5 font-medium"
                              title="Localização do item no estoque"
                            >
                              <MapPin className="size-3 shrink-0 text-amber-600 dark:text-amber-400" />
                              <span>Local: <strong className="font-semibold">{item.local}</strong></span>
                            </Badge>
                          ) : null}

                          {item.etiqueta ? (
                            <Badge
                              variant="outline"
                              className="text-[11px] bg-indigo-500/10 text-indigo-800 dark:text-indigo-300 border-indigo-500/30 gap-1 px-2 py-0.5 font-mono"
                              title="Etiqueta do item"
                            >
                              <Tag className="size-3 shrink-0 text-indigo-600 dark:text-indigo-400" />
                              <span>Etiqueta: <strong className="font-semibold">{item.etiqueta}</strong></span>
                            </Badge>
                          ) : null}
                        </div>
                      ) : null}

                      {item.descricao ? (
                        <p className="text-[11px] text-muted-foreground/80 line-clamp-2 leading-relaxed">
                          {item.descricao}
                        </p>
                      ) : null}
                    </div>

                    {/* Rodapé do Card: Valor & Estoque */}
                    <div className="mt-4 pt-3 border-t border-border/50 flex items-center justify-between gap-2">
                      <Badge
                        variant="outline"
                        className={`text-[11px] font-medium px-2 py-0.5 ${semEstoque
                            ? "bg-rose-500/10 text-rose-600 border-rose-500/30 font-semibold"
                            : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
                          }`}
                      >
                        {semEstoque ? "Sem Estoque" : `Estoque: ${estoqueQty} ${item.unidade || "un"}`}
                      </Badge>

                      <div className="flex items-center gap-1.5 text-right">
                        <span className="text-sm sm:text-base font-extrabold text-foreground tracking-tight">
                          {formatarEmReal(valor)}
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
                    <TableHead>Item</TableHead>
                    <TableHead className="hidden md:table-cell">Código / Ref</TableHead>
                    <TableHead className="hidden sm:table-cell">Fabricante</TableHead>
                    <TableHead className="w-28 text-center">Estoque</TableHead>
                    <TableHead className="w-32 text-right">Valor</TableHead>
                    <TableHead className="w-20 text-center">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.map((item) => {
                    const estoqueQty = Number(item.estoque ?? 0);
                    const semEstoque = estoqueQty <= 0;
                    const valor = Number(item.ultimovalordecompra ?? item.precocompra ?? 0);

                    return (
                      <TableRow
                        key={item.id}
                        onClick={() => handleSelectItem(item)}
                        className={`hover:cursor-pointer ${semEstoque ? "bg-rose-500/5 hover:bg-rose-500/10" : ""
                          }`}
                      >
                        <TableCell className="font-mono text-muted-foreground">
                          #{item.id}
                        </TableCell>

                        <TableCell>
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted border text-muted-foreground">
                              <Package className="size-3.5" />
                            </div>
                            <div className="flex flex-col min-w-0 space-y-0.5">
                              <span className="font-semibold text-foreground truncate max-w-xs sm:max-w-md">
                                {item.titulo || "Item sem título"}
                              </span>
                              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                {item.fabricante ? (
                                  <span className="sm:hidden">{item.fabricante}</span>
                                ) : null}
                                {item.ncm ? (
                                  <span className="font-mono text-[10px] text-muted-foreground/80">
                                    NCM {item.ncm}
                                  </span>
                                ) : null}
                                {item.local ? (
                                  <span className="flex items-center gap-0.5 text-amber-700 dark:text-amber-400 font-medium bg-amber-500/10 px-1.5 py-0 rounded border border-amber-500/20">
                                    <MapPin className="size-3 text-amber-600 shrink-0" />
                                    {item.local}
                                  </span>
                                ) : null}
                                {item.etiqueta ? (
                                  <span className="flex items-center gap-0.5 text-indigo-700 dark:text-indigo-400 font-mono font-medium bg-indigo-500/10 px-1.5 py-0 rounded border border-indigo-500/20">
                                    <Tag className="size-3 text-indigo-600 shrink-0" />
                                    {item.etiqueta}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </TableCell>

                        <TableCell className="hidden md:table-cell font-mono text-[11px] text-muted-foreground">
                          {item.referencia || item.codigobarras || "—"}
                        </TableCell>

                        <TableCell className="hidden sm:table-cell text-muted-foreground">
                          {item.fabricante || "—"}
                        </TableCell>

                        <TableCell className="text-center">
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-1.5 py-0 ${semEstoque
                                ? "bg-rose-500/10 text-rose-600 border-rose-500/30"
                                : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
                              }`}
                          >
                            {estoqueQty} {item.unidade || "un"}
                          </Badge>
                        </TableCell>

                        <TableCell className="text-right font-extrabold text-foreground">
                          {formatarEmReal(valor)}
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
                Exibindo <strong className="text-foreground">{filteredItems.length}</strong> de{" "}
                <strong className="text-foreground">{pagination.total}</strong> itens
              </span>
              {isLoading && <Loader2 className="size-3.5 animate-spin text-primary ml-1" />}
            </div>

            {/* Controles de Páginas */}
            <div className="flex items-center gap-1 sm:gap-2">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 hover:cursor-pointer"
                onClick={() => handleGetItems(1, pagination.limit, search, escopoAtivo)}
                disabled={pagination.page <= 1 || isLoading}
                title="Primeira página"
              >
                <ChevronsLeft className="size-4" />
              </Button>

              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 hover:cursor-pointer"
                onClick={() => handleGetItems(pagination.page - 1, pagination.limit, search, escopoAtivo)}
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
                onClick={() => handleGetItems(pagination.page + 1, pagination.limit, search, escopoAtivo)}
                disabled={pagination.page >= pagination.totalPages || pagination.totalPages === 0 || isLoading}
                title="Próxima página"
              >
                <ChevronRightIcon className="size-4" />
              </Button>

              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 hover:cursor-pointer"
                onClick={() => handleGetItems(pagination.totalPages, pagination.limit, search, escopoAtivo)}
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
                  void handleGetItems(1, newLimit, search, escopoAtivo);
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
