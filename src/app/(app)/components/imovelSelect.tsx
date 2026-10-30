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
import {
  ArrowRight,
  Bath,
  Bed,
  Building2,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeft,
  ChevronsRight,
  Filter,
  Globe,
  Home,
  LayoutGrid,
  List,
  Loader2,
  MapPin,
  Maximize2,
  PackageSearch,
  Plus,
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
import EntityDialog from "@/components/imobiliario/entity-dialog";
import { StatusBadge, useModulePermission } from "@/components/imobiliario/shared";
import { money, titleCase } from "@/components/imobiliario/model";

export interface ImovelItem {
  id: number;
  titulo: string;
  codigo?: string | null;
  slug?: string | null;
  tipo?: string | null;
  modalidades?: string[];
  capacidade?: number | null;
  quartos?: number | null;
  banheiros?: number | null;
  vagas?: number | null;
  area?: number | null;
  diaria?: number | null;
  valor_locacao?: number | null;
  valor_venda?: number | null;
  taxa_limpeza?: number | null;
  caucao?: number | null;
  situacao_operacional?: string | null;
  situacao_comercial?: string | null;
  ativo?: boolean | null;
  publicado?: boolean | null;
  foto_capa?: string | null;
  endereco?: {
    logradouro?: string;
    numero?: string;
    complemento?: string;
    bairro?: string;
    cidade?: string;
    estado?: string;
    cep?: string;
  };
  endereco_publico?: {
    bairro?: string;
    cidade?: string;
    estado?: string;
  };
  proprietario?: {
    id: number;
    nomerazaosocial: string;
  };
  [key: string]: any;
}

export interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ImovelSelectProps {
  children?: ReactNode;
  OnSelect?: (value: ImovelItem) => void;
  setOpen?: (value: boolean) => void;
  open?: boolean;
  modalidadePadrao?: "TODAS" | "TEMPORADA" | "LOCACAO" | "VENDA";
}

export default function ImovelSelect({
  children,
  OnSelect,
  setOpen,
  open,
  modalidadePadrao = "TODAS",
}: ImovelSelectProps) {
  const { can } = useModulePermission();
  const canCreate = can("imoveis:criar");

  const [isLoading, setIsLoading] = useState(false);
  const [pagination, setPagination] = useState<Pagination>({
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 0,
  });

  const [imovelItems, setImovelItems] = useState<ImovelItem[]>([]);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [modalidadeFilter, setModalidadeFilter] = useState<string>(modalidadePadrao);
  const [situacaoFilter, setSituacaoFilter] = useState<string>("TODOS");

  const [openNewImovel, setOpenNewImovel] = useState(false);
  const requestSequence = useRef(0);
  const requestController = useRef<AbortController | null>(null);

  const handleGetImoveis = async (
    pageNumber?: number,
    limit?: number,
    searchText?: string,
    modalidade?: string,
    situacao?: string
  ) => {
    const requestId = ++requestSequence.current;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setIsLoading(true);

    const currentLimit = limit || pagination.limit;
    const currentPage = pageNumber || 1;

    try {
      const response = await axios.get("/api/imoveis", {
        signal: controller.signal,
        params: {
          page: currentPage,
          limit: currentLimit,
          search: searchText !== undefined ? searchText : search,
          modalidade: modalidade !== undefined ? modalidade : modalidadeFilter,
          situacao: situacao !== undefined ? situacao : situacaoFilter,
        },
      });

      if (response.status === 200 && requestId === requestSequence.current) {
        const { data } = response;
        const items = data.items || data.data || [];
        const total = data.total || 0;
        setImovelItems(items);
        setPagination({
          total,
          page: currentPage,
          limit: currentLimit,
          totalPages: Math.ceil(total / currentLimit) || 1,
        });
      }
    } catch (error) {
      if (!axios.isCancel(error) && requestId === requestSequence.current) {
        console.error("Erro ao buscar imóveis:", error);
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
      void handleGetImoveis(1, pagination.limit, search, modalidadeFilter, situacaoFilter);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, search, modalidadeFilter, situacaoFilter]);

  useEffect(() => () => requestController.current?.abort(), []);

  const executarBusca = () => {
    const term = searchInput.trim();
    if (term === search) {
      void handleGetImoveis(1, pagination.limit, term, modalidadeFilter, situacaoFilter);
    } else {
      setSearch(term);
    }
  };

  const limparBusca = () => {
    setSearchInput("");
    if (search === "") {
      void handleGetImoveis(1, pagination.limit, "", modalidadeFilter, situacaoFilter);
    } else {
      setSearch("");
    }
  };

  const handleSelect = (imovel: ImovelItem) => {
    if (OnSelect) OnSelect(imovel);
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
      {children ? <DialogTrigger asChild>{children}</DialogTrigger> : null}
      <DialogContent className="flex flex-col w-screen h-[100dvh] max-w-full max-h-none m-0 p-0 gap-0 rounded-none border-0 bg-card shadow-2xl overflow-hidden inset-0 top-0 left-0 translate-x-0 translate-y-0 sm:top-[50%] sm:left-[50%] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-[95vw] sm:max-w-5xl lg:max-w-6xl sm:h-[88vh] sm:max-h-[850px] sm:rounded-2xl sm:border min-w-0">
        {/* Header Fixo */}
        <DialogHeader className="shrink-0 p-4 sm:p-5 pr-10 sm:pr-12 border-b border-border/60 bg-muted/20 text-left">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-2xs">
                <Building2 className="size-5" />
              </div>
              <div>
                <DialogTitle className="text-base sm:text-lg font-semibold tracking-tight">
                  Selecionar Imóvel
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Busque por código, título, bairro, cidade ou modalidade operacional.
                </DialogDescription>
              </div>
            </div>

            {canCreate ? (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  onClick={() => setOpenNewImovel(true)}
                  size="sm"
                  className="h-9 px-3 text-xs gap-1.5 hover:cursor-pointer font-medium shadow-2xs"
                >
                  <Plus className="size-4" />
                  <span>Novo Imóvel</span>
                </Button>

                <EntityDialog
                  kind="imoveis"
                  open={openNewImovel}
                  onOpenChange={setOpenNewImovel}
                  onSaved={() => {
                    void handleGetImoveis(1, pagination.limit, search, modalidadeFilter, situacaoFilter);
                  }}
                />
              </div>
            ) : null}
          </div>
        </DialogHeader>

        {/* Indicador de Carregamento Topo */}
        <div className="relative h-1 w-full bg-muted overflow-hidden shrink-0">
          {isLoading && <div className="absolute inset-0 bg-primary animate-pulse" />}
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
                placeholder="Buscar por código (ex: FLAT-101), título, bairro, cidade ou #12..."
              />
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground px-0.5">
                <span className="font-semibold text-primary">Dicas:</span>
                <span>
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-bold text-foreground">
                    #12
                  </code>{" "}
                  ID exato
                </span>
                <span>
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-bold text-foreground">
                    FLAT-101
                  </code>{" "}
                  Código
                </span>
              </div>
            </div>

            {/* Controles de Visualização & Filtros */}
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              <Select
                value={modalidadeFilter}
                onValueChange={(val) => setModalidadeFilter(val)}
              >
                <SelectTrigger className="h-9 text-xs rounded-xl w-32 sm:w-36 bg-card">
                  <Filter className="size-3.5 mr-1.5 text-muted-foreground" />
                  <SelectValue placeholder="Modalidade" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TODAS">Todas Modalidades</SelectItem>
                  <SelectItem value="TEMPORADA">Temporada</SelectItem>
                  <SelectItem value="LOCACAO">Locação Mensal</SelectItem>
                  <SelectItem value="VENDA">Venda</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={situacaoFilter}
                onValueChange={(val) => setSituacaoFilter(val)}
              >
                <SelectTrigger className="h-9 text-xs rounded-xl w-32 sm:w-36 bg-card">
                  <SelectValue placeholder="Situação" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TODOS">Todas Situações</SelectItem>
                  <SelectItem value="DISPONIVEL">Disponível</SelectItem>
                  <SelectItem value="RESERVADO">Reservado</SelectItem>
                  <SelectItem value="OCUPADO">Ocupado</SelectItem>
                  <SelectItem value="ALUGADO">Alugado</SelectItem>
                  <SelectItem value="MANUTENCAO">Manutenção</SelectItem>
                  <SelectItem value="INATIVO">Inativo</SelectItem>
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
          {isLoading && imovelItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
              <Loader2 className="size-8 animate-spin text-primary" />
              <span className="text-xs font-medium">Buscando imóveis na base...</span>
            </div>
          ) : imovelItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center p-6 space-y-3 rounded-2xl border border-dashed border-border/80 bg-card">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <PackageSearch className="size-6" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-semibold">Nenhum imóvel encontrado</h4>
                <p className="text-xs text-muted-foreground max-w-sm">
                  {search
                    ? `Não encontramos resultados para "${search}". Tente buscar por outros termos como código, título ou cidade.`
                    : "Nenhum imóvel encontrado para os filtros selecionados."}
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
              {imovelItems.map((imovel) => {
                const address = imovel.endereco_publico || imovel.endereco || {};
                const localidade = [address.bairro, address.cidade, address.estado]
                  .filter(Boolean)
                  .join(" - ");

                return (
                  <div
                    key={imovel.id}
                    onClick={() => handleSelect(imovel)}
                    className="group relative flex flex-col justify-between rounded-2xl border border-border/60 overflow-hidden bg-card transition-all hover:shadow-md hover:border-primary/50 hover:bg-accent/20 hover:cursor-pointer"
                  >
                    {/* Header com Imagem ou Fallback */}
                    <div className="relative aspect-video w-full bg-muted/60 overflow-hidden border-b border-border/40">
                      {imovel.foto_capa ? (
                        <img
                          src={imovel.foto_capa}
                          alt={imovel.titulo}
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-muted/80 to-muted/30 text-muted-foreground">
                          <Building2 className="h-10 w-10 opacity-30 group-hover:scale-110 transition-transform" />
                        </div>
                      )}

                      {/* Badges Flutuantes no Topo */}
                      <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between gap-1.5 pointer-events-none">
                        <Badge
                          variant="secondary"
                          className="text-[10px] font-mono font-bold px-2 py-0.5 shadow-sm bg-background/90 backdrop-blur-sm border text-foreground"
                        >
                          {imovel.codigo || `#${imovel.id}`}
                        </Badge>

                        <div className="flex items-center gap-1">
                          <StatusBadge status={imovel.situacao_operacional || "DISPONIVEL"} />
                        </div>
                      </div>

                      {/* Tipo de Imóvel Flutuante */}
                      <div className="absolute bottom-2 left-2.5 pointer-events-none">
                        <span className="text-[10px] font-semibold tracking-wide uppercase px-2 py-0.5 rounded-md bg-background/80 backdrop-blur-sm text-foreground border border-border/60 shadow-xs">
                          {titleCase(imovel.tipo || "Imóvel")}
                        </span>
                      </div>
                    </div>

                    {/* Corpo do Card */}
                    <div className="p-3.5 space-y-2.5 flex-1 flex flex-col justify-between">
                      <div className="space-y-1.5">
                        <h3 className="text-xs sm:text-sm font-semibold text-foreground leading-snug line-clamp-1 group-hover:text-primary transition-colors">
                          {imovel.titulo || `Imóvel #${imovel.codigo || imovel.id}`}
                        </h3>

                        {localidade ? (
                          <p className="text-[11px] text-muted-foreground flex items-center gap-1 truncate">
                            <MapPin className="size-3 shrink-0 text-muted-foreground/70" />
                            <span className="truncate">{localidade}</span>
                          </p>
                        ) : null}
                      </div>

                      {/* Métricas Rápidas */}
                      <div className="flex items-center gap-3 pt-2 border-t border-border/40 text-[11px] text-muted-foreground flex-wrap">
                        {imovel.capacidade ? (
                          <span className="flex items-center gap-1" title="Capacidade máxima de hóspedes">
                            <Users className="size-3 text-muted-foreground/70" />
                            <span>Até {imovel.capacidade}</span>
                          </span>
                        ) : null}
                        {imovel.quartos != null ? (
                          <span className="flex items-center gap-1" title="Quartos">
                            <Bed className="size-3 text-muted-foreground/70" />
                            <span>{imovel.quartos} qts</span>
                          </span>
                        ) : null}
                        {imovel.banheiros != null ? (
                          <span className="flex items-center gap-1" title="Banheiros">
                            <Bath className="size-3 text-muted-foreground/70" />
                            <span>{imovel.banheiros} banh</span>
                          </span>
                        ) : null}
                        {imovel.area ? (
                          <span className="flex items-center gap-1" title="Área total">
                            <Maximize2 className="size-3 text-muted-foreground/70" />
                            <span>{imovel.area} m²</span>
                          </span>
                        ) : null}
                      </div>

                      {/* Modalidades & Preço Principal */}
                      <div className="pt-2 border-t border-border/50 flex items-center justify-between gap-2">
                        <div>
                          {imovel.modalidades?.includes("TEMPORADA") && imovel.diaria ? (
                            <div className="space-y-0.5">
                              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Diária</span>
                              <p className="text-xs sm:text-sm font-bold text-foreground">
                                {money(imovel.diaria)} <span className="text-[10px] font-normal text-muted-foreground">/noite</span>
                              </p>
                            </div>
                          ) : imovel.modalidades?.includes("LOCACAO") && imovel.valor_locacao ? (
                            <div className="space-y-0.5">
                              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Aluguel</span>
                              <p className="text-xs sm:text-sm font-bold text-foreground">
                                {money(imovel.valor_locacao)} <span className="text-[10px] font-normal text-muted-foreground">/mês</span>
                              </p>
                            </div>
                          ) : imovel.modalidades?.includes("VENDA") && imovel.valor_venda ? (
                            <div className="space-y-0.5">
                              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Venda</span>
                              <p className="text-xs sm:text-sm font-bold text-foreground">
                                {money(imovel.valor_venda)}
                              </p>
                            </div>
                          ) : (
                            <span className="text-xs font-medium text-muted-foreground">Sob Consulta</span>
                          )}
                        </div>

                        <div className="flex items-center gap-1 text-xs font-semibold text-primary">
                          <span>Selecionar</span>
                          <ArrowRight className="size-4 group-hover:translate-x-0.5 transition-transform" />
                        </div>
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
                    <TableHead className="w-24">Código</TableHead>
                    <TableHead>Imóvel / Título</TableHead>
                    <TableHead className="hidden sm:table-cell">Localização</TableHead>
                    <TableHead className="hidden md:table-cell">Modalidades</TableHead>
                    <TableHead>Diária / Valor</TableHead>
                    <TableHead className="w-24 text-center">Situação</TableHead>
                    <TableHead className="w-20 text-center">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {imovelItems.map((imovel) => {
                    const address = imovel.endereco_publico || imovel.endereco || {};
                    const localidade = [address.bairro, address.cidade, address.estado]
                      .filter(Boolean)
                      .join(" - ");

                    return (
                      <TableRow
                        key={imovel.id}
                        onClick={() => handleSelect(imovel)}
                        className="hover:cursor-pointer transition-colors hover:bg-muted/40"
                      >
                        <TableCell className="font-mono font-semibold text-foreground">
                          {imovel.codigo || `#${imovel.id}`}
                        </TableCell>

                        <TableCell>
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 border border-primary/20 text-primary">
                              <Building2 className="size-4" />
                            </div>
                            <div className="flex flex-col min-w-0 space-y-0.5">
                              <span className="font-semibold text-foreground truncate max-w-xs sm:max-w-md">
                                {imovel.titulo}
                              </span>
                              <span className="text-[11px] text-muted-foreground">
                                {titleCase(imovel.tipo || "Imóvel")}
                                {imovel.capacidade ? ` · Até ${imovel.capacidade} hóspedes` : ""}
                              </span>
                            </div>
                          </div>
                        </TableCell>

                        <TableCell className="hidden sm:table-cell text-muted-foreground">
                          {localidade || "—"}
                        </TableCell>

                        <TableCell className="hidden md:table-cell text-muted-foreground">
                          <div className="flex items-center gap-1 flex-wrap">
                            {(imovel.modalidades ?? []).map((m) => (
                              <Badge key={m} variant="outline" className="text-[10px] px-1.5 py-0">
                                {titleCase(m)}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>

                        <TableCell className="font-semibold text-foreground">
                          {imovel.diaria ? (
                            <span>{money(imovel.diaria)}/noite</span>
                          ) : imovel.valor_locacao ? (
                            <span>{money(imovel.valor_locacao)}/mês</span>
                          ) : imovel.valor_venda ? (
                            <span>{money(imovel.valor_venda)}</span>
                          ) : (
                            "—"
                          )}
                        </TableCell>

                        <TableCell className="text-center">
                          <StatusBadge status={imovel.situacao_operacional || "DISPONIVEL"} />
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
                Exibindo <strong className="text-foreground">{imovelItems.length}</strong> de{" "}
                <strong className="text-foreground">{pagination.total}</strong> imóveis
              </span>
              {isLoading && <Loader2 className="size-3.5 animate-spin text-primary ml-1" />}
            </div>

            {/* Controles de Páginas */}
            <div className="flex items-center gap-1 sm:gap-2">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 hover:cursor-pointer"
                onClick={() => handleGetImoveis(1, pagination.limit, search, modalidadeFilter, situacaoFilter)}
                disabled={pagination.page <= 1 || isLoading}
                title="Primeira página"
              >
                <ChevronsLeft className="size-4" />
              </Button>

              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 hover:cursor-pointer"
                onClick={() => handleGetImoveis(pagination.page - 1, pagination.limit, search, modalidadeFilter, situacaoFilter)}
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
                onClick={() => handleGetImoveis(pagination.page + 1, pagination.limit, search, modalidadeFilter, situacaoFilter)}
                disabled={pagination.page >= pagination.totalPages || pagination.totalPages === 0 || isLoading}
                title="Próxima página"
              >
                <ChevronRightIcon className="size-4" />
              </Button>

              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 hover:cursor-pointer"
                onClick={() => handleGetImoveis(pagination.totalPages, pagination.limit, search, modalidadeFilter, situacaoFilter)}
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
                  void handleGetImoveis(1, newLimit, search, modalidadeFilter, situacaoFilter);
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

